[English](README.md) | **한국어**

# TreeRU

IDE 없이 터미널에서 폴더/파일 구조를 볼 수 있는 파일 탐색기.

AI CLI 도구(Claude Code, Codex, Gemini CLI 등)와 함께 사용하기 위해 만들어졌습니다.
Windows Terminal 분할(Ctrl+Shift+D)로 한쪽은 터미널, 한쪽은 TreeRU를 띄워서 사용합니다.

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

- **멀티 컬럼 레이아웃** — Far Manager 스타일, 화면 너비에 따라 자동 2~4열 반응형
- **SSH/SFTP 원격 탐색** — F10으로 `~/.ssh/config`에 등록된 서버 목록에서 바로 접속 (SSH Key 등록 필수)
- **클립보드 이미지 자동 저장** — Snipaste, Win+Shift+S 등으로 스크린샷 찍으면 현재 폴더에 자동 저장 (약 2초 딜레이, 컴퓨터 성능에 따라 다름). SSH 원격 폴더에도 자동 업로드
- **경로 복사 (Alt+Shift+C)** — 선택한 파일의 전체 경로를 클립보드에 복사. AI CLI에 경로 전달할 때 편리함
- **CJK/한글 파일명 지원** — 한글 폴더/파일명 정상 표시
- **파일 자동 새로고침** — 로컬 파일 변경 시 자동 반영

## Install

### Windows (Installer)
1. [Releases](../../releases)에서 다운로드
2. `install.bat` 우클릭 → **관리자 권한으로 실행**
3. 새 터미널에서 `treeru` 실행

### Manual
```bash
git clone https://github.com/nicro296/treeru.git
cd treeru
npm install
node index.js
```

## Usage

```bash
treeru                        # 현재 폴더에서 시작
treeru C:\Users\me\projects   # 특정 폴더에서 시작
```

Windows Terminal에서 `Ctrl+Shift+D`로 화면 분할 후 한쪽에서 실행하면 됩니다.

## Keybindings

| Key | Action |
|---|---|
| `↑` `↓` | 파일 이동 |
| `Enter` | 폴더 진입 |
| `Backspace` | 상위 폴더 |
| `Alt+Shift+C` | 경로 클립보드 복사 |
| `F2` | 이름 변경 |
| `F7` | 새 폴더 생성 |
| `Del` | 삭제 |
| `F10` | SSH 접속 / 연결 끊기 |
| `Esc` | 종료 (SSH 중이면 연결 끊기) |

## SSH

`F10`을 누르면 `~/.ssh/config`에 등록된 서버 목록이 표시됩니다.
선택하면 SFTP로 연결되어 원격 파일을 탐색할 수 있습니다.

> SSH Key 인증이 설정되어 있어야 합니다. 비밀번호 인증은 지원하지 않습니다.

## Clipboard Auto-Paste

스크린샷 도구(Snipaste, Windows 기본 캡처 등)로 이미지를 클립보드에 복사하면,
TreeRU가 자동으로 감지하여 현재 폴더에 `screenshot_YYYY-MM-DDTHH-MM-SS.png`로 저장합니다.

- 로컬 폴더: 바로 저장
- SSH 원격 폴더: SFTP로 자동 업로드
- 딜레이: 약 1~2초 (컴퓨터 성능에 따라 다름)

## Made by

**TreeRU** | Seoul, South Korea | info@treeru.com

## License

MIT
