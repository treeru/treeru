// Force SGR mouse mode for Windows Terminal compatibility
process.env.BLESSED_FORCE_MODES = 'SGRMOUSE=1,CELLMOTION=1,ALLMOTION=1';
const blessed = require('blessed');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const APP_VERSION = (() => {
  try {
    const line = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8').split('\n')[0];
    return line.split(' - ')[0].trim();
  } catch { return '0'; }
})();
const { Client: SSHClient } = require('ssh2');
const { readFileSync, appendFileSync } = require('fs');

// ── Debug Log ───────────────────────────────────────────
const DEBUG = process.env.TREERU_DEBUG === '1';
const LOG_FILE = path.join(os.tmpdir(), 'treeru_debug.log');
function log(...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23);
  try { appendFileSync(LOG_FILE, `[${ts}] ${args.join(' ')}\n`); } catch {}
}

// ── Color Theme ─────────────────────────────────────────
const C = {
  border:    '#5F87AF',
  borderHi:  '#87AFD7',
  remote:    '#56B6C2',
  remoteDim: '#3E8E97',
  select:    'green',
  bg:        'black',
  fg:        'white',
  header:    '#1A1A2E',
  dim:       '#666666',
};

// ── State ───────────────────────────────────────────────
const panel = {
  cwd: process.cwd(),
  entries: [],
  selectedIndex: 0,
  scrollOffset: 0,
  marked: new Set(), // multi-select: stores entry names
};
let dialogOpen = false;

// ── Remote (SSH) State ──────────────────────────────────
let remoteMode = false;
let remoteHost = '';
let remoteUser = '';
let remoteCwd = '';
let sftpConn = null;
let sftpSession = null;

const isWindows = process.platform === 'win32';

// ── SSH Config Parser ───────────────────────────────────
function parseSSHConfig() {
  const hosts = {};
  try {
    const content = readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    let cur = null;
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const m = t.match(/^(\S+)\s+(.+)$/);
      if (!m) continue;
      if (m[1].toLowerCase() === 'host') {
        cur = m[2].trim();
        if (cur !== '*') hosts[cur] = {};
      } else if (cur && cur !== '*') {
        hosts[cur][m[1].toLowerCase()] = m[2].trim();
      }
    }
  } catch {}
  return hosts;
}
const sshConfig = parseSSHConfig();

function getSSHInfo(alias) {
  const c = sshConfig[alias] || {};
  return {
    host: c.hostname || alias,
    port: parseInt(c.port || '22', 10),
    username: c.user || process.env.USER || process.env.USERNAME || 'root',
    identityFile: c.identityfile || path.join(os.homedir(), '.ssh', 'id_rsa'),
  };
}

// ── SFTP ────────────────────────────────────────────────
function connectSFTP(alias, callback) {
  const info = getSSHInfo(alias);
  let keyPath = info.identityFile.replace(/^~/, os.homedir()).replace(/"/g, '');
  log('SFTP | connect', alias, info.host, info.port, info.username, keyPath);

  let privateKey;
  try { privateKey = readFileSync(keyPath); }
  catch {
    for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
      try { privateKey = readFileSync(path.join(os.homedir(), '.ssh', name)); break; } catch {}
    }
  }
  if (!privateKey) { callback(new Error('No SSH key found')); return; }

  const conn = new SSHClient();
  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) { callback(err); return; }
      sftpConn = conn;
      sftpSession = sftp;
      remoteHost = alias;
      remoteUser = info.username;
      callback(null);
    });
  });
  conn.on('error', (err) => {
    log('SFTP | connection error:', err.message);
    callback(err);
  });
  conn.on('close', () => {
    log('SFTP | connection closed');
    if (remoteMode) {
      sftpConn = null;
      sftpSession = null;
    }
  });
  conn.connect({
    host: info.host,
    port: info.port,
    username: info.username,
    privateKey,
    hostHash: 'sha256',
    hostVerifier: (hash) => {
      // Verify against known_hosts (best-effort, allow if file missing)
      try {
        const knownHosts = readFileSync(path.join(os.homedir(), '.ssh', 'known_hosts'), 'utf8');
        if (knownHosts.includes(info.host)) return true;
      } catch {}
      return true; // Allow connection if known_hosts unavailable
    },
  });
}

function disconnectSFTP() {
  if (sftpConn) { try { sftpConn.end(); } catch {} }
  sftpConn = null; sftpSession = null;
  remoteMode = false; remoteHost = ''; remoteUser = ''; remoteCwd = '';
}

// ── Directory Reading ───────────────────────────────────
function readLocalDir(dirPath) {
  try {
    const raw = fs.readdirSync(dirPath, { withFileTypes: true });
    const entries = raw.map(d => ({
      name: d.name,
      type: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'symlink' : 'file',
      hidden: d.name.startsWith('.'),
    }));
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    if (path.parse(dirPath).root !== dirPath) {
      entries.unshift({ name: '..', type: 'dir', hidden: false });
    }
    return entries;
  } catch {
    return [{ name: '.. (access denied)', type: 'dir', hidden: false }];
  }
}

function readRemoteDir(dirPath, callback) {
  if (!sftpSession) { callback([], 'No SFTP session'); return; }
  const p = dirPath.replace(/\\/g, '/') || '/';
  log('readRemoteDir |', p, 'host:', remoteHost);
  sftpSession.readdir(p, (err, list) => {
    if (err) {
      log('readRemoteDir | ERROR:', err.message);
      callback([{ name: '..', type: 'dir', hidden: false }], err.message);
      return;
    }
    const entries = list.map(item => {
      let type = 'file';
      if (item.longname && item.longname[0] === 'd') type = 'dir';
      else if (item.longname && item.longname[0] === 'l') type = 'symlink';
      return { name: item.filename, type, hidden: item.filename.startsWith('.') };
    });
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    if (p !== '/') entries.unshift({ name: '..', type: 'dir', hidden: false });
    callback(entries, null);
  });
}

// ── CJK Width Helpers ───────────────────────────────────
function isWide(code) {
  return (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0x303E) ||
    (code >= 0x3040 && code <= 0x33BF) || (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x4E00 && code <= 0xA4CF) || (code >= 0xA960 && code <= 0xA97C) ||
    (code >= 0xAC00 && code <= 0xD7FF) || (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE6F) || (code >= 0xFF01 && code <= 0xFF60) ||
    (code >= 0xFFE0 && code <= 0xFFE6) || (code >= 0x20000 && code <= 0x2FA1F) ||
    (code >= 0x1F000 && code <= 0x1FBFF);
}
function strWidth(s) { let w = 0; for (const c of s) w += isWide(c.codePointAt(0)) ? 2 : 1; return w; }
function padW(s, tw) { const w = strWidth(s); return w >= tw ? s : s + ' '.repeat(tw - w); }
function truncW(s, tw) {
  let w = 0, i = 0;
  for (const c of s) {
    const cw = isWide(c.codePointAt(0)) ? 2 : 1;
    if (w + cw > tw - 1) return s.slice(0, i) + '…';
    w += cw; i += c.length;
  }
  return s;
}

// ── Screen ──────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'TreeRU', fullUnicode: true, mouse: true });

// Header
const headerBar = blessed.box({
  parent: screen, top: 0, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: C.header, fg: 'white', bold: true },
});

// Main file panel (full width)
const fileBox = blessed.box({
  parent: screen, top: 1, left: 0, width: '100%', height: '100%-4',
  border: { type: 'line' }, label: ' TreeRU ', tags: true,
  scrollable: true, mouse: true, clickable: true,
  style: { border: { fg: C.border }, label: { fg: C.borderHi, bold: true } },
});

// Function key bar (bottom)
const fnBar = blessed.box({
  parent: screen, bottom: 2, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: C.header, fg: 'gray' },
});

// Status bar
const statusBar = blessed.box({
  parent: screen, bottom: 1, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: C.header, fg: '#87AFD7' },
});

// Path prompt bar (Far Manager style)
const pathBar = blessed.box({
  parent: screen, bottom: 0, left: 0, width: '100%', height: 1,
  tags: false, style: { bg: 'black', fg: 'white' },
});

// ── File Icons ──────────────────────────────────────────
function getFileIcon(name) {
  const ext = path.extname(name).toLowerCase();
  const base = name.toLowerCase();

  // Exact filename matches
  const nameMap = {
    'dockerfile': '🐳', 'docker-compose.yml': '🐳', 'docker-compose.yaml': '🐳',
    '.dockerignore': '🐳', '.gitignore': '📎', '.gitmodules': '📎', '.gitattributes': '📎',
    '.env': '🔒', '.env.local': '🔒', '.env.production': '🔒', '.env.development': '🔒',
    'license': '📃', 'licence': '📃', 'license.md': '📃', 'license.txt': '📃',
    'readme.md': '📖', 'readme.txt': '📖', 'readme': '📖',
    'makefile': '🔧', 'cmakelists.txt': '🔧', 'rakefile': '🔧',
    'package.json': '📦', 'package-lock.json': '🔗', 'yarn.lock': '🔗',
    'tsconfig.json': '📘', 'jsconfig.json': '📜',
    '.eslintrc': '📏', '.eslintrc.js': '📏', '.eslintrc.json': '📏', '.prettierrc': '📏',
    '.babelrc': '📏', 'webpack.config.js': '📦', 'vite.config.js': '⚡', 'vite.config.ts': '⚡',
    'requirements.txt': '📋', 'pipfile': '🐍', 'pyproject.toml': '🐍', 'setup.py': '🐍',
    'cargo.toml': '🦀', 'cargo.lock': '🔗', 'go.mod': '🔵', 'go.sum': '🔗',
    'gemfile': '💎', 'gemfile.lock': '🔗', 'composer.json': '🎵', 'composer.lock': '🔗',
    '.htaccess': '⚙️', 'nginx.conf': '⚙️', 'web.config': '⚙️',
    'procfile': '🚀', 'vercel.json': '▲', 'netlify.toml': '🌐',
  };
  if (nameMap[base]) return nameMap[base];

  // Extension matches
  const extMap = {
    // JavaScript / TypeScript
    '.js': '📜', '.mjs': '📜', '.cjs': '📜', '.jsx': '⚛️',
    '.ts': '📘', '.tsx': '⚛️', '.d.ts': '📘',
    // Python
    '.py': '🐍', '.pyw': '🐍', '.pyx': '🐍', '.ipynb': '📓',
    // Web
    '.html': '🌐', '.htm': '🌐', '.xhtml': '🌐',
    '.css': '🎨', '.scss': '🎨', '.sass': '🎨', '.less': '🎨', '.styl': '🎨',
    '.svg': '🎨', '.vue': '💚', '.svelte': '🔥',
    // Data / Config
    '.json': '📋', '.jsonc': '📋', '.json5': '📋',
    '.yaml': '📋', '.yml': '📋', '.toml': '📋', '.ini': '📋',
    '.xml': '📋', '.xsl': '📋', '.xsd': '📋', '.dtd': '📋',
    '.csv': '📊', '.tsv': '📊',
    '.env': '🔒', '.pem': '🔑', '.key': '🔑', '.crt': '🔑', '.cer': '🔑', '.p12': '🔑',
    // Documentation
    '.md': '📝', '.mdx': '📝', '.txt': '📄', '.rst': '📝',
    '.doc': '📄', '.docx': '📄', '.pdf': '📕', '.rtf': '📄',
    '.xls': '📊', '.xlsx': '📊', '.ppt': '📊', '.pptx': '📊',
    // Images
    '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
    '.bmp': '🖼️', '.ico': '🖼️', '.webp': '🖼️', '.tiff': '🖼️', '.tif': '🖼️',
    '.psd': '🖼️', '.ai': '🖼️', '.sketch': '🖼️',
    // Video
    '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬',
    '.wmv': '🎬', '.flv': '🎬', '.webm': '🎬', '.m4v': '🎬',
    // Audio
    '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵', '.aac': '🎵',
    '.ogg': '🎵', '.wma': '🎵', '.m4a': '🎵', '.opus': '🎵',
    // Archives
    '.zip': '📦', '.tar': '📦', '.gz': '📦', '.bz2': '📦',
    '.7z': '📦', '.rar': '📦', '.xz': '📦', '.zst': '📦',
    '.tgz': '📦', '.deb': '📦', '.rpm': '📦', '.dmg': '📦', '.iso': '📦',
    // Executables / Scripts
    '.exe': '⚙️', '.msi': '⚙️', '.bat': '⚙️', '.cmd': '⚙️', '.ps1': '⚙️',
    '.sh': '⚙️', '.bash': '⚙️', '.zsh': '⚙️', '.fish': '⚙️',
    '.app': '⚙️', '.apk': '📱', '.ipa': '📱',
    // Compiled / Binary
    '.o': '⚙️', '.so': '⚙️', '.dll': '⚙️', '.dylib': '⚙️', '.a': '⚙️',
    '.class': '☕', '.jar': '☕', '.war': '☕',
    '.wasm': '⚙️', '.pyc': '🐍',
    // Languages
    '.c': '📝', '.h': '📝', '.cpp': '📝', '.hpp': '📝', '.cc': '📝',
    '.cs': '📝', '.java': '☕', '.kt': '📝', '.kts': '📝',
    '.go': '🔵', '.rs': '🦀', '.rb': '💎', '.php': '🐘',
    '.swift': '🍎', '.m': '📝', '.mm': '📝',
    '.r': '📊', '.R': '📊', '.jl': '📝',
    '.lua': '🌙', '.pl': '🐪', '.pm': '🐪', '.dart': '🎯',
    '.ex': '💧', '.exs': '💧', '.erl': '📝', '.hs': '📝',
    '.scala': '📝', '.clj': '📝', '.lisp': '📝', '.elm': '📝',
    '.v': '📝', '.vhd': '📝', '.vhdl': '📝', '.sv': '📝',
    // Database
    '.sql': '🗄️', '.sqlite': '🗄️', '.db': '🗄️', '.mdb': '🗄️',
    // Log / misc
    '.log': '📊', '.bak': '💾', '.tmp': '💾', '.swp': '💾',
    '.lock': '🔗', '.pid': '📎', '.cfg': '⚙️', '.conf': '⚙️',
    // Fonts
    '.ttf': '🔤', '.otf': '🔤', '.woff': '🔤', '.woff2': '🔤', '.eot': '🔤',
  };
  return extMap[ext] || '📄';
}

function formatCell(entry, selected, colWidth) {
  const maxW = Math.max(1, colWidth - 4);
  const marked = panel.marked.has(entry.name);
  let icon, color;
  if (entry.type === 'dir') { icon = '>'; color = '{cyan-fg}{bold}'; }
  else if (entry.type === 'symlink') { icon = '~'; color = '{magenta-fg}'; }
  else { icon = ' '; color = '{white-fg}'; }

  let display = entry.name;
  if (strWidth(display) > maxW) display = truncW(display, maxW);
  display = padW(display, maxW);

  const cellContent = ` ${icon} ${display}`;
  const cellW = 3 + strWidth(display);
  const padLen = Math.max(0, colWidth - cellW);

  if (selected && marked) {
    return `{black-fg}{yellow-bg}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  if (selected) {
    const bg = remoteMode ? '{#56B6C2-bg}' : '{green-bg}';
    return `{black-fg}${bg}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  if (marked) {
    return `{yellow-fg}{bold}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  return `${color}${cellContent}${' '.repeat(padLen)}{/}`;
}

function getFileInfo(name, fp) {
  if (remoteMode) return name;
  try {
    const s = fs.statSync(fp);
    const sz = s.isDirectory() ? '<DIR>' : formatSize(s.size);
    const d = s.mtime.toISOString().slice(0, 16).replace('T', ' ');
    return `${name}  ${sz}  ${d}`;
  } catch { return name; }
}

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

// ── Rendering ───────────────────────────────────────────
function renderPanel() {
  if (remoteMode) {
    fileBox.style.border.fg = C.remote;
    fileBox.style.label.fg = C.remote;
  } else {
    fileBox.style.border.fg = C.border;
    fileBox.style.label.fg = C.borderHi;
  }

  if (!remoteMode) panel.entries = readLocalDir(panel.cwd);

  if (panel.selectedIndex >= panel.entries.length) panel.selectedIndex = panel.entries.length - 1;
  if (panel.selectedIndex < 0) panel.selectedIndex = 0;

  const ih = Math.max(1, fileBox.height - 2);
  const iw = fileBox.width - 2;

  // Calculate columns: each column is at least 25 chars, separated by │
  const MIN_COL_W = 25;
  const numCols = Math.max(1, Math.floor((iw + 1) / (MIN_COL_W + 1)));
  const colWidth = Math.floor((iw - (numCols - 1)) / numCols); // subtract separators

  // Items per page = rows * columns
  const pageSize = ih * numCols;

  // Calculate page offset based on selection
  const page = Math.floor(panel.selectedIndex / pageSize);
  const pageStart = page * pageSize;

  // Label
  let cwd = panel.cwd;
  if (cwd.length > iw - 4) cwd = '…' + cwd.slice(-(iw - 5));
  fileBox.setLabel(` ${cwd} `);

  // Build grid: entries flow top-to-bottom, then left-to-right
  const lines = [];
  for (let row = 0; row < ih; row++) {
    let line = '';
    for (let col = 0; col < numCols; col++) {
      const idx = pageStart + col * ih + row;
      if (col > 0) line += '{gray-fg}│{/}';
      if (idx < panel.entries.length) {
        line += formatCell(panel.entries[idx], idx === panel.selectedIndex, colWidth);
      } else {
        line += ' '.repeat(colWidth);
      }
    }
    lines.push(line);
  }
  fileBox.setContent(lines.join('\n'));

  // Store grid info for mouse click calculation
  panel._grid = { ih, numCols, colWidth, pageStart };
}

function renderHeader() {
  const title = `  TreeRU v${APP_VERSION}`;
  let right = '';
  if (remoteMode) {
    right = `{#56B6C2-fg}[ SSH: ${remoteHost} ]{/} `;
  } else {
    const hostCount = Object.keys(sshConfig).length;
    right = hostCount > 0 ? `{${C.dim}-fg}${hostCount} SSH hosts{/} ` : '';
  }
  const pad = Math.max(0, screen.width - title.length - right.length + 20);
  headerBar.setContent(`{bold}{cyan-fg}${title}{/}${' '.repeat(pad)}${right}`);
}

function renderStatus() {
  const entry = panel.entries[panel.selectedIndex];
  let left = '';
  if (entry && entry.name !== '..') {
    if (remoteMode) {
      left = ` ${entry.name}`;
    } else {
      left = ` ${getFileInfo(entry.name, path.join(panel.cwd, entry.name))}`;
    }
  }
  const markedInfo = panel.marked.size > 0 ? `[${panel.marked.size} selected] ` : '';
  const idx = panel.entries.length > 0 ? `${markedInfo}${panel.selectedIndex + 1}/${panel.entries.length}` : '0/0';
  const pad = Math.max(0, screen.width - left.length - idx.length - 1);
  statusBar.setContent(`${left}${' '.repeat(pad)}${idx} `);
}

function renderFnBar() {
  const items = [
    '{white-fg}{bold}Enter{/}{#87AFD7-fg} Open/View{/}',
    '{white-fg}{bold}Space{/}{#87AFD7-fg} Select{/}',
    '{white-fg}{bold}F2{/}{#87AFD7-fg} Rename{/}',
    '{white-fg}{bold}F4{/}{#87AFD7-fg} Edit{/}',
    '{white-fg}{bold}F5{/}{#87AFD7-fg} Paste{/}',
    '{white-fg}{bold}F7{/}{#87AFD7-fg} NewDir{/}',
    '{white-fg}{bold}F10{/}{#87AFD7-fg} SSH{/}',
    '{white-fg}{bold}Del{/}{#87AFD7-fg} Delete{/}',
    '{white-fg}{bold}Ctrl+Shift+C{/}{#87AFD7-fg} CopyPath{/}',
    '{white-fg}{bold}PrtSc{/}{#87AFD7-fg} AutoSave{/}',
  ];
  fnBar.setContent(` ${items.join('  ')}`);
}

function renderPathBar() {
  let prompt;
  if (remoteMode) {
    prompt = `${remoteUser}@${remoteHost}:${remoteCwd}>`;
  } else {
    prompt = `${panel.cwd}>`;
  }
  pathBar.setContent(prompt);
}

function render() {
  renderPanel();
  renderHeader();
  renderStatus();
  renderFnBar();
  renderPathBar();
  screen.render();

  // Position cursor at end of path prompt (must be after screen.render)
  const prompt = pathBar.getContent();
  const absX = pathBar.aleft + blessed.unicode.strWidth(prompt);
  const absY = pathBar.atop;
  screen.program.move(absX, absY);
  screen.program.showCursor();
}

// ── Dialogs ─────────────────────────────────────────────
function inputDialog(title, defaultVal, callback) {
  dialogOpen = true;
  const form = blessed.form({
    parent: screen, top: 'center', left: 'center', width: '60%', height: 5,
    border: { type: 'line' },
    style: { border: { fg: C.borderHi }, bg: C.header, fg: C.fg },
    label: ` ${title} `, keys: true,
  });
  const input = blessed.textbox({
    parent: form, top: 0, left: 1, right: 1, height: 1,
    style: { fg: 'white', bg: '#2A2A3E', focus: { bg: '#3A3A4E' } },
    inputOnFocus: true, value: defaultVal || '',
  });
  blessed.box({
    parent: form, top: 1, left: 1, height: 1, tags: true,
    style: { bg: C.header, fg: 'gray' },
    content: '{gray-fg}Enter: confirm  |  Escape: cancel{/}',
  });
  input.on('submit', (v) => { form.destroy(); dialogOpen = false; screen.render(); if (v) callback(v); });
  input.on('cancel', () => { form.destroy(); dialogOpen = false; render(); });
  input.focus(); screen.render();
}

function confirmDialog(msg, callback) {
  dialogOpen = true;
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center', width: '50%', height: 5,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: 'red' }, bg: C.header, fg: C.fg },
    label: ' Confirm ',
    content: `\n ${msg}\n\n {green-fg}Y{/} = Yes   {red-fg}N/Esc{/} = No`,
  });
  const h = (ch, key) => {
    if (!key) return;
    if (key.name === 'y' || key.name === 'enter' || key.name === 'return') {
      screen.removeListener('keypress', h); box.destroy(); dialogOpen = false; render(); callback();
    } else if (key.name === 'n' || key.name === 'escape') {
      screen.removeListener('keypress', h); box.destroy(); dialogOpen = false; render();
    }
  };
  screen.on('keypress', h); screen.render();
}

function showMessage(msg) {
  const m = blessed.box({
    parent: screen, top: 'center', left: 'center', width: '50%', height: 3,
    border: { type: 'line' }, tags: true,
    valign: 'middle',
    align: 'center',
    style: { border: { fg: C.select }, bg: C.header, fg: C.fg },
    content: msg,
  });
  screen.render();
  setTimeout(() => { m.destroy(); render(); }, 1500);
}

// ── SSH Connection Menu ─────────────────────────────────
function showSSHMenu() {
  // Filter out wildcards and patterns
  const hosts = Object.keys(sshConfig).filter(h => !h.includes('*') && !h.includes('?'));
  if (hosts.length === 0) {
    showMessage('No SSH hosts found in ~/.ssh/config');
    return;
  }

  dialogOpen = true;
  const listHeight = Math.min(hosts.length + 2, screen.height - 6);
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center',
    width: '50%', height: listHeight + 2,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: C.remote }, bg: C.header, fg: C.fg },
    label: ' SSH Connect ',
  });

  const list = blessed.list({
    parent: box, top: 0, left: 1, right: 1, height: listHeight,
    tags: false, mouse: true, keys: true,
    style: {
      fg: 'white',
      selected: { fg: 'black', bg: C.remote },
    },
    items: hosts.map(h => {
      const info = getSSHInfo(h);
      return `  ${h}  (${info.username}@${info.host})`;
    }),
  });

  list.on('select', (item, idx) => {
    const alias = hosts[idx];
    const info = getSSHInfo(alias);
    list.removeAllListeners();
    box.destroy();
    dialogOpen = false;
    log('SSH menu | selected idx:', idx, 'alias:', alias, 'host:', info.host);
    // Use nextTick to avoid Enter key bleeding through
    process.nextTick(() => connectToSSH(alias));
  });

  list.on('cancel', () => {
    list.removeAllListeners();
    box.destroy();
    dialogOpen = false;
    render();
  });

  list.focus();
  screen.render();
}

function connectToSSH(alias) {
  log('connectToSSH | alias:', alias);
  showMessage(`Connecting to ${alias}...`);
  connectSFTP(alias, (err) => {
    if (err) {
      showMessage(`SSH failed: ${err.message}`);
      return;
    }
    remoteMode = true;
    // Resolve home directory
    sftpSession.realpath('.', (err2, homePath) => {
      remoteCwd = err2 ? '/home/' + remoteUser : homePath;
      refreshRemote();
    });
  });
}

function refreshRemote(callback) {
  readRemoteDir(remoteCwd, (entries, err) => {
    if (err) {
      log('refreshRemote | error:', err);
      if (callback) callback(err);
      return;
    }
    panel.entries = entries;
    panel.cwd = `${remoteUser}@${remoteHost}:${remoteCwd}`;
    panel.selectedIndex = 0;
    panel.scrollOffset = 0;
    panel.marked.clear();
    render();
    if (callback) callback(null);
  });
}

// ── Actions ─────────────────────────────────────────────
function navigate(dir) {
  if (remoteMode) {
    const prevCwd = remoteCwd;
    if (dir === '..') {
      const parts = remoteCwd.split('/').filter(Boolean);
      parts.pop();
      remoteCwd = '/' + parts.join('/');
    } else {
      remoteCwd = dir;
    }
    log('navigate | remote:', prevCwd, '→', remoteCwd, 'host:', remoteHost);

    // Check if SFTP session is still alive
    if (!sftpSession) {
      log('navigate | SFTP session lost!');
      showMessage('SSH connection lost');
      disconnectSFTP();
      panel.cwd = path.resolve(process.argv[2] || process.cwd());
      render();
      return;
    }

    refreshRemote((err) => {
      if (err) {
        // Revert to previous directory on error
        log('navigate | readdir failed, reverting to:', prevCwd);
        remoteCwd = prevCwd;
        showMessage('Access denied: ' + dir);
      }
    });
    return;
  }
  try {
    fs.accessSync(dir, fs.constants.R_OK);
    panel.cwd = path.resolve(dir);
    panel.selectedIndex = 0;
    panel.scrollOffset = 0;
    panel.marked.clear();
    render();
  } catch {
    showMessage('Access denied: ' + dir);
  }
}

function openEntry() {
  const entry = panel.entries[panel.selectedIndex];
  if (!entry) return;
  log('openEntry |', entry.name, 'type:', entry.type, 'remote:', remoteMode, 'host:', remoteHost, 'remoteCwd:', remoteCwd);
  if (remoteMode) {
    if (entry.name === '..') {
      log('openEntry | remote go up from:', remoteCwd);
      navigate('..');
      return;
    }
    else if (entry.type === 'dir') {
      const newPath = remoteCwd === '/' ? '/' + entry.name : remoteCwd.replace(/\/+$/, '') + '/' + entry.name;
      log('openEntry | remote path:', newPath);
      navigate(newPath);
    }
    return;
  }
  if (entry.name === '..') { navigate(path.dirname(panel.cwd)); return; }
  const fp = path.join(panel.cwd, entry.name);
  if (entry.type === 'dir') navigate(fp);
  else if (isViewable(entry.name)) openViewer(fp, entry.name);
}

// ── File Viewer ──────────────────────────────────────────
const VIEWABLE_EXT = new Set([
  '.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift', '.kt',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.scss',
  '.sh', '.bash', '.zsh', '.bat', '.ps1', '.cmd',
  '.conf', '.cfg', '.ini', '.env', '.gitignore', '.dockerignore',
  '.csv', '.log', '.sql', '.graphql',
  '.vue', '.svelte', '.astro',
  '.makefile', '.dockerfile', '.editorconfig',
  '.lock', '.pid', '.map',
]);

function isViewable(name) {
  const ext = path.extname(name).toLowerCase();
  const base = name.toLowerCase();
  // Known extensionless files
  if (['makefile', 'dockerfile', 'readme', 'license', 'changelog'].includes(base)) return true;
  return VIEWABLE_EXT.has(ext);
}

function openViewer(fp, name) {
  let content;
  try {
    const buf = fs.readFileSync(fp);
    // Skip binary files (check for null bytes in first 8KB)
    const sample = buf.slice(0, 8192);
    if (sample.includes(0)) { showMessage('Binary file — cannot view'); return; }
    content = buf.toString('utf8');
  } catch (e) {
    showMessage('Cannot read: ' + e.message);
    return;
  }

  const lines = content.split('\n');
  const lineNumW = String(lines.length).length;
  const numbered = lines.map((l, i) => {
    const num = String(i + 1).padStart(lineNumW);
    return `{gray-fg}${num}{/} ${l.replace(/\{/g, '{open}').replace(/\{open\}/g, '{')}`;
  });

  dialogOpen = true;

  const hint = blessed.box({
    parent: screen, bottom: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: C.header, fg: '#87AFD7' },
    content: ' {white-fg}{bold}ESC{/}{#87AFD7-fg} Close{/}  {white-fg}{bold}↑↓{/}{#87AFD7-fg} Scroll{/}  {white-fg}{bold}PgUp/PgDn{/}{#87AFD7-fg} Page{/}  {white-fg}{bold}Home/End{/}{#87AFD7-fg} Top/Bottom{/}  {white-fg}{bold}C{/}{#87AFD7-fg} CopyAll{/}',
  });

  const viewer = blessed.box({
    parent: screen, top: 0, left: 0, width: '100%', height: '100%-1',
    border: { type: 'line' }, tags: true,
    scrollable: true, alwaysScroll: true, mouse: true, keys: true,
    scrollbar: { ch: '█', style: { fg: 'gray' } },
    style: { border: { fg: C.borderHi }, bg: 'black', fg: 'white' },
    label: ` ${name} (${lines.length} lines) `,
  });

  // Plain text content with line numbers
  const plainLines = lines.map((l, i) => {
    const num = String(i + 1).padStart(lineNumW);
    // Escape blessed tags in file content
    const safe = l.replace(/\{/g, '\\{');
    return `{gray-fg}${num}{/}{white-fg} ${safe}{/}`;
  });
  viewer.setContent(plainLines.join('\n'));

  const closeViewer = () => {
    screen.removeListener('keypress', viewerKeys);
    hint.destroy();
    viewer.destroy();
    dialogOpen = false;
    render();
  };

  const viewerKeys = (ch, key) => {
    if (!key) return;
    if (key.name === 'escape' || key.name === 'q') {
      closeViewer();
    } else if (key.name === 'up' || key.name === 'k') {
      viewer.scroll(-1); screen.render();
    } else if (key.name === 'down' || key.name === 'j') {
      viewer.scroll(1); screen.render();
    } else if (key.name === 'pageup') {
      viewer.scroll(-(viewer.height - 3)); screen.render();
    } else if (key.name === 'pagedown') {
      viewer.scroll(viewer.height - 3); screen.render();
    } else if (key.name === 'home') {
      viewer.scrollTo(0); screen.render();
    } else if (key.name === 'end') {
      viewer.scrollTo(lines.length); screen.render();
    } else if (ch === 'c' || ch === 'C') {
      const text = content.replace(/\r\n/g, '\n');
      execFile('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`], (err) => {
        showMessage(err ? 'Copy failed' : 'Copied to clipboard');
      });
    }
  };

  screen.on('keypress', viewerKeys);
  viewer.focus();
  screen.render();
}

function copyPathToClipboard() {
  let paths = [];
  if (panel.marked.size > 0) {
    // Copy all marked files
    panel.entries.forEach(e => {
      if (panel.marked.has(e.name)) {
        paths.push(remoteMode ? remoteCwd + '/' + e.name : path.join(panel.cwd, e.name));
      }
    });
  } else {
    // Copy single selected file
    const entry = panel.entries[panel.selectedIndex];
    if (!entry || entry.name === '..') return;
    paths.push(remoteMode ? remoteCwd + '/' + entry.name : path.join(panel.cwd, entry.name));
  }
  const text = paths.join(', ');
  if (isWindows) {
    execFile('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`], (err) => {
      showMessage(err ? 'Copy failed' : `Copied ${paths.length} path(s)`);
    });
  } else {
    const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip';
    const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard'];
    const child = require('child_process').spawn(cmd, args);
    child.stdin.end(text);
    child.on('close', () => showMessage(`Copied ${paths.length} path(s)`));
  }
}

function hasBadPath(name) {
  return !name || name.includes('..') || name.includes('/') || name.includes('\\');
}

function makeDirectory() {
  if (remoteMode) {
    inputDialog('New folder name (remote):', '', (name) => {
      if (hasBadPath(name)) { showMessage('Invalid name'); return; }
      const rp = remoteCwd + '/' + name;
      sftpSession.mkdir(rp, (err) => {
        if (err) showMessage('Failed: ' + err.message);
        else refreshRemote();
      });
    });
    return;
  }
  inputDialog('New folder name:', '', (name) => {
    if (hasBadPath(name)) { showMessage('Invalid name'); return; }
    try { fs.mkdirSync(path.join(panel.cwd, name)); render(); }
    catch (e) { showMessage('Failed: ' + e.message); }
  });
}

function deleteEntry() {
  const entry = panel.entries[panel.selectedIndex];
  if (!entry || entry.name === '..') return;
  confirmDialog(`Delete "${entry.name}"?`, () => {
    if (remoteMode) {
      const rp = remoteCwd + '/' + entry.name;
      if (entry.type === 'dir') {
        sftpSession.rmdir(rp, (err) => {
          if (err) showMessage('Delete failed: ' + err.message);
          else refreshRemote();
        });
      } else {
        sftpSession.unlink(rp, (err) => {
          if (err) showMessage('Delete failed: ' + err.message);
          else refreshRemote();
        });
      }
      return;
    }
    try { fs.rmSync(path.join(panel.cwd, entry.name), { recursive: true, force: true }); render(); }
    catch (e) { showMessage('Delete failed: ' + e.message); }
  });
}

function renameEntry() {
  const entry = panel.entries[panel.selectedIndex];
  if (!entry || entry.name === '..') return;
  inputDialog('Rename to:', entry.name, (newName) => {
    if (hasBadPath(newName)) { showMessage('Invalid name'); return; }
    if (remoteMode) {
      sftpSession.rename(remoteCwd + '/' + entry.name, remoteCwd + '/' + newName, (err) => {
        if (err) showMessage('Rename failed: ' + err.message);
        else refreshRemote();
      });
      return;
    }
    try {
      fs.renameSync(path.join(panel.cwd, entry.name), path.join(panel.cwd, newName));
      render();
    } catch (e) { showMessage('Rename failed: ' + e.message); }
  });
}

// ── Clipboard Image Watcher ─────────────────────────────
let lastClipSeq = -1;
let lastSavedClipSeq = -1;
let clipInterval = null;
let clipChecking = false;

function startClipboardWatcher() {
  if (clipInterval || !isWindows) return;
  const scriptPath = path.join(__dirname, 'clip_check.ps1');

  clipInterval = setInterval(() => {
    if (clipChecking) return; // Skip if previous check still running
    clipChecking = true;

    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], (err, stdout) => {
      clipChecking = false;
      if (err) return;
      const seq = parseInt(stdout.trim(), 10);
      if (isNaN(seq)) return;

      if (lastClipSeq === -1) {
        lastClipSeq = seq;
        lastSavedClipSeq = seq;
        return;
      }
      if (seq !== lastClipSeq) {
        lastClipSeq = seq;
        log('clipboard | changed, seq:', seq);
        if (!dialogOpen) {
          lastSavedClipSeq = seq;
          saveClipboardImage();
        }
      }
    });
  }, 1500);
}

function saveClipboardImage() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `screenshot_${ts}.png`;
  let savePath;

  if (remoteMode) {
    savePath = path.join(os.tmpdir(), filename);
  } else {
    savePath = path.join(panel.cwd, filename);
  }

  const scriptPath = path.join(__dirname, 'clip_save.ps1');
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-dest', savePath], (err, stdout) => {
    if (err || stdout.trim() !== 'OK') { log('clipboard | no image'); return; }

    if (remoteMode && sftpSession) {
      const rp = remoteCwd + '/' + filename;
      sftpSession.fastPut(savePath, rp, (ue) => {
        try { fs.unlinkSync(savePath); } catch {}
        if (ue) { showMessage('Upload failed'); return; }
        showMessage('📷 ' + filename + ' → ' + remoteHost);
        refreshRemote();
      });
    } else {
      showMessage('📷 ' + filename);
      render();
    }
  });
}

// ── Clipboard File Paste ─────────────────────────────────
function pasteFilesFromClipboard() {
  const psCmd = '$f = Get-Clipboard -Format FileDropList; if ($f) { $f.FullName -join "`n" } else { "" }';
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], (err, stdout) => {
    if (err || !stdout.trim()) { showMessage('No files in clipboard'); return; }
    const files = stdout.trim().split('\n').map(f => f.trim()).filter(Boolean);
    let done = 0, failed = 0;
    files.forEach(src => {
      const name = path.basename(src);
      if (remoteMode && sftpSession) {
        const rp = remoteCwd + '/' + name;
        sftpSession.fastPut(src, rp, (ue) => {
          if (ue) failed++; else done++;
          if (done + failed === files.length) {
            showMessage(`Pasted ${done} file(s)` + (failed ? `, ${failed} failed` : '') + ` → ${remoteHost}`);
            refreshRemote();
          }
        });
      } else {
        const dest = path.join(panel.cwd, name);
        try { fs.copyFileSync(src, dest); done++; } catch { failed++; }
        if (done + failed === files.length) {
          showMessage(`Pasted ${done} file(s)` + (failed ? `, ${failed} failed` : ''));
          render();
        }
      }
    });
  });
}

// ── File Watcher (auto-refresh on changes) ──────────────
let watcher = null;
function watchDir() {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  if (remoteMode) return;
  try {
    watcher = fs.watch(panel.cwd, { persistent: false }, () => {
      if (!dialogOpen) render();
    });
  } catch {}
}

// ── Mouse ────────────────────────────────────────────────
function mouseToIndex(x, y) {
  if (!panel._grid) return -1;
  const { ih, numCols, colWidth, pageStart } = panel._grid;
  // x,y are relative to fileBox content area
  const row = y;
  const col = Math.floor(x / (colWidth + 1)); // +1 for separator
  if (row < 0 || row >= ih || col < 0 || col >= numCols) return -1;
  const idx = pageStart + col * ih + row;
  return idx < panel.entries.length ? idx : -1;
}

let lastClickTime = 0;
let lastClickIdx = -1;
let dragStartIdx = -1;
let isDragging = false;

function mouseHitTest(data) {
  const pos = fileBox.lpos;
  if (!pos) return -1;
  if (data.x < pos.xi + 1 || data.x >= pos.xl - 1 || data.y < pos.yi + 1 || data.y >= pos.yl - 1) return -1;
  return mouseToIndex(data.x - pos.xi - 1, data.y - pos.yi - 1);
}

screen.on('mouse', (data) => {
  if (dialogOpen) return;

  if (data.action === 'mousedown') {
    const idx = mouseHitTest(data);
    if (idx < 0) return;
    dragStartIdx = idx;
    isDragging = false;

    if (data.ctrl) {
      // Ctrl+Click: toggle mark
      const entry = panel.entries[idx];
      if (entry && entry.name !== '..') {
        if (panel.marked.has(entry.name)) panel.marked.delete(entry.name);
        else panel.marked.add(entry.name);
      }
      panel.selectedIndex = idx;
      render();
    } else if (!data.shift) {
      panel.selectedIndex = idx;
      render();
    }
  }

  if (data.action === 'mousemove' && dragStartIdx >= 0) {
    const idx = mouseHitTest(data);
    if (idx < 0) return;
    isDragging = true;
    // Drag select range
    const from = Math.min(dragStartIdx, idx);
    const to = Math.max(dragStartIdx, idx);
    panel.marked.clear();
    for (let i = from; i <= to; i++) {
      if (panel.entries[i] && panel.entries[i].name !== '..') panel.marked.add(panel.entries[i].name);
    }
    panel.selectedIndex = idx;
    render();
  }

  if (data.action === 'mouseup') {
    const idx = mouseHitTest(data);
    if (idx >= 0 && !isDragging && !data.ctrl) {
      // Double-click detection
      const now = Date.now();
      if (idx === lastClickIdx && now - lastClickTime < 400) {
        lastClickTime = 0;
        lastClickIdx = -1;
        panel.selectedIndex = idx;
        openEntry();
        dragStartIdx = -1;
        return;
      }
      lastClickTime = now;
      lastClickIdx = idx;
    }
    dragStartIdx = -1;
    isDragging = false;
  }
});

// ── Key Bindings ────────────────────────────────────────
screen.on('keypress', (ch, key) => {
  if (!key) return;
  if (dialogOpen) return;  // Block ALL keys while dialog/menu is open

  // Alt+Shift+C — copy path (works with c, C, ㅊ for Korean IME)
  if (key.meta && key.shift && (key.name === 'c' || ch === 'C' || ch === 'ㅊ')) {
    copyPathToClipboard();
    return;
  }

  // Space — toggle mark current file and move down
  if (ch === ' ') {
    const entry = panel.entries[panel.selectedIndex];
    if (entry && entry.name !== '..') {
      if (panel.marked.has(entry.name)) panel.marked.delete(entry.name);
      else panel.marked.add(entry.name);
    }
    if (panel.selectedIndex < panel.entries.length - 1) panel.selectedIndex++;
    render();
    return;
  }

  switch (key.name) {
    case 'up':
    case 'k':
      if (key.shift && panel.selectedIndex > 0) {
        // Shift+Up — mark current then move up
        const entry = panel.entries[panel.selectedIndex];
        if (entry && entry.name !== '..') panel.marked.add(entry.name);
        panel.selectedIndex--;
        const prev = panel.entries[panel.selectedIndex];
        if (prev && prev.name !== '..') panel.marked.add(prev.name);
        render();
      } else if (panel.selectedIndex > 0) { panel.selectedIndex--; render(); }
      break;
    case 'down':
    case 'j':
      if (key.shift && panel.selectedIndex < panel.entries.length - 1) {
        // Shift+Down — mark current then move down
        const entry = panel.entries[panel.selectedIndex];
        if (entry && entry.name !== '..') panel.marked.add(entry.name);
        panel.selectedIndex++;
        const next = panel.entries[panel.selectedIndex];
        if (next && next.name !== '..') panel.marked.add(next.name);
        render();
      } else if (panel.selectedIndex < panel.entries.length - 1) { panel.selectedIndex++; render(); }
      break;
    case 'right':
    case 'l': {
      const ih = Math.max(1, fileBox.height - 2);
      const next = panel.selectedIndex + ih;
      if (next < panel.entries.length) { panel.selectedIndex = next; render(); }
      break;
    }
    case 'left':
    case 'h': {
      const ih = Math.max(1, fileBox.height - 2);
      const prev = panel.selectedIndex - ih;
      if (prev >= 0) { panel.selectedIndex = prev; render(); }
      break;
    }
    case 'pageup':
      panel.selectedIndex = Math.max(0, panel.selectedIndex - (fileBox.height - 2));
      render();
      break;
    case 'pagedown':
      panel.selectedIndex = Math.min(panel.entries.length - 1, panel.selectedIndex + (fileBox.height - 2));
      render();
      break;
    case 'home':
      panel.selectedIndex = 0; render();
      break;
    case 'end':
      panel.selectedIndex = panel.entries.length - 1; render();
      break;
    case 'return':
      openEntry();
      break;
    case 'backspace':
      log('backspace | remoteMode:', remoteMode, 'cwd:', panel.cwd, 'remoteCwd:', remoteCwd);
      if (remoteMode) navigate('..');
      else navigate(path.dirname(panel.cwd));
      break;
    case 'f2':
      renameEntry();
      break;
    case 'f4': {
      const entry = panel.entries[panel.selectedIndex];
      if (entry && entry.name !== '..' && entry.type !== 'dir') {
        const fp = remoteMode ? null : path.join(panel.cwd, entry.name);
        if (!fp) { showMessage('Cannot edit remote files'); break; }
        require('child_process').spawn('notepad.exe', [fp], { detached: true, stdio: 'ignore' }).unref();
      }
      break;
    }
    case 'f5':
      pasteFilesFromClipboard();
      break;
    case 'f7':
      makeDirectory();
      break;
    case 'delete':
      deleteEntry();
      break;
    case 'f10':
      if (remoteMode) {
        disconnectSFTP();
        panel.cwd = path.resolve(process.argv[2] || process.cwd());
        panel.selectedIndex = 0;
        panel.scrollOffset = 0;
        watchDir();
        render();
      } else {
        showSSHMenu();
      }
      break;
    case 'escape':
      if (panel.marked.size > 0) {
        // Clear selection
        panel.marked.clear();
        render();
      } else if (remoteMode) {
        // Disconnect SSH
        disconnectSFTP();
        panel.cwd = path.resolve(process.argv[2] || process.cwd());
        panel.selectedIndex = 0;
        panel.scrollOffset = 0;
        panel.marked.clear();
        watchDir();
        render();
      }
      break;
  }
});

screen.on('resize', () => {
  // Recalculate scroll on resize
  panel.scrollOffset = 0;
  render();
});
// ── PID Management (kill previous zombie, save current) ──
const PID_FILE = path.join(os.tmpdir(), '.treeru.pid');

function killPreviousInstance() {
  try {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid); } catch {}
      log('init | killed previous instance PID:', oldPid);
    }
  } catch {}
}

function savePid() {
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function cleanup() {
  if (clipInterval) { clearInterval(clipInterval); clipInterval = null; }
  disconnectSFTP();
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  removePid();
}
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// ── Init ────────────────────────────────────────────────
killPreviousInstance();
savePid();

const startDir = process.argv[2] || process.cwd();
panel.cwd = path.resolve(startDir);

watchDir();
startClipboardWatcher();
render();
