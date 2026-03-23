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

## Install

### Windows (Installer)
1. Download from [Releases](../../releases)
2. Extract ZIP → run `install.bat` (auto-requests admin)
3. Run `treeru` in a new terminal, or click the desktop icon

### Manual
```bash
git clone https://github.com/treeru/treeru.git
cd treeru
npm install
node index.js
```

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
| `Alt+Shift+C` | Copy path(s) to clipboard |
| `F2` | Rename |
| `F4` | Edit in Notepad |
| `F5` | Paste files from clipboard |
| `F7` | Create new folder |
| `Del` | Delete |
| `F10` | SSH connect / disconnect |
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
