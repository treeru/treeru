**English** | [한국어](README.ko.md)

# TreeRU

A terminal-based file explorer that lets you browse folder/file structures without an IDE.

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

## Features

- **Multi-column layout** — Far Manager style, responsive 2–4 columns based on terminal width. Navigate between columns with `←` `→` arrow keys
- **File viewer** — Press `Enter` on a file to view with line numbers. Scroll, copy entire content (`C`), or open in Notepad (`F4`)
- **Multi-select** — `Space` to toggle, `Shift+↑↓` for range select, mouse drag or `Ctrl+Click` for multiple files
- **Mouse support** — Click to navigate, double-click to enter folder, drag to select, Ctrl+Click to toggle
- **F5 File paste** — Copy files in Explorer (Ctrl+C) → paste in TreeRU with `F5`. Works with SSH remote folders
- **SSH/SFTP remote browsing** — Press `F10` to connect to servers from your `~/.ssh/config` (SSH key auth required)
- **Clipboard image auto-save** — Take a screenshot and it auto-saves to the current folder. Works with Windows 11 Print Screen, Snipaste, Win+Shift+S, and more
- **Multi-path copy (Alt+Shift+C)** — Copy selected file paths (comma-separated). Handy for passing paths to AI CLI tools
- **CJK filename support** — Correctly displays CJK (Korean, Japanese, Chinese) filenames
- **Auto-refresh** — Automatically reflects local file changes

## Workflow — Using with Claude Code

Split your terminal (`Ctrl+Shift+D`). Left: Claude Code. Right: TreeRU.

**Passing a screenshot to Claude Code:**
1. Take a screenshot (`PrtSc`, `Win+Shift+S`, Snipaste, etc.)
2. TreeRU auto-saves it to the current folder as `screenshot_....png`
3. Navigate to the file → `Alt+Shift+C` to copy the path
4. Switch to Claude Code → `Ctrl+V` to paste the path
5. Claude Code can now read and analyze the image

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

No IDE needed. No drag-and-drop. Just copy the path and paste.

## Install

### Windows (Installer)
1. Download from [Releases](../../releases)
2. Extract ZIP → run `install.bat` (auto-requests admin)
3. Run `treeru` in a new terminal, or click the desktop icon

> The installer will attempt to install Node.js and Windows Terminal automatically. If it fails, install Node.js manually from [nodejs.org](https://nodejs.org) and run `install.bat` again.

> **Note:** The installer will start the Windows Update service (`wuauserv`) if it is stopped, as it is required for installing/updating Windows Terminal (MSIX package). To stop it again after installation:
> ```powershell
> # Check status
> Get-Service wuauserv
> # Stop the service (admin required)
> Stop-Service wuauserv
> # Or to disable it entirely
> Set-Service wuauserv -StartupType Disabled
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
| `Enter` | Enter directory / View file |
| `Space` | Toggle select file |
| `Shift+↑↓` | Range select |
| `Backspace` | Go to parent directory |
| `F6` / `Alt+Shift+C` | Copy path(s) to clipboard |
| `F2` | Rename |
| `F4` | Edit in Notepad |
| `F5` | Paste files from clipboard |
| `F7` | Create new folder |
| `Del` | Delete |
| `F9` | Register current folder as Claude Code workspace |
| `F10` | SSH connect / disconnect |
| `F12` | Launch Claude Code from registered workspace |
| `Esc` | Clear selection / Disconnect SSH |

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

## Made by

**TreeRU** | Seoul, South Korea | info@treeru.com

## License

MIT
