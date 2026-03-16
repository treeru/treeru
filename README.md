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

- **Multi-column layout** — Far Manager style, responsive 2–4 columns based on terminal width
- **SSH/SFTP remote browsing** — Press F10 to connect to servers from your `~/.ssh/config` (SSH key auth required)
- **Clipboard image auto-save** — Take a screenshot (Snipaste, Win+Shift+S, etc.) and it auto-saves to the current folder (~2s delay, varies by system). Also uploads to remote folders via SSH
- **Path copy (Alt+Shift+C)** — Copy the full path of the selected file to clipboard. Handy for passing paths to AI CLI tools
- **CJK filename support** — Correctly displays CJK (Korean, Japanese, Chinese) filenames
- **Auto-refresh** — Automatically reflects local file changes

## Install

### Windows (Installer)
1. Download from [Releases](../../releases)
2. Right-click `install.bat` → **Run as administrator**
3. Run `treeru` in a new terminal

### Manual
```bash
git clone https://github.com/nicro296/treeru.git
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
| `Enter` | Enter directory |
| `Backspace` | Go to parent directory |
| `Alt+Shift+C` | Copy path to clipboard |
| `F2` | Rename |
| `F7` | Create new folder |
| `Del` | Delete |
| `F10` | SSH connect / disconnect |
| `Esc` | Quit (disconnect if SSH) |

## SSH

Press `F10` to see a list of servers from your `~/.ssh/config`.
Select one to browse remote files via SFTP.

> SSH key authentication must be configured. Password authentication is not supported.

## Clipboard Auto-Paste

When you copy a screenshot to the clipboard (using Snipaste, Windows Snip & Sketch, etc.),
TreeRU automatically detects it and saves it as `screenshot_YYYY-MM-DDTHH-MM-SS.png` in the current folder.

- Local folder: saved immediately
- SSH remote folder: auto-uploaded via SFTP
- Delay: ~1–2 seconds (varies by system)

## Made by

**TreeRU** | Seoul, South Korea | info@treeru.com

## License

MIT
