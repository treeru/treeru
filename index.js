const blessed = require('blessed');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
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
const LOG_FILE = path.join(__dirname, 'debug.log');
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
  conn.connect({ host: info.host, port: info.port, username: info.username, privateKey });
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
const screen = blessed.screen({ smartCSR: true, title: 'TreeRU', fullUnicode: true });

// Header
const headerBar = blessed.box({
  parent: screen, top: 0, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: C.header, fg: 'white', bold: true },
});

// Main file panel (full width)
const fileBox = blessed.box({
  parent: screen, top: 1, left: 0, width: '100%', height: '100%-3',
  border: { type: 'line' }, label: ' TreeRU ', tags: true,
  scrollable: true, mouse: true,
  style: { border: { fg: C.border }, label: { fg: C.borderHi, bold: true } },
});

// Status bar
const statusBar = blessed.box({
  parent: screen, bottom: 1, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: C.header, fg: 'gray' },
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

  if (selected) {
    const bg = remoteMode ? '{#56B6C2-bg}' : '{green-bg}';
    return `{black-fg}${bg}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  return `${color}${cellContent}${' '.repeat(padLen)}{/}`;
}

function getFileInfo(fp) {
  if (remoteMode) return '';
  try {
    const s = fs.statSync(fp);
    const sz = s.isDirectory() ? '<DIR>' : formatSize(s.size);
    return `${sz}  ${s.mtime.toLocaleDateString()}`;
  } catch { return ''; }
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
  if (entry && entry.name !== '..' && !remoteMode) {
    left = ` ${getFileInfo(path.join(panel.cwd, entry.name))}`;
  } else if (remoteMode) {
    left = ` ${remoteUser}@${remoteHost}:${remoteCwd}`;
  }
  const idx = panel.entries.length > 0 ? `${panel.selectedIndex + 1}/${panel.entries.length}` : '0/0';
  const pad = Math.max(0, screen.width - left.length - idx.length - 1);
  statusBar.setContent(`${left}${' '.repeat(pad)}${idx} `);
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
}

function copyPathToClipboard() {
  const entry = panel.entries[panel.selectedIndex];
  if (!entry || entry.name === '..') return;
  const fp = remoteMode ? remoteCwd + '/' + entry.name : path.join(panel.cwd, entry.name);
  if (isWindows) {
    exec(`echo|set /p="${fp.replace(/"/g, '\\"')}" | clip`, (err) => {
      showMessage(err ? 'Copy failed' : `Copied: ${fp}`);
    });
  } else {
    exec(`echo -n "${fp}" | ${process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard'}`, () => {
      showMessage(`Copied: ${fp}`);
    });
  }
}

function makeDirectory() {
  if (remoteMode) {
    inputDialog('New folder name (remote):', '', (name) => {
      const rp = remoteCwd + '/' + name;
      sftpSession.mkdir(rp, (err) => {
        if (err) showMessage('Failed: ' + err.message);
        else refreshRemote();
      });
    });
    return;
  }
  inputDialog('New folder name:', '', (name) => {
    try { fs.mkdirSync(path.join(panel.cwd, name), { recursive: true }); render(); }
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

    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, (err, stdout) => {
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
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -dest "${savePath}"`, (err, stdout) => {
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

// ── Key Bindings ────────────────────────────────────────
screen.on('keypress', (ch, key) => {
  if (!key) return;
  if (dialogOpen) return;  // Block ALL keys while dialog/menu is open

  // Alt+Shift+C — copy path (works with c, C, ㅊ for Korean IME)
  if (key.meta && key.shift && (key.name === 'c' || ch === 'C' || ch === 'ㅊ')) {
    copyPathToClipboard();
    return;
  }

  switch (key.name) {
    case 'up':
    case 'k':
      if (panel.selectedIndex > 0) { panel.selectedIndex--; render(); }
      break;
    case 'down':
    case 'j':
      if (panel.selectedIndex < panel.entries.length - 1) { panel.selectedIndex++; render(); }
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
      if (remoteMode) {
        disconnectSFTP();
        panel.cwd = path.resolve(process.argv[2] || process.cwd());
        panel.selectedIndex = 0;
        panel.scrollOffset = 0;
        watchDir();
        render();
      } else {
        cleanup();
        process.exit(0);
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
const PID_FILE = path.join(__dirname, '.treeru.pid');

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
