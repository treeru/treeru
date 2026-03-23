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

- **멀티 컬럼 레이아웃** — Far Manager 스타일, 화면 너비에 따라 자동 2~4열 반응형. `←` `→` 방향키로 컬럼 간 이동
- **파일 뷰어** — 파일에서 `Enter`로 줄번호 포함 미리보기. 스크롤, 전체 복사(`C`), 메모장 열기(`F4`)
- **다중 선택** — `Space`로 토글, `Shift+↑↓`로 범위 선택, 마우스 드래그 또는 `Ctrl+클릭`으로 개별 선택
- **마우스 지원** — 클릭으로 이동, 더블클릭으로 폴더 진입, 드래그로 범위 선택, Ctrl+클릭으로 토글
- **F5 파일 붙여넣기** — 탐색기에서 Ctrl+C → TreeRU에서 `F5`로 붙여넣기. SSH 원격 폴더에도 지원
- **SSH/SFTP 원격 탐색** — `F10`으로 `~/.ssh/config`에 등록된 서버 목록에서 바로 접속 (SSH Key 등록 필수)
- **클립보드 이미지 자동 저장** — 스크린샷 찍으면 현재 폴더에 자동 저장. Windows 11 Print Screen, Snipaste, Win+Shift+S 모두 지원
- **다중 경로 복사 (Alt+Shift+C)** — 선택한 파일들의 경로를 콤마로 구분하여 복사. AI CLI에 경로 전달할 때 편리
- **CJK/한글 파일명 지원** — 한글 폴더/파일명 정상 표시
- **파일 자동 새로고침** — 로컬 파일 변경 시 자동 반영

## Install

### Windows (Installer)
1. [Releases](../../releases)에서 다운로드
2. ZIP 압축 해제 → `install.bat` 실행 (자동 관리자 권한 요청)
3. 새 터미널에서 `treeru` 실행, 또는 바탕화면 아이콘 클릭

### Manual
```bash
git clone https://github.com/treeru/treeru.git
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
| `←` `→` | 컬럼 간 이동 |
| `Enter` | 폴더 진입 / 파일 보기 |
| `Space` | 파일 선택 토글 |
| `Shift+↑↓` | 범위 선택 |
| `Backspace` | 상위 폴더 |
| `Alt+Shift+C` | 경로 클립보드 복사 (다중 선택 시 콤마 구분) |
| `F2` | 이름 변경 |
| `F4` | 메모장으로 편집 |
| `F5` | 파일 붙여넣기 |
| `F7` | 새 폴더 생성 |
| `Del` | 삭제 |
| `F10` | SSH 접속 / 연결 끊기 |
| `Esc` | 선택 해제 / SSH 연결 끊기 |

**파일 뷰어 안에서:**

| Key | Action |
|---|---|
| `↑` `↓` | 스크롤 |
| `PgUp` `PgDn` | 페이지 스크롤 |
| `Home` `End` | 맨 위 / 맨 아래 |
| `C` | 파일 전체 내용 클립보드 복사 |
| `F4` | 메모장으로 열기 |
| `Esc` `Q` | 뷰어 닫기 |

## SSH

`F10`을 누르면 `~/.ssh/config`에 등록된 서버 목록이 표시됩니다.
선택하면 SFTP로 연결되어 원격 파일을 탐색할 수 있습니다.

> SSH Key 인증이 설정되어 있어야 합니다. 비밀번호 인증은 지원하지 않습니다.

## Clipboard Auto-Paste

스크린샷을 클립보드에 복사하면 TreeRU가 자동 감지하여 현재 폴더에 `screenshot_YYYY-MM-DDTHH-MM-SS.png`로 저장합니다.

**테스트 확인된 도구:**
- Windows 11 Print Screen (PrtSc)
- Snipaste
- Win+Shift+S (캡처 및 스케치)

**저장 방식:**
- 로컬 폴더: 바로 저장
- SSH 원격 폴더: SFTP로 자동 업로드
- 딜레이: 약 1~2초 (컴퓨터 성능에 따라 다름)

## Made by

**TreeRU** | Seoul, South Korea | info@treeru.com

## License

MIT
