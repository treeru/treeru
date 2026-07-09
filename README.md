**English** | [한국어](README.ko.md)

# TreeRU

A terminal-based file explorer that lets you browse folder/file structures without an IDE.

### [**⬇ Download TreeRU**](https://github.com/treeru/treeru/releases) &nbsp;·&nbsp; [![latest release](https://img.shields.io/github/v/release/treeru/treeru?label=latest&color=2ea44f)](https://github.com/treeru/treeru/releases)

Built for use alongside AI CLI tools (Claude Code, Codex, Gemini CLI, etc.).
Split your Windows Terminal (Ctrl+Shift+D) — one side for your terminal, the other for TreeRU.

```
┌─────────────────────┬──────────────────────────────────┐
│                     │ > ..         │ > Downloads       │
│  Your Terminal      │ > src        │ > Documents       │
│  (claude, codex,    │ > docs       │   index.js        │
│   git, ssh...)      │ > .config    │   package.json    │
│                     │ > node_mod…  │   README.md       │
│                     ├──────────────┤                   │
│  100% native        │              │                   │
└─────────────────────┴──────────────┴───────────────────┘
 C:\Users\me\project>█
```

## Quick Launch — Claude Code (F9 / F12)

No more opening Explorer, copying folder paths, opening a terminal, `cd`, and typing the command manually.

1. Navigate to your project folder in TreeRU
2. Press `F9` to register it as a Claude Code workspace (one-time)
3. From now on, press `F12` anytime → select the workspace → Claude Code launches in a new terminal, ready to go

Works with SSH too — connect via `F10`, navigate to the remote folder, `F9` to register, then `F12` opens a new terminal tab with SSH + Claude Code automatically.

Press `Del` in the `F12` menu to remove a workspace.

> By default `F12` launches plain `claude`. If you want it to launch with
> `--dangerously-skip-permissions`, set `"claudeSkipPermissions": true` in
> `~/.treeru_config.json` (created on first run). Only enable this if you
> understand what the flag does.

## Tabs (Sessions)

Run multiple working folders — local and SSH — inside one TreeRU window, zellij-style.

- **`T`** opens the new-tab picker: duplicate the current tab, open home, or **connect straight to any SSH host** from `~/.ssh/config`
- **Click** a tab to switch, **right-click** to close, click **`+`** for a new tab
- **`Tab` / `Shift+Tab`** cycle tabs, **`Alt+1`–`9`** jump directly, **`W`** closes the current tab
- Each tab keeps its **own independent SSH connection** — browse three servers in three tabs at once
- **Sessions are restored on restart**: your tabs (including SSH ones, which reconnect when you switch to them) come back exactly as you left them. Stored in `~/.treeru_sessions.json`
- Screenshots save into the **active tab's folder**

## Bookmarks (F8)

Jump back to any folder — local or deep inside an SSH server — in two keystrokes.

- Press **F8** anywhere to open the bookmark list
- The top row **➕ Add current folder** saves wherever you are now (for SSH tabs it remembers `host:/full/path`)
- Arrow keys + **Enter** open a bookmark **in the current tab** — an SSH bookmark reconnects and drops you straight into that folder
- **Del** removes a bookmark; add it again anytime (no edit needed)
- Stored in `~/.treeru_bookmarks.json`

You can also open a bookmark **as a new tab**: press **T** (or click **+**), choose **★ Bookmarks ▸**, then pick one — it opens in a fresh tab (SSH bookmarks connect automatically).

## Features

- **Tabs / sessions** — multiple local & SSH workspaces in one window, restored across restarts (see above)
- **Zellij-style tab bar** — powerline arrow ribbon with responsive widths (full names when there's room, shrink only when crowded). For fonts without powerline glyphs set `"tabStyle": "chip"` in `~/.treeru_config.json`
- **Multi-column layout** — Far Manager style, responsive 2–4 columns based on terminal width. Navigate between columns with `←` `→` arrow keys
- **File viewer** — Press `Enter` on a file to view with line numbers. Scroll, copy entire content (`C`), or open in Notepad (`F4`)
- **Multi-select** — `Space` to toggle, `Shift+↑↓` for range select, mouse drag or `Ctrl+Click` for multiple files
- **Mouse support** — Click to navigate, double-click to enter folder, drag to select, Ctrl+Click to toggle
- **F5 File paste** — Copy files in Explorer (Ctrl+C) → paste in TreeRU with `F5`. Works with SSH remote folders
- **SSH/SFTP remote browsing** — Press `F10` to connect to servers from your `~/.ssh/config` (SSH key auth required)
- **Clipboard image auto-save + auto path copy** — Take a screenshot and it auto-saves to the current folder, and the moment the save completes the **file path is copied to your clipboard** (remote path when in an SSH folder). Paste straight into your AI CLI. Disable with `"screenshotCopyPath": false` in `~/.treeru_config.json`. Works with Windows 11 Print Screen, Snipaste, Win+Shift+S, and more
- **Multiple instances** — Run TreeRU in several panes/tabs at once. Screenshots are saved only by the instance you last interacted with (marked with 📷 in the status bar), never duplicated
- **Multi-path copy (Alt+Shift+C)** — Copy selected file paths (comma-separated). Handy for passing paths to AI CLI tools
- **CJK filename support** — Correctly displays CJK (Korean, Japanese, Chinese) filenames
- **Auto-refresh** — Automatically reflects local file changes

## Workflow — Using with Claude Code

Split your terminal (`Ctrl+Shift+D`). Left: Claude Code. Right: TreeRU.

**Passing a screenshot to Claude Code:**
1. Take a screenshot (`PrtSc`, `Win+Shift+S`, Snipaste, etc.)
2. TreeRU auto-saves it to the current folder as `screenshot_....png` **and copies its path to your clipboard**
3. Switch to Claude Code → `Ctrl+V` → Claude reads and analyzes the image

(No auto-copy? It's on by default; re-enable with `"screenshotCopyPath": true` in `~/.treeru_config.json`. You can always navigate to any file and press `Alt+Shift+C` to copy its path manually.)

**Asking Claude Code to edit a file:**
1. Browse to the file in TreeRU
2. `Alt+Shift+C` to copy the full path
3. Switch to Claude Code → paste → "edit this file"

**Selecting multiple files:**
- Files next to each other: `Shift+↑↓` to range select (highlighted in yellow)
- Files scattered in the folder: `Space` to toggle each one individually (highlighted in yellow)
- With mouse: `Ctrl+Click` to toggle, or drag to range select
1. Select the files you need
2. `Alt+Shift+C` copies all paths (comma-separated)
3. Paste into Claude Code → "review these files"

No IDE, no mouse gymnastics. Just copy the path and paste.

## Install

### Windows (Installer)
1. Download from [Releases](../../releases)
2. Extract ZIP → run `install.bat` (auto-requests admin)
3. Run `treeru` in a new terminal, or click the desktop icon

> The installer will attempt to install Node.js and Windows Terminal automatically. If it fails, install Node.js manually from [nodejs.org](https://nodejs.org) and run `install.bat` again.

> **Note:** If Windows Terminal install/update fails, your Windows Update service (`wuauserv`) may be disabled. Enable it and try again:
> ```powershell
> # Check status
> Get-Service wuauserv
> # Enable and start (admin required)
> Set-Service wuauserv -StartupType Manual
> Start-Service wuauserv
> ```

### Manual
```bash
git clone https://github.com/treeru/treeru.git
cd treeru
npm install
node index.js
```

### Requires
- [Node.js](https://nodejs.org) v20.18.1 LTS recommended (v18+ supported)
- [Windows Terminal](https://apps.microsoft.com/detail/9N0DX20HK701) — required for F9/F12 Claude Code launch. Pre-installed on Windows 11, but update to latest recommended. Windows 10 users must install manually:
  - Microsoft Store → search "Windows Terminal", or
  - `winget install Microsoft.WindowsTerminal`
- Windows 11 (tested on 25H2) / Windows 10

## Usage

```bash
treeru                        # Start in current directory
treeru C:\Users\me\projects   # Start in a specific directory
```

Split your Windows Terminal with `Ctrl+Shift+D` and run TreeRU on one side.

## Keybindings

| Key | Action |
|---|---|
| `↑` `↓` | Navigate files |
| `←` `→` | Move between columns |
| `Enter` | Enter directory / View file / Open image |
| `Space` | Toggle select file |
| `Shift+↑↓` | Range select |
| `Backspace` | Go to parent directory |
| `T` | New tab (picker: duplicate / home / SSH hosts) |
| `W` | Close current tab |
| `Tab` / `Shift+Tab` | Next / previous tab |
| `Alt+1`–`9` | Jump to tab N |
| `F8` | Bookmarks (add current / open / delete) |
| `F6` / `Alt+Shift+C` | Copy path(s) to clipboard |
| `F2` | Rename |
| `F4` | Edit in Notepad |
| `F5` | Paste files from clipboard |
| `F7` | Create new folder |
| `D` | Download (remote → ~/Downloads + clipboard) / copy files to clipboard (local) |
| `Del` | Move to Recycle Bin — applies to all selected files (Shift+D for permanent delete) |
| `F9` | Register current folder as Claude Code workspace |
| `F10` | SSH connect / disconnect |
| `F12` | Launch Claude Code from registered workspace |
| `PrtSc` / `Win+Shift+S` | Take screenshot → auto-saves to current folder + path copied to clipboard |
| `Esc` | Clear selection |

**In file viewer:**

| Key | Action |
|---|---|
| `↑` `↓` | Scroll |
| `PgUp` `PgDn` | Page scroll |
| `Home` `End` | Top / Bottom |
| `C` | Copy entire file to clipboard |
| `F4` | Open in Notepad |
| `Esc` `Q` | Close viewer |

## SSH

Press `F10` to see a list of servers from your `~/.ssh/config`.
Select one to browse remote files via SFTP.

> SSH key authentication must be configured. Password authentication is not supported.

Host keys are pinned on first connect (trust-on-first-use) in `~/.treeru_hosts.json`. If a server's host key changes, the connection is refused — remove the entry from that file if the change was intentional.

## File Transfer

**Download (`D`)**
- On an **SSH tab**: downloads the selected file(s) into your local `~/Downloads` folder, and also places them on the clipboard **as files** — paste with `Ctrl+V` in Explorer, or `F5` in another (local or remote) tab. Folders are skipped.
- On a **local tab**: puts the selected file(s) on the clipboard as files (a stand-in for "drag out to Explorer").

**Upload**
- `F5` pastes files you copied in Explorer (`Ctrl+C`) into the current tab — a local copy, or an SFTP upload if the tab is a remote session.
- **Drag & drop** (experimental): drag a file from Explorer onto the TreeRU window and confirm — it's copied/uploaded into the current tab. This works because Windows Terminal converts a dropped file into its path; dragging *out* of the terminal is not possible, so use `D` (clipboard-as-files) for that direction.

## Clipboard Auto-Paste

When you copy a screenshot to the clipboard, TreeRU automatically detects it and saves it as `screenshot_YYYY-MM-DDTHH-MM-SS.png` in the current folder.

**Tested with:**
- Windows 11 Print Screen (PrtSc)
- Snipaste
- Win+Shift+S (Snip & Sketch)

**Save behavior:**
- Local folder: saved immediately
- SSH remote folder: auto-uploaded via SFTP
- Delay: ~1–2 seconds (varies by system)
- With multiple TreeRU instances running, only the one you last interacted with saves the screenshot — it shows a 📷 marker in the status bar. To route a screenshot to a specific instance, click it (or press any key in it) first

## Made by

**TreeRU** | Seoul, South Korea | info@treeru.com

## License

MIT with [Commons Clause](https://commonsclause.com/) — free to use, but cannot be sold or redistributed as a commercial product. See [LICENSE](LICENSE) for details.
