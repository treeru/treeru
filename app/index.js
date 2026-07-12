// Force SGR mouse mode for Windows Terminal compatibility
process.env.BLESSED_FORCE_MODES = 'SGRMOUSE=1,CELLMOTION=1';
const blessed = require('blessed');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const APP_VERSION = (() => {
  try {
    const line = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8').split('\n')[0];
    return line.split(' - ')[0].trim();
  } catch { return '0'; }
})();
const PKG_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
})();
const { Client: SSHClient } = require('ssh2');
const { readFileSync, appendFileSync } = require('fs');

// ── Debug​ Log ───────────────────────────────────────────
const DEBUG = process.env.TREERU_DEBUG === '1';
const LOG_FILE = path.join(os.tmpdir(), 'treeru_debug.log');
function log(...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23);
  try { appendFileSync(LOG_FILE, `[${ts}] ${args.join(' ')}\n`); } catch {}
}

// ── Crash‌ handler ────────────────────────────────────────
const CRASH_LOG = path.join(os.tmpdir(), 'treeru_crash.log');
process.on('uncaughtException', (err) => {
  const ts = new Date().toISOString();
  try { appendFileSync(CRASH_LOG, `[${ts}] ${err.stack || err}\n`); } catch {}
  // A crash leaves blessed in an unknown state; rather than limp on and spew garbage,
  // restore the terminal (cleanup() disables mouse + leaves the alt-screen) and exit.
  try { cleanup(); } catch {}
  process.exit(1);
});

// ── Color​ Theme ─────────────────────────────────────────
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

// ── Stаte ───────────────────────────────────────────────
// Tabs (sessions): each tab owns an independent panel state + SSH connection.
function newSession(cwd) {
  return {
    cwd,
    entries: [],
    selectedIndex: 0,
    scrollOffset: 0,
    marked: new Set(), // multi-select: stores entry names
    // ── Remоte (SSH) State ──────────────────────────────
    remoteMode: false,
    remoteHost: '',
    remoteUser: '',
    remoteCwd: '',
    sftpConn: null,
    sftpJumpConn: null,
    sftpForwardSock: null,
    sftpSession: null,
    pendingRemote: null, // { host, path } — restored/queued SSH tab, connects on activation
    _connecting: false,
    _grid: null,
  };
}
let sessions = [newSession(process.cwd())];
let activeIdx = 0;
function cur() { return sessions[activeIdx]; }
// `panel` transparently proxies the ACTIVE session, so all synchronous UI code
// below operates on whichever tab is selected. Async flows (SFTP callbacks,
// screenshot saves) capture `const ses = cur()` up front instead, so a tab
// switch mid-operation can never corrupt another tab.
const panel = new Proxy({}, {
  get: (_, k) => cur()[k],
  set: (_, k, v) => { cur()[k] = v; return true; },
});
let dialogOpen = false;

// ── Session Persistence (zellij-style restore) ──────────
const SESSIONS_FILE = path.join(os.homedir(), '.treeru_sessions.json');

function saveSessions() {
  try {
    const tabs = sessions.map(s => {
      if (s.remoteMode) return { type: 'remote', host: s.remoteHost, path: s.remoteCwd };
      if (s.pendingRemote) return { type: 'remote', host: s.pendingRemote.host, path: s.pendingRemote.path };
      return { type: 'local', cwd: s.cwd };
    });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ active: activeIdx, tabs }, null, 2));
  } catch {}
}

function loadSessions() {
  try {
    const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
    const tabs = (Array.isArray(data.tabs) ? data.tabs : []).map(t => {
      if (t && t.type === 'remote' && t.host) {
        const s = newSession(os.homedir());
        s.pendingRemote = { host: t.host, path: t.path || '.' };
        return s;
      }
      if (t && t.type === 'local' && t.cwd) {
        try { fs.accessSync(t.cwd, fs.constants.R_OK); return newSession(t.cwd); } catch { return null; }
      }
      return null;
    }).filter(Boolean);
    if (tabs.length > 0) {
      sessions = tabs;
      activeIdx = Math.min(Math.max(0, data.active | 0), tabs.length - 1);
      return true;
    }
  } catch {}
  return false;
}

const isWindows = process.platform === 'win32';

// Escape blessed markup in any filesystem-derived string (file/folder names,
// paths, SSH hostnames) before it goes into tags:true content. Without this a
// name containing "{" is parsed as a (broken) style tag and corrupts the screen.
function esc(s) { return String(s == null ? '' : s).replace(/\{/g, '{open}'); }

// ── User Config ─────────────────────────────────────────
const CONFIG_FILE = path.join(os.homedir(), '.treeru_config.json');
function loadConfig() {
  const def = { claudeSkipPermissions: false, screenshotCopyPath: true, tabStyle: 'arrow', mouseVTFix: true, mouse: true };
  try { return Object.assign(def, JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))); } catch {}
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2)); } catch {}
  return def;
}
const config = loadConfig();
// Mouse tracking emits escape sequences the terminal forwards to whichever app is
// focused. Running TreeRU next to another full-screen TUI (zellij, tmux, vim…) in the
// same terminal window can make those sequences bleed into the other app as garbage
// text. Set "mouse": false in ~/.treeru_config.json to run TreeRU keyboard-only so it
// never emits mouse sequences — then it coexists cleanly with any other terminal app.
const MOUSE = config.mouse !== false;

// ── Claude Code Workspace ───────────────────────────────
const CLAUDE_WS_FILE = path.join(os.homedir(), '.treeru_claude.json');

function loadClaudeWorkspaces() {
  try {
    const data = JSON.parse(readFileSync(CLAUDE_WS_FILE, 'utf8'));
    // Migrate old format (plain string array) to new object format
    return data.map(item => typeof item === 'string' ? { type: 'local', path: item } : item);
  } catch { return []; }
}

function saveClaudeWorkspaces(list) {
  fs.writeFileSync(CLAUDE_WS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function findWorkspace(list, entry) {
  return list.findIndex(w =>
    w.type === entry.type && w.path === entry.path && (w.host || '') === (entry.host || '')
  );
}

function wsLabel(ws) {
  if (ws.type === 'remote') return `${ws.host}:${ws.path}`;
  return ws.path;
}

function wsMenuItem(ws) {
  if (ws.type === 'remote') return `  ${path.basename(ws.path)}  (${ws.host}:${ws.path})`;
  return `  ${path.basename(ws.path)}  (${ws.path})`;
}

function registerClaudeWorkspace() {
  const entry = panel.remoteMode
    ? { type: 'remote', host: panel.remoteHost, path: panel.remoteCwd }
    : { type: 'local', path: panel.cwd };
  const list = loadClaudeWorkspaces();
  if (findWorkspace(list, entry) !== -1) {
    showMessage(`Already registered: ${path.basename(entry.path)}`);
    return;
  }
  confirmDialog(`Register Claude workspace?\n {bold}${esc(path.basename(entry.path))}{/}  (${esc(wsLabel(entry))})`, () => {
    const fresh = loadClaudeWorkspaces();
    if (findWorkspace(fresh, entry) === -1) {
      fresh.push(entry);
      saveClaudeWorkspaces(fresh);
    }
    showMessage(`Registered: ${path.basename(entry.path)}`);
  });
}

function launchClaudeCode(ws) {
  const batFile = path.join(os.tmpdir(), 'treeru_claude.bat');
  // Opt-in via ~/.treeru_config.json: { "claudeSkipPermissions": true }
  const claudeCmd = 'claude' + (config.claudeSkipPermissions ? ' --dangerously-skip-permissions' : '');
  let cmd;
  if (ws.type === 'remote') {
    const rp = ws.path.replace(/'/g, `'\\''`);
    cmd = `wt nt cmd /k ssh -t ${ws.host} "cd '${rp}' && ${claudeCmd} || exec bash -l"`;
  } else {
    cmd = `cd /d "${ws.path.replace(/%/g, '%%')}"\r\n${claudeCmd}`;
  }
  fs.writeFileSync(batFile, `@echo off\r\n${cmd}\r\n`);
  if (ws.type === 'remote') {
    require('child_process').exec(`"${batFile}"`);
  } else {
    require('child_process').exec(`start "" "${batFile}"`);
  }
  showMessage(`Claude Code: ${wsLabel(ws)}`);
}

function showClaudeMenu() {
  const list = loadClaudeWorkspaces();
  if (list.length === 0) {
    showMessage('No workspace​ registered (F9 to register)');
    return;
  }
  dialogOpen = true;
  const listHeight = Math.min(list.length + 2, screen.height - 6);
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center',
    width: '60%', height: listHeight + 4,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: '#E5C07B' }, bg: C.header, fg: C.fg },
    label: ' Claude‌ Code ',
  });
  blessed.box({
    parent: box, bottom: 0, left: 1, right: 1, height: 1,
    tags: true, style: { bg: C.header },
    content: '{#666666-fg}Enter: Open   Del: Remove   Esc: Cancel{/}',
  });
  const menuList = blessed.list({
    parent: box, top: 0, left: 1, right: 1, height: listHeight,
    tags: false, mouse: MOUSE, keys: true,
    style: {
      fg: 'white',
      selected: { fg: 'white', bg: '#1F7A86', bold: true },
    },
    items: list.map(wsMenuItem),
  });
  const cleanup = () => {
    menuList.removeAllListeners();
    box.destroy();
    screen.alloc();
  };
  menuList.on('select', (item, idx) => {
    cleanup();
    render();
    setTimeout(() => { dialogOpen = false; launchClaudeCode(list[idx]); }, 50);
  });
  menuList.on('cancel', () => {
    cleanup();
    render();
    setTimeout(() => { dialogOpen = false; }, 50);
  });
  menuList.key(['left', 'right'], () => {}); // absorb arrow keys
  menuList.key('escape', () => {
    cleanup();
    render();
    setTimeout(() => { dialogOpen = false; }, 50);
  });
  menuList.key('delete', () => {
    const idx = menuList.selected;
    list.splice(idx, 1);
    saveClaudeWorkspaces(list);
    if (list.length === 0) {
      cleanup();
      showMessage('All workspaces‌ removed');
      return;
    }
    menuList.setItems(list.map(wsMenuItem));
    menuList.select(Math.min(idx, list.length - 1));
    screen.render();
  });
  menuList.focus();
  screen.render();
}

// ── Bookmarks (F8) ──────────────────────────────────────
const BOOKMARKS_FILE = path.join(os.homedir(), '.treeru_bookmarks.json');
function loadBookmarks() { try { const d = JSON.parse(readFileSync(BOOKMARKS_FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } }
function saveBookmarks(list) { try { fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(list, null, 2)); } catch {} }

function bmOf(ses) {
  return ses.remoteMode
    ? { type: 'remote', host: ses.remoteHost, path: ses.remoteCwd }
    : { type: 'local', path: ses.cwd };
}
function bmSame(a, b) { return a.type === b.type && a.path === b.path && (a.host || '') === (b.host || ''); }
function bmMenuItem(bm) {
  const base = bm.type === 'remote'
    ? ((bm.path || '/').split('/').filter(Boolean).pop() || '/')
    : (path.basename(bm.path) || bm.path);
  const tag = bm.type === 'remote' ? `${bm.host}:${base}` : base;
  const full = bm.type === 'remote' ? `${bm.host}:${bm.path}` : bm.path;
  return `  ★ ${esc(tag)}   {#9BA3B4-fg}(${esc(full)}){/}`;
}

function addCurrentBookmark(silent) {
  const bm = bmOf(cur());
  const list = loadBookmarks();
  if (list.some(b => bmSame(b, bm))) { if (!silent) showMessage('Already bookmarked'); return false; }
  list.push(bm);
  saveBookmarks(list);
  if (!silent) showMessage(`★ Added: ${bm.type === 'remote' ? bm.host + ':' : ''}${path.basename(bm.path) || bm.path}`);
  return true;
}

// Open a bookmark in the CURRENT tab (like following a browser bookmark)
function openBookmark(bm) {
  const ses = cur();
  if (bm.type === 'local') {
    if (ses.remoteMode) disconnectSFTP(ses);
    try {
      fs.accessSync(bm.path, fs.constants.R_OK);
      ses.cwd = path.resolve(bm.path);
      ses.selectedIndex = 0; ses.scrollOffset = 0; ses.marked.clear();
      watchDir(); saveSessions(); render();
    } catch { showMessage('Path not found: ' + bm.path); }
    return;
  }
  // remote: (re)connect this tab to the bookmarked host + path
  disconnectSFTP(ses);
  ses._connecting = true;
  render();
  showMessage(`Connecting to ${bm.host}...`);
  connectSFTP(ses, bm.host, (err) => {
    ses._connecting = false;
    if (err) {
      ses.cwd = os.homedir();
      showMessage(`SSH failed: ${err.message}`);
      saveSessions(); if (ses === cur()) render();
      return;
    }
    ses.remoteMode = true;
    ses.remoteCwd = bm.path || '.';
    refreshRemote(ses, (e2) => {
      if (e2) { // bookmarked path is gone — fall back to home directory
        ses.sftpSession.realpath('.', (e3, hp) => {
          ses.remoteCwd = e3 ? '/home/' + ses.remoteUser : hp;
          refreshRemote(ses, () => saveSessions());
          showMessage('Bookmarked path missing — opened home');
        });
      } else saveSessions();
    });
  });
}

function showBookmarks() {
  dialogOpen = true;
  const build = () => {
    const list = loadBookmarks();
    const items = [`  {#E5C07B-fg}➕ Add current folder{/}   {#9BA3B4-fg}(${bmMenuItem(bmOf(cur())).replace(/^\s*★\s*/, '').trim()}){/}`,
      ...list.map(bmMenuItem)];
    return { list, items };
  };
  let { list, items } = build();
  const listHeight = Math.min(items.length + 1, screen.height - 6);
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center',
    width: '70%', height: listHeight + 4,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: '#E5C07B' }, bg: C.header, fg: C.fg },
    label: ' ★ Bookmarks ',
  });
  blessed.box({
    parent: box, bottom: 0, left: 1, right: 1, height: 1,
    tags: true, style: { bg: C.header },
    content: '{#666666-fg}Enter: Open   Del: Remove   Esc: Cancel{/}',
  });
  const menuList = blessed.list({
    parent: box, top: 0, left: 1, right: 1, height: listHeight,
    tags: true, mouse: MOUSE, keys: true,
    style: { fg: 'white', selected: { fg: 'white', bg: '#1F7A86', bold: true } },
    items,
  });
  const cleanup = () => { menuList.removeAllListeners(); box.destroy(); screen.alloc(); };
  menuList.on('select', (item, idx) => {
    if (idx === 0) { // "Add current folder"
      const added = addCurrentBookmark(true);
      const rebuilt = build(); list = rebuilt.list;
      menuList.setItems(rebuilt.items);
      menuList.select(added ? rebuilt.items.length - 1 : 0);
      showMessage(added ? '★ Added' : 'Already bookmarked');
      screen.render();
      return;
    }
    cleanup(); render();
    setTimeout(() => { dialogOpen = false; openBookmark(list[idx - 1]); }, 50);
  });
  const close = () => { cleanup(); render(); setTimeout(() => { dialogOpen = false; }, 50); };
  menuList.on('cancel', close);
  menuList.key('escape', close);
  menuList.key(['left', 'right'], () => {});
  menuList.key('delete', () => {
    const idx = menuList.selected;
    if (idx === 0) return; // can't delete the add-row
    list.splice(idx - 1, 1);
    saveBookmarks(list);
    const rebuilt = build(); list = rebuilt.list;
    menuList.setItems(rebuilt.items);
    menuList.select(Math.min(idx, rebuilt.items.length - 1));
    screen.render();
  });
  menuList.focus();
  screen.render();
}

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
    proxyJump: c.proxyjump || '',
  };
}

function parseProxyJump(spec) {
  const value = String(spec || '').trim();
  if (!value || value.toLowerCase() === 'none') return null;
  if (value.includes(',')) throw new Error('Multiple ProxyJump hops are not supported');
  const m = value.match(/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m) throw new Error(`Invalid ProxyJump: ${value}`);
  const alias = m[2].replace(/^\[|\]$/g, '');
  const info = getSSHInfo(alias);
  if (info.proxyJump && info.proxyJump.toLowerCase() !== 'none') {
    throw new Error('Nested ProxyJump is not supported');
  }
  if (m[1]) info.username = m[1];
  // An explicit hostname in ProxyJump may not have its own Host block.
  if (!sshConfig[alias]) info.host = alias;
  if (m[3]) info.port = parseInt(m[3], 10);
  return { alias, ...info };
}

function loadSSHKey(identityFile) {
  const keyPath = identityFile.replace(/^~/, os.homedir()).replace(/"/g, '');
  try { return { privateKey: readFileSync(keyPath), keyPath }; }
  catch {
    for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
      const fallback = path.join(os.homedir(), '.ssh', name);
      try { return { privateKey: readFileSync(fallback), keyPath: fallback }; } catch {}
    }
  }
  throw new Error('No SSH key found');
}

function hostVerifierFor(host, port, onMismatch) {
  return (hash) => {
    const id = `${host}:${port}`;
    const known = loadHostKeys();
    if (!known[id]) { known[id] = hash; saveHostKeys(known); return true; }
    if (known[id] === hash) return true;
    onMismatch();
    return false;
  };
}

// ── SFTP ────────────────────────────────────────────────
// Pinned host key hashes (trust-on-first-use)
const HOST_KEYS_FILE = path.join(os.homedir(), '.treeru_hosts.json');
function loadHostKeys() { try { return JSON.parse(readFileSync(HOST_KEYS_FILE, 'utf8')); } catch { return {}; } }
function saveHostKeys(k) { try { fs.writeFileSync(HOST_KEYS_FILE, JSON.stringify(k, null, 2)); } catch {} }

function connectSFTP(ses, alias, callback) {
  const info = getSSHInfo(alias);
  let targetKey, jumpInfo, jumpKey;
  try {
    targetKey = loadSSHKey(info.identityFile);
    jumpInfo = parseProxyJump(info.proxyJump);
    if (jumpInfo) jumpKey = loadSSHKey(jumpInfo.identityFile);
  } catch (err) { callback(err); return; }
  log('SFTP | connect', alias, info.host, info.port, info.username, targetKey.keyPath,
    jumpInfo ? `via ${jumpInfo.alias}` : 'direct');

  const conn = new SSHClient();
  // Track the socket immediately so disconnectSFTP can tear it down even if the
  // tab is closed while still connecting (otherwise the socket leaks forever).
  ses.sftpConn = conn;
  let hostKeyMismatch = false;
  let jumpHostKeyMismatch = false;
  let jump = null;
  let settled = false;
  const finish = (err) => {
    if (settled) return;
    settled = true;
    if (err) {
      try { conn.end(); } catch {}
      if (ses.sftpForwardSock) { try { ses.sftpForwardSock.destroy(); } catch {} ses.sftpForwardSock = null; }
      if (jump) { try { jump.end(); } catch {} }
    }
    callback(err || null);
  };
  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) { finish(err); return; }
      ses.sftpConn = conn;
      ses.sftpSession = sftp;
      ses.remoteHost = alias;
      ses.remoteUser = info.username;
      finish(null);
    });
  });
  conn.on('error', (err) => {
    log('SFTP | connection error:', err.message);
    finish(hostKeyMismatch
      ? new Error('Host key​ changed! If expected, remove it from ~/.treeru_hosts.json')
      : err);
  });
  conn.on('close', () => {
    log('SFTP | connection closed');
    if (ses.sftpConn === conn) { // clear only if this session still owns this connection
      ses.sftpConn = null;
      ses.sftpSession = null;
      if (ses.sftpForwardSock) { try { ses.sftpForwardSock.destroy(); } catch {} ses.sftpForwardSock = null; }
      if (ses.sftpJumpConn) { try { ses.sftpJumpConn.end(); } catch {} ses.sftpJumpConn = null; }
    }
  });
  const targetOptions = {
    host: info.host,
    port: info.port,
    username: info.username,
    privateKey: targetKey.privateKey,
    hostHash: 'sha256',
    hostVerifier: hostVerifierFor(info.host, info.port, () => { hostKeyMismatch = true; }),
  };

  if (!jumpInfo) { conn.connect(targetOptions); return; }

  jump = new SSHClient();
  ses.sftpJumpConn = jump;
  jump.on('ready', () => {
    log('SFTP | ProxyJump ready:', jumpInfo.alias);
    jump.forwardOut('127.0.0.1', 0, info.host, info.port, (err, sock) => {
      if (err) { finish(err); jump.end(); return; }
      ses.sftpForwardSock = sock;
      conn.connect({ ...targetOptions, sock });
    });
  });
  jump.on('error', (err) => {
    log('SFTP | ProxyJump error:', err.message);
    finish(jumpHostKeyMismatch
      ? new Error('ProxyJump host key changed! If expected, remove it from ~/.treeru_hosts.json')
      : new Error(`ProxyJump ${jumpInfo.alias}: ${err.message}`));
  });
  jump.on('close', () => {
    if (ses.sftpJumpConn === jump) ses.sftpJumpConn = null;
  });
  jump.connect({
    host: jumpInfo.host,
    port: jumpInfo.port,
    username: jumpInfo.username,
    privateKey: jumpKey.privateKey,
    hostHash: 'sha256',
    hostVerifier: hostVerifierFor(jumpInfo.host, jumpInfo.port, () => { jumpHostKeyMismatch = true; }),
  });
}

function disconnectSFTP(ses) {
  if (ses.sftpConn) { try { ses.sftpConn.end(); } catch {} }
  if (ses.sftpForwardSock) { try { ses.sftpForwardSock.destroy(); } catch {} }
  if (ses.sftpJumpConn) { try { ses.sftpJumpConn.end(); } catch {} }
  ses.sftpConn = null; ses.sftpSession = null;
  ses.sftpForwardSock = null; ses.sftpJumpConn = null;
  ses.remoteMode = false; ses.remoteHost = ''; ses.remoteUser = ''; ses.remoteCwd = '';
  ses.pendingRemote = null;
}

// ── Directory Reading ───────────────────────────────────
function readLocalDir(dirPath) {
  try {
    const raw = fs.readdirSync(dirPath, { withFileTypes: true });
    const entries = raw.map(d => {
      let type = d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'symlink' : 'file';
      const link = d.isSymbolicLink();
      // Follow a symlink to see if it points at a directory — if so treat it as a
      // navigable folder (otherwise a dir-symlink like treeweb → /data2/treeweb
      // shows as a file and can't be entered).
      if (link) {
        try { if (fs.statSync(path.join(dirPath, d.name)).isDirectory()) type = 'dir'; } catch {}
      }
      return { name: d.name, type, link, hidden: d.name.startsWith('.') };
    });
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

function readRemoteDir(ses, dirPath, callback) {
  if (!ses.sftpSession) { callback([], 'No SFTP session'); return; }
  const p = dirPath.replace(/\\/g, '/') || '/';
  log('readRemoteDir |', p, 'host:', ses.remoteHost);
  ses.sftpSession.readdir(p, (err, list) => {
    if (err) {
      log('readRemoteDir | ERROR:', err.message);
      callback([{ name: '..', type: 'dir', hidden: false }], err.message);
      return;
    }
    const entries = list.map(item => {
      let type = 'file';
      if (item.longname && item.longname[0] === 'd') type = 'dir';
      else if (item.longname && item.longname[0] === 'l') type = 'symlink';
      return { name: item.filename, type, link: type === 'symlink', hidden: item.filename.startsWith('.') };
    });
    const finish = () => {
      entries.sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      if (p !== '/') entries.unshift({ name: '..', type: 'dir', hidden: false });
      callback(entries, null);
    };
    // Resolve symlink targets: sftp.stat follows the link, so a dir-symlink
    // (e.g. treeweb -> /data2/treeweb) becomes a navigable 'dir' instead of a file.
    const links = entries.filter(e => e.type === 'symlink');
    if (links.length === 0) { finish(); return; }
    let pending = links.length;
    links.forEach(e => {
      ses.sftpSession.stat(p.replace(/\/+$/, '') + '/' + e.name, (serr, st) => {
        try { if (!serr && st && st.isDirectory()) e.type = 'dir'; } catch {}
        if (--pending === 0) finish();
      });
    });
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
// Zero-width: combining marks, ZWJ, variation selectors (VS16 etc), BOM/ZWSP —
// these attach to the previous glyph and must not add column width.
function isZeroWidth(code) {
  return (code >= 0x0300 && code <= 0x036F) || code === 0x200B || code === 0x200C ||
    code === 0x200D || (code >= 0xFE00 && code <= 0xFE0F) || code === 0xFEFF ||
    (code >= 0x1AB0 && code <= 0x1AFF) || (code >= 0x20D0 && code <= 0x20FF);
}
function strWidth(s) {
  let w = 0;
  for (const c of s) { const cp = c.codePointAt(0); if (isZeroWidth(cp)) continue; w += isWide(cp) ? 2 : 1; }
  return w;
}
function padW(s, tw) { const w = strWidth(s); return w >= tw ? s : s + ' '.repeat(tw - w); }
function truncW(s, tw) {
  let w = 0, i = 0;
  for (const c of s) {
    const cp = c.codePointAt(0);
    const cw = isZeroWidth(cp) ? 0 : (isWide(cp) ? 2 : 1);
    if (w + cw > tw - 1) return s.slice(0, i) + '…';
    w += cw; i += c.length;
  }
  return s;
}

// ── Screen ──────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'Tree​RU', fullUnicode: true, mouse: MOUSE });

// Header
const headerBar = blessed.box({
  parent: screen, top: 0, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: C.header, fg: 'white', bold: true },
});

// Tab bar (one line under the header)
const tabBar = blessed.box({
  parent: screen, top: 1, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: '#10101E' },
});

// Main file panel (full width)
const fileBox = blessed.box({
  parent: screen, top: 2, left: 0, width: '100%', height: '100%-6',
  border: { type: 'line' }, label: ' TreeRU ', tags: true,
  scrollable: true, mouse: MOUSE, clickable: MOUSE,
  style: { border: { fg: C.border }, label: { fg: C.borderHi, bold: true } },
});

// Function key bar (bottom, 2 lines)
const fnBar = blessed.box({
  parent: screen, bottom: 2, left: 0, width: '100%', height: 2,
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

// ── Tabs ────────────────────────────────────────────────
let tabHits = []; // clickable x-ranges on the tab bar

// Human name for a tab. pendingRemote (a restored SSH tab that hasn't connected
// yet) carries its saved path — show the real folder name, not "host:…".
function tabName(s) {
  if (s.remoteMode) {
    const base = (s.remoteCwd || '/').split('/').filter(Boolean).pop() || '/';
    return `${s.remoteHost}:${base}`;
  }
  if (s.pendingRemote) {
    const p = String(s.pendingRemote.path || '');
    const base = (p && p !== '.') ? (p.split('/').filter(Boolean).pop() || '~') : '~';
    return `${s.pendingRemote.host}:${base}`;
  }
  return path.basename(s.cwd) || s.cwd;
}

function renderTabBar() {
  tabHits = [];
  const n = sessions.length;
  const scrW = (screen.width || 120);
  const useArrows = config.tabStyle !== 'chip'; // powerline-glyph fallback for fonts without E0B0
  const ARROW = '\uE0B0'; // powerline right-arrow (PL/Nerd font; config tabStyle:'chip' to opt out)
  const perOverhead = useArrows ? 3 : 6; // " label " padding(2)+arrow(1) | padding(4)+gap(2)
  const names = sessions.map((s, i) => `${i + 1}:${tabName(s)}`);

  // Need-based responsive width: everyone keeps their natural width when the row
  // fits; only when over budget, shrink the cap (36 → 8) until it fits. So with
  // few tabs / wide screens nothing is ever truncated.
  let cap = 36;
  for (; cap > 8; cap--) {
    let tot = 5; // " + " chip + lead slack
    for (const nm of names) tot += Math.min(strWidth(nm), cap) + perOverhead;
    if (tot <= scrW) break;
  }

  let x = 0, out = '';
  sessions.forEach((s, i) => {
    const nm = strWidth(names[i]) > cap ? truncW(names[i], cap) : names[i];
    const remote = s.remoteMode || s.pendingRemote;
    // Active: white bold on deep solid fill (teal=remote, amber=local) — deep bg keeps
    // white high-contrast; bold-dark-on-bright grays out on some terminals (1088).
    const bg = i === activeIdx ? (remote ? '#1F7A86' : '#9A6E14') : '#3A3A56';
    const fg = i === activeIdx ? 'white' : (remote ? '#8FE0EA' : '#E8E8E8');
    const bold = i === activeIdx ? '{bold}' : '';

    if (useArrows) {
      // Zellij-style ribbon: segments joined by powerline arrows (E0B0).
      const label = ` ${nm} `;
      const w = strWidth(label);
      const nextBg = i < n - 1
        ? (i + 1 === activeIdx ? ((sessions[i + 1].remoteMode || sessions[i + 1].pendingRemote) ? '#1F7A86' : '#9A6E14') : '#3A3A56')
        : '#10101E';
      out += `{${fg}-fg}{${bg}-bg}${bold}${esc(label)}{/}`;
      out += `{${bg}-fg}{${nextBg}-bg}${ARROW}{/}`;
      tabHits.push({ x0: x, x1: x + w, idx: i }); // arrow col included in the hit area
      x += w + 1;
    } else {
      const label = `  ${nm}  `;
      const w = strWidth(label);
      out += `{${fg}-fg}{${bg}-bg}${bold}${esc(label)}{/}`;
      out += '{#10101E-bg}  {/}';
      tabHits.push({ x0: x, x1: x + w - 1, idx: i });
      x += w + 2;
    }
  });
  if (useArrows) { out += '{#10101E-bg} {/}'; x += 1; }
  tabHits.push({ x0: x, x1: x + 4, idx: 'new' });
  out += '{white-fg}{#9A6E14-bg}{bold} + {/}';
  tabBar.setContent(out);
}

function addSession(ses) {
  sessions.push(ses);
  activeIdx = sessions.length - 1;
  watchDir();
  saveSessions();
  render();
}

function switchTab(idx) {
  if (idx < 0 || idx >= sessions.length || idx === activeIdx) return;
  activeIdx = idx;
  watchDir();
  saveSessions();
  render();
  activatePendingRemote(); // restored SSH tabs connect lazily, on first activation
}

function closeTab(idx) {
  if (sessions.length <= 1) { showMessage('Last tab — cannot close'); return; }
  const [closed] = sessions.splice(idx, 1);
  disconnectSFTP(closed);
  if (activeIdx >= sessions.length) activeIdx = sessions.length - 1;
  else if (idx < activeIdx) activeIdx--;
  watchDir();
  saveSessions();
  render();
}

// New-tab picker: duplicate current, local home, or connect straight to an SSH host
// Open a bookmark as a brand-new tab (used by the new-tab picker)
function openBookmarkAsTab(bm) {
  if (bm.type === 'remote') {
    const s = newSession(os.homedir());
    s.pendingRemote = { host: bm.host, path: bm.path || '.' };
    addSession(s);
    activatePendingRemote();
  } else {
    let dir = bm.path;
    try { fs.accessSync(dir, fs.constants.R_OK); } catch { dir = os.homedir(); showMessage('Path not found — opened home'); }
    addSession(newSession(dir));
  }
}

// Small reusable single-select menu. rows: [{ label, onSelect }]. Supports Del per-row.
function pickerMenu(title, rows, opts) {
  opts = opts || {};
  dialogOpen = true;
  const listHeight = Math.min(rows.length + 2, screen.height - 6);
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center',
    width: opts.width || '60%', height: listHeight + 2,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: '#E5C07B' }, bg: C.header, fg: C.fg },
    label: ` ${title} `,
  });
  const list = blessed.list({
    parent: box, top: 0, left: 1, right: 1, height: listHeight,
    tags: true, mouse: MOUSE, keys: true,
    style: { fg: 'white', selected: { fg: 'white', bg: '#1F7A86', bold: true } },
    items: rows.map(r => r.label),
  });
  const close = () => { list.removeAllListeners(); box.destroy(); screen.alloc(); };
  list.on('select', (item, idx) => {
    close(); dialogOpen = false;
    process.nextTick(() => rows[idx] && rows[idx].onSelect());
  });
  const cancel = () => { close(); dialogOpen = false; if (opts.onCancel) opts.onCancel(); else render(); };
  list.on('cancel', cancel);
  list.key('escape', cancel);
  if (opts.onDelete) {
    list.key('delete', () => {
      const idx = list.selected;
      if (opts.onDelete(idx)) cancel(); // returns true → close/refresh externally
    });
  }
  list.focus();
  screen.render();
}

// Bookmark folder inside the new-tab picker: pick one to open as a new tab
function showBookmarkFolder() {
  const list = loadBookmarks();
  if (list.length === 0) { showMessage('No bookmarks yet — press F8 to add'); return; }
  const rows = list.map(bm => ({
    label: bmMenuItem(bm),
    onSelect: () => openBookmarkAsTab(bm),
  }));
  pickerMenu(`★ Bookmarks (${list.length})`, rows, {
    width: '70%',
    onCancel: () => showNewTabDialog(), // Esc → back to the new-tab menu
    onDelete: (idx) => { const l = loadBookmarks(); l.splice(idx, 1); saveBookmarks(l); showBookmarkFolder(); return true; },
  });
}

function showNewTabDialog() {
  const hosts = Object.keys(sshConfig).filter(h => !h.includes('*') && !h.includes('?'));
  const base = cur();
  const hereLabel = base.remoteMode ? `${base.remoteHost}:${base.remoteCwd}` : base.cwd;
  const bmCount = loadBookmarks().length;
  const rows = [
    { label: `  📁 Duplicate current tab  {#9BA3B4-fg}(${esc(hereLabel)}){/}`, onSelect: () => {
      if (base.remoteMode) {
        const s = newSession(os.homedir());
        s.pendingRemote = { host: base.remoteHost, path: base.remoteCwd };
        addSession(s); activatePendingRemote();
      } else addSession(newSession(base.cwd));
    } },
    { label: `  🏠 Local home  {#9BA3B4-fg}(${esc(os.homedir())}){/}`, onSelect: () => addSession(newSession(os.homedir())) },
    { label: `  ★ Bookmarks ▸  {#9BA3B4-fg}(${bmCount}){/}`, onSelect: () => showBookmarkFolder() },
    ...hosts.map(h => {
      const info = getSSHInfo(h);
      return { label: `  🔗 ${esc(h)}  {#9BA3B4-fg}(${esc(info.username)}@${esc(info.host)}){/}`, onSelect: () => {
        const s = newSession(os.homedir());
        s.pendingRemote = { host: h, path: '.' };
        addSession(s); activatePendingRemote();
      } };
    }),
  ];
  pickerMenu('New Tab', rows);
}

// ── File‍ Icons ──────────────────────────────────────────
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
  if (entry.type === 'dir') {
    // '~' marks a directory reached through a symlink (e.g. treeweb → /data2/treeweb)
    icon = entry.link ? '~' : '>';
    color = '{cyan-fg}{bold}';
  }
  else if (entry.type === 'symlink') { icon = '~'; color = '{magenta-fg}'; }
  else { icon = ' '; color = '{white-fg}'; }

  let display = entry.name;
  if (strWidth(display) > maxW) display = truncW(display, maxW);
  display = padW(display, maxW);
  const cellW = 3 + strWidth(display); // visible width (before markup-escaping)
  display = esc(display);

  const cellContent = ` ${icon} ${display}`;
  const padLen = Math.max(0, colWidth - cellW);

  if (selected && marked) {
    return `{black-fg}{yellow-bg}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  if (selected) {
    const bg = panel.remoteMode ? '{#56B6C2-bg}' : '{green-bg}';
    return `{black-fg}${bg}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  if (marked) {
    return `{yellow-fg}{bold}${cellContent}${' '.repeat(padLen)}{/}`;
  }
  return `${color}${cellContent}${' '.repeat(padLen)}{/}`;
}

function getFileInfo(name, fp) {
  if (panel.remoteMode) return name;
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

// ── Rеndering ───────────────────────────────────────────
function renderPanel() {
  if (panel.remoteMode) {
    fileBox.style.border.fg = C.remote;
    fileBox.style.label.fg = C.remote;
  } else {
    fileBox.style.border.fg = C.border;
    fileBox.style.label.fg = C.borderHi;
  }

  if (!panel.remoteMode) panel.entries = readLocalDir(panel.cwd);

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
  fileBox.setLabel(` ${esc(cwd)} `);

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
  const title = PKG_VERSION ? `  TreeRU v${PKG_VERSION} (${APP_VERSION})` : `  TreeRU v${APP_VERSION}`;
  let right = '';
  if (panel.remoteMode) {
    right = `{#56B6C2-fg}[ SSH: ${esc(panel.remoteHost)} ]{/} `;
  } else {
    const hostCount = Object.keys(sshConfig).length;
    right = hostCount > 0 ? `{${C.dim}-fg}${hostCount} SSH hosts{/} ` : '';
  }
  const rightFull = right;
  const pad = Math.max(0, screen.width - title.length - rightFull.replace(/\{[^}]*\}/g, '').length);
  headerBar.setContent(`{bold}{cyan-fg}${title}{/}${' '.repeat(pad)}${rightFull}`);
}

let shotShown = false; // whether the 📷 active-instance marker is currently displayed

function renderStatus() {
  const entry = panel.entries[panel.selectedIndex];
  let left = '';
  if (entry && entry.name !== '..') {
    if (panel.remoteMode) {
      left = ` ${entry.name}`;
    } else {
      left = ` ${getFileInfo(entry.name, path.join(panel.cwd, entry.name))}`;
    }
  }
  // 📷 = this instance saves clipboard screenshots (the one you last interacted with)
  shotShown = isWindows && isActiveInstance();
  const shot = shotShown ? '📷 ' : '';
  const markedInfo = panel.marked.size > 0 ? `[${panel.marked.size} selected] ` : '';
  const idx = panel.entries.length > 0 ? `${shot}${markedInfo}${panel.selectedIndex + 1}/${panel.entries.length}` : `${shot}0/0`;
  const pad = Math.max(0, screen.width - left.length - idx.length - 1);
  statusBar.setContent(`${esc(left)}${' '.repeat(pad)}${idx} `);
}

function renderFnBar() {
  const row1 = [
    '{white-fg}{bold}Enter{/}{#87AFD7-fg} Open/View{/}',
    '{white-fg}{bold}Space{/}{#87AFD7-fg} Select{/}',
    '{white-fg}{bold}F2{/}{#87AFD7-fg} Rename{/}',
    '{white-fg}{bold}F4{/}{#87AFD7-fg} Edit{/}',
    '{white-fg}{bold}F5{/}{#87AFD7-fg} Paste{/}',
    '{white-fg}{bold}F7{/}{#87AFD7-fg} NewDir{/}',
    '{white-fg}{bold}D{/}{#87AFD7-fg} Download{/}',
    '{white-fg}{bold}Del{/}{#87AFD7-fg} Recycle{/}',
  ];
  const row2 = [
    '{white-fg}{bold}T{/}{#E5C07B-fg} NewTab{/}',
    '{white-fg}{bold}W{/}{#E5C07B-fg} CloseTab{/}',
    '{white-fg}{bold}Tab{/}{#E5C07B-fg} Switch{/}',
    '{white-fg}{bold}F8{/}{#E5C07B-fg} Bookmark{/}',
    '{white-fg}{bold}F9{/}{#E5C07B-fg} Claude+{/}',
    '{white-fg}{bold}F10{/}{#87AFD7-fg} SSH{/}',
    '{white-fg}{bold}F12{/}{#E5C07B-fg} Claude{/}',
    '{white-fg}{bold}F6{/}{#87AFD7-fg} CopyPath{/}',
    '{white-fg}{bold}PrtSc{/}{#87AFD7-fg} Screenshot{/}',
  ];
  fnBar.setContent(` ${row1.join('  ')}\n ${row2.join('  ')}`);
}

function renderPathBar() {
  let prompt;
  if (panel.remoteMode) {
    prompt = `${panel.remoteUser}@${panel.remoteHost}:${panel.remoteCwd}>`;
  } else {
    prompt = `${panel.cwd}>`;
  }
  pathBar.setContent(prompt);
}

function render() {
  renderPanel();
  renderHeader();
  renderTabBar();
  renderStatus();
  renderFnBar();
  renderPathBar();
  screen.render();

  // Position cursor at end of path prompt (must be after screen.render)
  if (!dialogOpen) {
    const prompt = pathBar.getContent();
    const absX = pathBar.aleft + blessed.unicode.strWidth(prompt);
    const absY = pathBar.atop;
    screen.program.move(absX, absY);
    screen.program.showCursor();
  }
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
  input.on('submit', (v) => { form.destroy(); screen.alloc(); render(); setTimeout(() => { dialogOpen = false; if (v) callback(v); }, 50); });
  input.on('cancel', () => { form.destroy(); screen.alloc(); render(); setTimeout(() => { dialogOpen = false; }, 50); });
  input.focus();
  screen.render();
  // Move cursor to end of input text
  setTimeout(() => {
    const val = defaultVal || '';
    const absX = input.aleft + blessed.unicode.strWidth(val);
    const absY = input.atop;
    screen.program.move(absX, absY);
    screen.program.showCursor();
  }, 10);
}

function confirmDialog(msg, callback, extraKeyHandler) {
  dialogOpen = true;
  const hasCustomMsg = msg.includes('\n');
  const contentLines = hasCustomMsg ? msg : `\n ${msg}\n\n {green-fg}Enter/Y{/} = Confirm   {red-fg}Esc/N{/} = Cancel`;
  const height = hasCustomMsg ? 7 : 6;
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center', width: '50%', height: height,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: 'red' }, bg: C.header, fg: C.fg },
    label: ' Con‌firm ',
    content: hasCustomMsg ? `\n ${contentLines}` : contentLines,
  });
  const closeBox = () => { screen.removeListener('keypress', h); box.destroy(); screen.alloc(); render(); };
  const h = (ch, key) => {
    if (!key) return;
    if (extraKeyHandler) {
      const result = extraKeyHandler(ch, key);
      if (typeof result === 'function') {
        closeBox(); setTimeout(() => { dialogOpen = false; result(); }, 50);
        return;
      }
    }
    if (key.name === 'y' || key.name === 'enter' || key.name === 'return') {
      closeBox(); setTimeout(() => { dialogOpen = false; callback(); }, 50);
    } else if (key.name === 'n' || key.name === 'escape') {
      closeBox(); setTimeout(() => { dialogOpen = false; }, 50);
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
    content: esc(msg), // callers pass plain text (filenames/errors), never markup
  });
  screen.render();
  setTimeout(() => { m.destroy(); screen.alloc(); render(); }, 1500);
}

// ── SSH Connection Menu ─────────────────────────────────
function showSSHMenu() {
  // Filter out wildcards and patterns
  const hosts = Object.keys(sshConfig).filter(h => !h.includes('*') && !h.includes('?'));
  if (hosts.length === 0) {
    showMessage('No SSH hosts‌ found in ~/.ssh/config');
    return;
  }

  dialogOpen = true;
  const listHeight = Math.min(hosts.length + 2, screen.height - 6);
  const box = blessed.box({
    parent: screen, top: 'center', left: 'center',
    width: '50%', height: listHeight + 2,
    border: { type: 'line' }, tags: true,
    style: { border: { fg: C.remote }, bg: C.header, fg: C.fg },
    label: ' SS​H Connect ',
  });

  const list = blessed.list({
    parent: box, top: 0, left: 1, right: 1, height: listHeight,
    tags: false, mouse: MOUSE, keys: true,
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
    screen.alloc();
    dialogOpen = false;
    log('SSH menu | selected idx:', idx, 'alias:', alias, 'host:', info.host);
    // Use nextTick to avoid Enter key bleeding through
    process.nextTick(() => connectToSSH(alias));
  });

  list.on('cancel', () => {
    list.removeAllListeners();
    box.destroy();
    screen.alloc();
    dialogOpen = false;
    render();
  });

  list.focus();
  screen.render();
}

function connectToSSH(alias) {
  log('connectToSSH | alias:', alias);
  const ses = cur();
  if (ses._connecting) return; // guard against a second connect racing on the same tab
  ses._connecting = true;
  showMessage(`Connecting to ${alias}...`);
  connectSFTP(ses, alias, (err) => {
    ses._connecting = false;
    if (err) {
      showMessage(`SSH failed: ${err.message}`);
      return;
    }
    ses.remoteMode = true;
    // Resolve home directory
    ses.sftpSession.realpath('.', (err2, homePath) => {
      ses.remoteCwd = err2 ? '/home/' + ses.remoteUser : homePath;
      refreshRemote(ses, () => saveSessions());
    });
  });
}

// Connect a tab that was restored (or opened) as a queued SSH session
function activatePendingRemote() {
  const ses = cur();
  if (!ses.pendingRemote || ses.remoteMode || ses._connecting) return;
  const { host, path: rpath } = ses.pendingRemote;
  ses._connecting = true;
  showMessage(`Connecting to ${host}...`);
  connectSFTP(ses, host, (err) => {
    ses._connecting = false;
    if (err) {
      ses.pendingRemote = null;
      ses.cwd = os.homedir();
      showMessage(`SSH failed: ${err.message}`);
      saveSessions();
      if (ses === cur()) render();
      return;
    }
    ses.pendingRemote = null;
    ses.remoteMode = true;
    const finish = () => refreshRemote(ses, () => saveSessions());
    if (rpath && rpath !== '.') { ses.remoteCwd = rpath; finish(); }
    else ses.sftpSession.realpath('.', (e2, hp) => { ses.remoteCwd = e2 ? '/home/' + ses.remoteUser : hp; finish(); });
  });
}

function refreshRemote(ses, callback) {
  readRemoteDir(ses, ses.remoteCwd, (entries, err) => {
    if (err) {
      log('refreshRemote | error:', err);
      if (callback) callback(err);
      return;
    }
    ses.entries = entries;
    ses.cwd = `${ses.remoteUser}@${ses.remoteHost}:${ses.remoteCwd}`;
    ses.selectedIndex = 0;
    ses.scrollOffset = 0;
    ses.marked.clear();
    if (ses === cur()) render();
    if (callback) callback(null);
  });
}

// ── Actions ─────────────────────────────────────────────
function navigate(dir) {
  const ses = cur();
  if (ses.remoteMode) {
    const prevCwd = ses.remoteCwd;
    if (dir === '..') {
      const parts = ses.remoteCwd.split('/').filter(Boolean);
      parts.pop();
      ses.remoteCwd = '/' + parts.join('/');
    } else {
      ses.remoteCwd = dir;
    }
    log('navigate | remote:', prevCwd, '→', ses.remoteCwd, 'host:', ses.remoteHost);

    // Check if SFTP session is still alive
    if (!ses.sftpSession) {
      log('navigate | SFTP session lost!');
      showMessage('SSH connection​ lost');
      disconnectSFTP(ses);
      ses.cwd = path.resolve(process.argv[2] || process.cwd());
      saveSessions();
      render();
      return;
    }

    refreshRemote(ses, (err) => {
      if (err) {
        // Revert to previous directory on error
        log('navigate | readdir failed, reverting to:', prevCwd);
        ses.remoteCwd = prevCwd;
        showMessage('Access denied: ' + dir);
      } else saveSessions();
    });
    return;
  }
  try {
    fs.accessSync(dir, fs.constants.R_OK);
    ses.cwd = path.resolve(dir);
    ses.selectedIndex = 0;
    ses.scrollOffset = 0;
    ses.marked.clear();
    watchDir();
    saveSessions();
    render();
  } catch {
    showMessage('Access denied: ' + dir);
  }
}

function openEntry() {
  const entry = panel.entries[panel.selectedIndex];
  if (!entry) return;
  log('openEntry |', entry.name, 'type:', entry.type, 'remote:', panel.remoteMode, 'host:', panel.remoteHost, 'panel.remoteCwd:', panel.remoteCwd);
  if (panel.remoteMode) {
    if (entry.name === '..') {
      log('openEntry | remote go up from:', panel.remoteCwd);
      navigate('..');
      return;
    }
    else if (entry.type === 'dir') {
      const newPath = panel.remoteCwd === '/' ? '/' + entry.name : panel.remoteCwd.replace(/\/+$/, '') + '/' + entry.name;
      log('openEntry | remote path:', newPath);
      navigate(newPath);
    }
    return;
  }
  if (entry.name === '..') { navigate(path.dirname(panel.cwd)); return; }
  const fp = path.join(panel.cwd, entry.name);
  if (entry.type === 'dir') navigate(fp);
  else if (isViewable(entry.name)) openViewer(fp, entry.name);
  else if (isImageFile(entry.name)) {
    // Open via explorer.exe (not cmd `start`), so a filename with %..% or ! isn't
    // treated as a cmd variable/expansion.
    require('child_process').execFile('explorer.exe', [fp], () => {});
  }
}

function isImageFile(name) {
  const ext = path.extname(name).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.bmp' || ext === '.webp';
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
    if (sample.includes(0)) { showMessage('Binary file —​ cannot view'); return; }
    content = buf.toString('utf8');
  } catch (e) {
    showMessage('Cannot read: ' + e.message);
    return;
  }

  const lines = content.split('\n');
  const lineNumW = String(lines.length).length;

  dialogOpen = true;

  const hint = blessed.box({
    parent: screen, bottom: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { bg: C.header, fg: '#87AFD7' },
    content: ' {white-fg}{bold}ESC{/}{#87AFD7-fg} Close{/}  {white-fg}{bold}↑↓{/}{#87AFD7-fg} Scroll{/}  {white-fg}{bold}PgUp/PgDn{/}{#87AFD7-fg} Page{/}  {white-fg}{bold}Home/End{/}{#87AFD7-fg} Top/Bottom{/}  {white-fg}{bold}C{/}{#87AFD7-fg} CopyAll{/}  {white-fg}{bold}F4{/}{#87AFD7-fg} Edit{/}',
  });

  const viewer = blessed.box({
    parent: screen, top: 0, left: 0, width: '100%', height: '100%-1',
    border: { type: 'line' }, tags: true,
    scrollable: true, alwaysScroll: true, mouse: MOUSE, keys: true,
    inputOnFocus: false,
    scrollbar: { ch: '█', style: { fg: 'gray' } },
    style: { border: { fg: C.borderHi }, bg: 'black', fg: 'white' },
    label: ` ${esc(name)} (${lines.length} lines) `,
  });

  // Plain text content with line numbers
  const plainLines = lines.map((l, i) => {
    const num = String(i + 1).padStart(lineNumW);
    // Escape blessed tags in file content ({open} renders a literal brace)
    const safe = l.replace(/\{/g, '{open}');
    return `{gray-fg}${num}{/}{white-fg} ${safe}{/}`;
  });
  viewer.setContent(plainLines.join('\n'));

  const closeViewer = () => {
    screen.removeListener('keypress', viewerKeys);
    hint.destroy();
    viewer.destroy();
    dialogOpen = false;
    screen.alloc();
    render();
  };

  const viewerKeys = (ch, key) => {
    if (!key) return;
    if (key.name === 'escape' || key.name === 'q' || key.name === 'backspace') {
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
    } else if (key.name === 'f4') {
      closeViewer();
      require('child_process').spawn('notepad.exe', [fp], { detached: true, stdio: 'ignore' }).unref();
    } else if (ch === 'c' || ch === 'C') {
      copyTextToClipboard(content.replace(/\r\n/g, '\n'), (err) => {
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
        paths.push(panel.remoteMode ? panel.remoteCwd + '/' + e.name : path.join(panel.cwd, e.name));
      }
    });
  } else {
    // Copy single selected file
    const entry = panel.entries[panel.selectedIndex];
    if (!entry || entry.name === '..') return;
    paths.push(panel.remoteMode ? panel.remoteCwd + '/' + entry.name : path.join(panel.cwd, entry.name));
  }
  copyTextToClipboard(paths.join(', '), (err) => {
    showMessage(err ? 'Copy failed' : `Copied ${paths.length} path(s)`);
  });
}

// Copy arbitrary-length text via temp file (command-line args are capped at ~32K chars on Windows)
function copyTextToClipboard(text, cb) {
  if (isWindows) {
    const tmp = path.join(os.tmpdir(), `treeru_clip_${process.pid}.txt`);
    try { fs.writeFileSync(tmp, text, 'utf8'); } catch (e) { cb(e); return; }
    execFile('powershell', ['-NoProfile', '-Command',
      `Get-Content -LiteralPath '${tmp.replace(/'/g, "''")}' -Raw -Encoding UTF8 | Set-Clipboard`], (err) => {
      try { fs.unlinkSync(tmp); } catch {}
      cb(err);
    });
  } else {
    const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip';
    const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard'];
    const child = require('child_process').spawn(cmd, args);
    let done = false;
    const finish = (e) => { if (!done) { done = true; cb(e); } };
    child.on('error', finish);
    child.on('close', () => finish(null));
    child.stdin.end(text);
  }
}

// Put actual files (not text) on the Windows clipboard — paste with Ctrl+V in Explorer or F5 in another tab
function copyFilesToClipboard(paths, cb) {
  if (!isWindows) { cb(new Error('unsupported')); return; }
  // -LiteralPath (not -Path) so filenames with [ ] brackets aren't treated as wildcards
  const list = paths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
  execFile('powershell', ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath ${list}`], (err) => cb(err));
}

function uniquePath(dir, name) {
  let p = path.join(dir, name);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(name), base = path.basename(name, ext);
  for (let i = 1; ; i++) {
    p = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
}

// D key — remote tab: download selection to ~/Downloads (+ clipboard as files);
//         local tab: put selection on the clipboard as files (folders OK)
function downloadSelected() {
  const ses = cur();
  const names = [];
  if (ses.marked.size > 0) {
    ses.entries.forEach(e => { if (ses.marked.has(e.name) && e.name !== '..') names.push(e.name); });
  } else {
    const entry = ses.entries[ses.selectedIndex];
    if (!entry || entry.name === '..') return;
    names.push(entry.name);
  }
  if (names.length === 0) return;

  if (!ses.remoteMode) {
    const paths = names.map(n => path.join(ses.cwd, n));
    copyFilesToClipboard(paths, (err) => {
      showMessage(err ? 'Copy failed' : `📋 ${paths.length} file(s) on clipboard — Ctrl+V in Explorer / F5 in another tab`);
    });
    return;
  }

  const files = names.filter(n => { const e = ses.entries.find(x => x.name === n); return e && e.type !== 'dir'; });
  const skipped = names.length - files.length;
  if (files.length === 0) { showMessage('Folders cannot be downloaded — select files'); return; }
  const destDir = path.join(os.homedir(), 'Downloads');
  try { fs.mkdirSync(destDir, { recursive: true }); } catch {}
  showMessage(`⬇ Downloading ${files.length} file(s)...`);

  const saved = [], errs = [];
  let i = 0;
  const next = () => {
    if (i >= files.length) {
      ses.marked.clear();
      const finish = () => {
        showMessage(`⬇ ${saved.length} file(s) → Downloads` +
          (skipped ? `, ${skipped} folder(s) skipped` : '') +
          (errs.length ? `, ${errs.length} failed` : '') +
          (saved.length && isWindows ? ' (clipboard ready)' : ''));
        if (ses === cur()) render();
      };
      if (saved.length && isWindows) copyFilesToClipboard(saved, finish);
      else finish();
      return;
    }
    const name = files[i++];
    if (!ses.sftpSession) { errs.push('No SFTP session'); next(); return; }
    // Harden against a hostile server returning names like "..\..\Startup\x.bat":
    // the local target is built ONLY from the basename, never the server string.
    const safeName = path.basename(name.replace(/[\\/]+/g, '/'));
    if (!safeName || safeName === '.' || safeName === '..') { errs.push('bad name: ' + name); next(); return; }
    const local = uniquePath(destDir, safeName);
    ses.sftpSession.fastGet(ses.remoteCwd + '/' + name, local, (err) => {
      if (err) errs.push(err.message); else saved.push(local);
      next();
    });
  };
  next();
}

// Pick a non-colliding remote filename ("name (1).ext", ...) then run cb(finalName)
function remoteUniqueName(ses, name, cb) {
  const ext = path.extname(name), base = path.basename(name, ext);
  const tryName = (n, i) => {
    ses.sftpSession.stat(ses.remoteCwd + '/' + n, (err) => {
      if (err) return cb(n);            // stat failed → name is free
      tryName(`${base} (${i})${ext}`, i + 1); // exists → try next
    });
  };
  tryName(name, 1);
}

// Shared by F5 clipboard paste and drag&drop: copy local files into the current tab.
// Never overwrites an existing file (auto-renames), and skips folders with a notice.
function transferFilesToCurrent(files) {
  const ses = cur();
  const dirs = files.filter(f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } });
  const list = files.filter(f => !dirs.includes(f));
  if (list.length === 0) { showMessage(dirs.length ? 'Folders are not supported — files only' : 'Nothing to paste'); return; }
  const note = dirs.length ? `, ${dirs.length} folder(s) skipped` : '';
  let done = 0, failed = 0;
  const tick = () => {
    if (done + failed < list.length) return;
    if (ses.remoteMode) {
      showMessage(`Pasted ${done} file(s)` + (failed ? `, ${failed} failed` : '') + note + ` → ${ses.remoteHost}`);
      refreshRemote(ses);
    } else {
      showMessage(`Pasted ${done} file(s)` + (failed ? `, ${failed} failed` : '') + note);
      if (ses === cur()) render();
    }
  };
  list.forEach(src => {
    const name = path.basename(src);
    if (ses.remoteMode && ses.sftpSession) {
      remoteUniqueName(ses, name, (finalName) => {
        ses.sftpSession.fastPut(src, ses.remoteCwd + '/' + finalName, (ue) => {
          if (ue) failed++; else done++;
          tick();
        });
      });
    } else {
      try { fs.copyFileSync(src, uniquePath(ses.cwd, name)); done++; } catch { failed++; }
      tick();
    }
  });
}

function hasBadPath(name) {
  // Reject path separators and the special "." / ".." entries, but allow ".." as a
  // substring of a legit name like "2024..2025" or "file..bak".
  return !name || name === '.' || name === '..' || name.includes('/') || name.includes('\\');
}

function makeDirectory() {
  if (panel.remoteMode) {
    const ses = cur(); // capture: user may switch tabs before the SFTP round-trip returns
    inputDialog('New folder name (remote):', '', (name) => {
      if (hasBadPath(name)) { showMessage('Invalid name'); return; }
      if (!ses.sftpSession) { showMessage('SSH connection lost'); return; }
      const rp = ses.remoteCwd + '/' + name;
      ses.sftpSession.mkdir(rp, (err) => {
        if (err) showMessage('Failed: ' + err.message);
        else refreshRemote(ses);
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
  // Delete all marked entries if any, otherwise the one under the cursor
  const names = [];
  if (panel.marked.size > 0) {
    panel.entries.forEach(e => { if (panel.marked.has(e.name) && e.name !== '..') names.push(e.name); });
  } else {
    const entry = panel.entries[panel.selectedIndex];
    if (!entry || entry.name === '..') return;
    names.push(entry.name);
  }
  if (names.length === 0) return;
  const label = names.length === 1 ? `"${esc(names[0])}"` : `${names.length} items`;
  if (panel.remoteMode) {
    const ses = cur();
    confirmDialog(`Delete ${label}? (permanent)`, () => deleteRemoteEntries(ses, names));
    return;
  }
  const targets = names.map(n => path.join(panel.cwd, n));
  confirmDialog(`Recycle ${label}?\n\n {green-fg}Enter/Y{/} = Recycle Bin   {yellow-fg}Shift+D{/} = Permanent   {red-fg}Esc/N{/} = Cancel`, () => {
    panel.marked.clear();
    moveToRecycleBin(targets);
  }, (ch, key) => {
    if (key && key.name === 'd' && key.shift) {
      return () => { panel.marked.clear(); permanentDelete(targets); };
    }
  });
}

function deleteRemoteEntries(ses, names) {
  const errs = [];
  let i = 0;
  const next = () => {
    if (i >= names.length) {
      ses.marked.clear();
      if (errs.length) showMessage(`Delete failed: ${errs.length} item(s) — ${errs[0]}`);
      refreshRemote(ses);
      return;
    }
    const name = names[i++];
    const entry = ses.entries.find(e => e.name === name);
    const rp = ses.remoteCwd + '/' + name;
    const done = (err) => { if (err) errs.push(err.message); next(); };
    if (ses.sftpSession && entry && entry.type === 'dir') ses.sftpSession.rmdir(rp, done);
    else if (ses.sftpSession) ses.sftpSession.unlink(rp, done);
    else { errs.push('No SFTP session'); next(); }
  };
  next();
}

function moveToRecycleBin(targets) {
  try {
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    const list = targets.map(t => `'${t.replace(/'/g, "''")}'`).join(',');
    // MoveHere is asynchronous — wait until each source path is gone, then verify
    const ps = `$sh = New-Object -ComObject Shell.Application; $ns = $sh.NameSpace(10); $failed = 0; ` +
      `foreach ($p in @(${list})) { $ns.MoveHere($p); $i = 0; ` +
      `while ((Test-Path -LiteralPath $p) -and $i -lt 80) { Start-Sleep -Milliseconds 100; $i++ }; ` +
      `if (Test-Path -LiteralPath $p) { $failed++ } }; ` +
      `if ($failed -gt 0) { Write-Output ('FAIL ' + $failed); exit 1 }; Write-Output 'OK'`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 120000 }, (err, stdout) => {
      const out = (stdout || '').trim();
      if (err || out !== 'OK') {
        const n = out.startsWith('FAIL') ? out.split(' ')[1] : '';
        showMessage(`Recycle failed${n ? `: ${n} item(s) not moved` : ''}`);
        watchDir(); render();
      } else {
        setTimeout(() => { watchDir(); render(); }, 100);
      }
    });
  } catch (e) { watchDir(); showMessage('Recycle failed: ' + e.message); }
}

function permanentDelete(targets) {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  const errs = [];
  for (const target of targets) {
    try {
      if (fs.statSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
    } catch (e) { errs.push(e.message); }
  }
  if (errs.length) showMessage(`Delete failed: ${errs.length} item(s) — ${errs[0]}`);
  setTimeout(() => { watchDir(); render(); }, 100);
}

function renameEntry() {
  const entry = panel.entries[panel.selectedIndex];
  if (!entry || entry.name === '..') return;
  const ses = cur(); // capture: op targets this tab even if the user switches mid-dialog
  inputDialog('Rename to:', entry.name, (newName) => {
    if (hasBadPath(newName)) { showMessage('Invalid name'); return; }
    if (ses.remoteMode) {
      if (!ses.sftpSession) { showMessage('SSH connection lost'); return; }
      ses.sftpSession.rename(ses.remoteCwd + '/' + entry.name, ses.remoteCwd + '/' + newName, (err) => {
        if (err) showMessage('Rename failed: ' + err.message);
        else refreshRemote(ses);
      });
      return;
    }
    try {
      if (watcher) { try { watcher.close(); } catch {} watcher = null; }
      fs.renameSync(path.join(ses.cwd, entry.name), path.join(ses.cwd, newName));
      watchDir();
      render();
    } catch (e) { watchDir(); showMessage('Rename failed: ' + e.message); }
  });
}

// ── Clipboard Image Watcher ─────────────────────────────
let lastClipSeq = -1;
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
        return;
      }
      if (seq !== lastClipSeq) {
        lastClipSeq = seq;
        log('clipboard | changed, seq:', seq);
        // Only the instance that last received user input saves the screenshot;
        // the per-seq claim lock prevents duplicate saves across instances.
        if (isActiveInstance() && claimClipSeq(seq)) saveClipboardImage();
      }

      // Keep the 📷 marker fresh when another instance takes over (≤1.5s lag)
      if (!dialogOpen && isActiveInstance() !== shotShown) render();
    });
  }, 1500);
}

function localTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function saveClipboardImage() {
  const ses = cur(); // the tab that was active at capture time
  const filename = `screenshot_${localTimestamp()}.png`;
  const quiet = dialogOpen; // still save while a dialog is open, just skip UI feedback
  let savePath;

  if (ses.remoteMode) {
    savePath = path.join(os.tmpdir(), filename);
  } else {
    savePath = path.join(ses.cwd, filename);
  }

  const scriptPath = path.join(__dirname, 'clip_save.ps1');
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-dest', savePath], (err, stdout) => {
    if (err || stdout.trim() !== 'OK') { log('clipboard | no image'); return; }

    if (ses.remoteMode && ses.sftpSession) {
      const rp = ses.remoteCwd + '/' + filename;
      ses.sftpSession.fastPut(savePath, rp, (ue) => {
        try { fs.unlinkSync(savePath); } catch {}
        if (ue) { if (!quiet && !dialogOpen && ses === cur()) showMessage('Upload failed'); return; }
        // Upload finished → the remote path is final; safe to hand it to the clipboard now
        autoCopyScreenshotPath(rp, filename, ses, quiet);
        if (quiet || dialogOpen || ses !== cur()) return;
        refreshRemote(ses);
      });
    } else {
      // clip_save.ps1 exits only after the PNG is fully written, so the file is
      // complete here — but stat-verify anyway (size>0) before copying the path.
      autoCopyScreenshotPath(savePath, filename, ses, quiet);
      if (!quiet && !dialogOpen) render();
    }
  });
}

// After a screenshot lands on disk, put its full path on the clipboard so it can
// be pasted straight into an AI CLI (replaces the manual CopyPath step).
// Runs strictly AFTER the save callback (local write / SFTP upload complete) —
// never on a timer — so the file always exists by the time the path is copied.
function autoCopyScreenshotPath(fullPath, filename, ses, quiet) {
  const announce = (suffix) => {
    if (quiet || dialogOpen || ses !== cur()) return;
    const dest = ses.remoteMode ? ' → ' + ses.remoteHost : '';
    showMessage('📷 ' + filename + dest + suffix);
    render();
  };
  if (!config.screenshotCopyPath) { announce(''); return; }
  const doCopy = () => copyTextToClipboard(fullPath, (e) => announce(e ? '' : '  (path copied)'));
  if (ses.remoteMode) { doCopy(); return; } // fastPut callback == upload complete
  fs.stat(fullPath, (se, st) => {
    if (se || !st || st.size <= 0) {
      // Extremely defensive: give a slow disk one more beat, then re-check once.
      setTimeout(() => fs.stat(fullPath, (se2, st2) => {
        if (se2 || !st2 || st2.size <= 0) { announce(''); return; }
        doCopy();
      }), 300);
      return;
    }
    doCopy();
  });
}

// ── Clipboard File Paste ─────────────────────────────────
function pasteFilesFromClipboard() {
  const psCmd = '$f = Get-Clipboard -Format FileDropList; if ($f) { $f.FullName -join "`n" } else { "" }';
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], (err, stdout) => {
    if (err || !stdout.trim()) { showMessage('No files in clipboard'); return; }
    const files = stdout.trim().split('\n').map(f => f.trim()).filter(Boolean);
    transferFilesToCurrent(files);
  });
}

// ── Drag & Drop (experimental) ──────────────────────────
// Dropping a file onto the terminal makes Windows Terminal "type" its quoted
// path as a rapid character burst. Detect the burst, validate the paths, and
// offer to copy the files into the current tab (local copy or SFTP upload).
let dropBuf = '';
let dropTimer = null;
let lastPrintCh = '';
let lastPrintTs = 0;

function evalDrop() {
  const text = dropBuf;
  dropBuf = '';
  if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
  const raw = text.match(/"[^"]+"|\S+/g) || [];
  const files = raw.map(s => s.replace(/^"+|"+$/g, ''))
    .filter(p => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/'))
    .filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (files.length === 0) return; // not a file drop — discard the burst
  confirmDialog(`Copy ${files.length} dropped file(s) into this tab?`, () => transferFilesToCurrent(files));
}

// Returns true when the char was consumed as part of a drop burst
function handleDropChar(ch) {
  if (!ch || ch.length !== 1 || ch < ' ') return false;
  const now = Date.now();
  if (dropBuf) {
    dropBuf += ch;
    if (dropTimer) clearTimeout(dropTimer);
    dropTimer = setTimeout(evalDrop, 120);
    lastPrintTs = now; lastPrintCh = ch;
    return true;
  }
  // burst start: two printable chars within 12ms. Human typing is never this fast
  // (world-record ~14 chars/s ≈ 70ms apart), so a real command key like T/W/D is
  // never mistaken for a drop; only a paste/OS file-drop (~1ms/char) qualifies.
  // 35ms was too loose and swallowed genuine keystrokes (the "T did nothing" bug).
  if (now - lastPrintTs < 12 && lastPrintCh) {
    dropBuf = lastPrintCh + ch;
    dropTimer = setTimeout(evalDrop, 120);
    lastPrintTs = now; lastPrintCh = ch;
    return true;
  }
  lastPrintTs = now; lastPrintCh = ch;
  return false;
}

// ── File Watcher (auto-refresh on changes) ──────────────
let watcher = null;
function watchDir() {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  if (panel.remoteMode) return;
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
  markActive();
  if (dialogOpen) return;

  // Tab bar: left-click = switch / open picker on "+", right-click = close tab
  if (data.action === 'mousedown') {
    const tp = tabBar.lpos;
    if (tp && data.y === tp.yi) {
      const rel = data.x - tp.xi;
      const hit = tabHits.find(h => rel >= h.x0 && rel <= h.x1);
      if (hit) {
        if (hit.idx === 'new') showNewTabDialog();
        else if (data.button === 'right') closeTab(hit.idx);
        else switchTab(hit.idx);
      }
      return;
    }
  }

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
  markActive();
  if (dialogOpen) return;  // Block ALL keys while dialog/menu is open

  // Drag&drop burst detection (must run before any other key handling)
  if (!key.ctrl && !key.meta && handleDropChar(ch)) return;

  // Alt+Shift+C — copy path (works with c, C, ㅊ for Korean IME)
  if (key.meta && key.shift && (key.name === 'c' || ch === 'C' || ch === 'ㅊ')) {
    copyPathToClipboard();
    return;
  }

  // Alt+1..9 — jump straight to tab N
  if (key.meta && ch >= '1' && ch <= '9') {
    switchTab(parseInt(ch, 10) - 1);
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
    case 'tab':
      if (sessions.length > 1) {
        switchTab(key.shift
          ? (activeIdx - 1 + sessions.length) % sessions.length
          : (activeIdx + 1) % sessions.length);
      }
      break;
    case 't':
      showNewTabDialog();
      break;
    case 'w':
      closeTab(activeIdx);
      break;
    case 'backspace':
      log('backspace | panel.remoteMode:', panel.remoteMode, 'cwd:', panel.cwd, 'panel.remoteCwd:', panel.remoteCwd);
      if (panel.remoteMode) navigate('..');
      else navigate(path.dirname(panel.cwd));
      break;
    case 'f2':
      renameEntry();
      break;
    case 'f4': {
      const entry = panel.entries[panel.selectedIndex];
      if (entry && entry.name !== '..' && entry.type !== 'dir') {
        const fp = panel.remoteMode ? null : path.join(panel.cwd, entry.name);
        if (!fp) { showMessage('Cannot edit remote files'); break; }
        require('child_process').spawn('notepad.exe', [fp], { detached: true, stdio: 'ignore' }).unref();
      }
      break;
    }
    case 'f5':
      pasteFilesFromClipboard();
      break;
    case 'f6':
      copyPathToClipboard();
      break;
    case 'f7':
      makeDirectory();
      break;
    case 'delete':
      deleteEntry();
      break;
    case 'd':
      downloadSelected();
      break;
    case 'f8':
      showBookmarks();
      break;
    case 'f9':
      registerClaudeWorkspace();
      break;
    case 'f10':
      if (panel.remoteMode) {
        const ses = cur();
        disconnectSFTP(ses);
        ses.cwd = path.resolve(process.argv[2] || process.cwd());
        ses.selectedIndex = 0;
        ses.scrollOffset = 0;
        watchDir();
        saveSessions();
        render();
      } else {
        showSSHMenu();
      }
      break;
    case 'f12':
      showClaudeMenu();
      break;
    case 'escape':
      if (panel.marked.size > 0) {
        // Clear selection
        panel.marked.clear();
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
// ── Instance Coordination (multi-instance safe) ─────────
// Multiple TreeRU windows/panes may run at once. The instance that last
// received user input is the "active" one — only it saves clipboard screenshots.
const ACTIVE_FILE = path.join(os.tmpdir(), '.treeru_active');
const CLAIM_PREFIX = '.treeru_claim_';
let lastActiveWrite = 0;

function markActive() {
  const now = Date.now();
  if (now - lastActiveWrite < 1000) return;
  lastActiveWrite = now;
  try { fs.writeFileSync(ACTIVE_FILE, String(process.pid)); } catch {}
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isActiveInstance() {
  try {
    const pid = parseInt(readFileSync(ACTIVE_FILE, 'utf8').trim(), 10);
    if (!pid || pid === process.pid) return true;
    return !isPidAlive(pid); // stale entry — claim lock below breaks the tie
  } catch { return true; }
}

function claimClipSeq(seq) {
  // Atomic per-seq lock so two instances never save the same screenshot twice
  try { fs.writeFileSync(path.join(os.tmpdir(), CLAIM_PREFIX + seq), String(process.pid), { flag: 'wx' }); return true; }
  catch { return false; }
}

function cleanupStaleClaims() {
  try {
    const cutoff = Date.now() - 3600000;
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(CLAIM_PREFIX)) continue;
      const fp = path.join(os.tmpdir(), f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
    }
  } catch {}
}

function releaseActiveFile() {
  try {
    const pid = parseInt(readFileSync(ACTIVE_FILE, 'utf8').trim(), 10);
    if (pid === process.pid) fs.unlinkSync(ACTIVE_FILE);
  } catch {}
}

let tornDown = false;
function cleanup() {
  if (clipInterval) { clearInterval(clipInterval); clipInterval = null; }
  saveSessions();
  for (const s of sessions) {
    if (s.sftpConn) { try { s.sftpConn.end(); } catch {} }
    if (s.sftpForwardSock) { try { s.sftpForwardSock.destroy(); } catch {} }
    if (s.sftpJumpConn) { try { s.sftpJumpConn.end(); } catch {} }
  }
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  releaseActiveFile();
  // Restore the terminal exactly once: disable mouse tracking, leave the alt-screen,
  // show the cursor. Without this, quitting/crashing can leave mouse mode ON, so the
  // terminal then spews escape sequences (garbage) into whatever runs there next —
  // e.g. an ssh+zellij session sharing the window.
  if (!tornDown) {
    tornDown = true;
    try { if (typeof screen !== 'undefined' && screen && !screen.destroyed) screen.destroy(); } catch {}
  }
}
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// ── Windows mouse fix ───────────────────────────────────
// On Windows, Node's setRawMode() (which blessed calls to take over stdin) clears
// the console's ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) flag. That flag is what
// Windows Terminal needs to deliver mouse events as SGR escape sequences, so the
// mouse silently stops working while the keyboard still works. We re-set the flag
// AFTER blessed has grabbed stdin, via a Win32 SetConsoleMode call. Runs async so
// it never blocks the UI; harmless where the flag is already set; opt out with
// "mouseVTFix": false in ~/.treeru_config.json.
function enableVTMouseInput() {
  if (!isWindows || config.mouseVTFix === false || !MOUSE) return; // no mouse → nothing to enable
  const ps = [
    '$s=@"',
    'using System;using System.Runtime.InteropServices;',
    'public static class VT{',
    '[DllImport("kernel32.dll")]public static extern IntPtr GetStdHandle(int n);',
    '[DllImport("kernel32.dll")]public static extern bool GetConsoleMode(IntPtr h,out uint m);',
    '[DllImport("kernel32.dll")]public static extern bool SetConsoleMode(IntPtr h,uint m);}',
    '"@',
    'Add-Type -TypeDefinition $s',
    '$h=[VT]::GetStdHandle(-10)',                   // STD_INPUT_HANDLE
    '[uint32]$m=0',
    'if(-not [VT]::GetConsoleMode($h,[ref]$m)){exit 1}',
    'if(-not [VT]::SetConsoleMode($h,($m -bor 0x0200))){exit 2}', // ENABLE_VIRTUAL_TERMINAL_INPUT
  ].join('\n');
  // MUST be execFileSync with stdio:'inherit' — a synchronous, handle-inheriting
  // child so PowerShell's GetStdHandle(-10) resolves to TreeRU's *actual* console
  // input buffer. Async execFile (piped stdio) gives PowerShell a pipe handle, so
  // SetConsoleMode targets the wrong object and the mouse stays dead. The PS script
  // writes nothing to stdout, so inheriting the console output is safe (no screen noise).
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { stdio: 'inherit', windowsHide: true });
  } catch {}
}

// ── Init ────────────────────────────────────────────────
// One-time cleanup of leftovers from removed features:
// browser profile of the old F8 usage monitor (held session cookies) + legacy pid file
try { fs.rmSync(path.join(os.homedir(), '.treeru_claude_profile'), { recursive: true, force: true }); } catch {}
try { fs.unlinkSync(path.join(os.tmpdir(), '.treeru.pid')); } catch {}
cleanupStaleClaims();
markActive();

// Restore previous tabs (zellij-style); a CLI dir argument focuses/creates its own tab
const restored = loadSessions();
const argDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!restored) {
  sessions = [newSession(argDir || process.cwd())];
  activeIdx = 0;
} else if (argDir) {
  const existing = sessions.findIndex(s => !s.remoteMode && !s.pendingRemote && s.cwd === argDir);
  if (existing >= 0) activeIdx = existing;
  else { sessions.push(newSession(argDir)); activeIdx = sessions.length - 1; }
}

watchDir();
startClipboardWatcher();
render();
// Re-enable Windows Terminal mouse input after blessed has set raw mode (see above).
// Deferred slightly so libuv's raw-mode init has definitely run first.
setTimeout(enableVTMouseInput, 120);
activatePendingRemote(); // if the restored active tab is an SSH session, reconnect it
saveSessions();
