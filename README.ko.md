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

## 빠른 실행 — Claude Code (F9 / F12)

탐색기 열고, 폴더 경로 복사하고, 터미널 열고, `cd` 하고, 명령어 치는 번거로움이 없습니다.

1. TreeRU에서 프로젝트 폴더로 이동
2. `F9`로 Claude Code 워크스페이스 등록 (최초 1회)
3. 이후 아무 때나 `F12` → 워크스페이스 선택 → 새 터미널에서 Claude Code 바로 실행

SSH에서도 동작합니다 — `F10`으로 접속 후 원격 폴더에서 `F9` 등록하면, `F12`로 SSH + Claude Code가 자동으로 새 터미널 탭에서 열립니다.

`F12` 메뉴에서 `Del`키로 등록된 워크스페이스를 삭제할 수 있습니다.

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

## 사용 예시 — Claude Code와 함께 쓰기

터미널을 분할합니다 (`Ctrl+Shift+D`). 왼쪽: Claude Code. 오른쪽: TreeRU.

**스크린샷을 Claude Code에 전달하기:**
1. 스크린샷 촬영 (`PrtSc`, `Win+Shift+S`, Snipaste 등)
2. TreeRU가 현재 폴더에 `screenshot_....png`로 자동 저장
3. 해당 파일로 이동 → `Alt+Shift+C`로 경로 복사
4. Claude Code로 전환 → `Ctrl+V`로 붙여넣기
5. Claude Code가 이미지를 읽고 분석합니다

**Claude Code에게 파일 수정 요청하기:**
1. TreeRU에서 수정할 파일로 이동
2. `Alt+Shift+C`로 전체 경로 복사
3. Claude Code로 전환 → 붙여넣기 → "이 파일 수정해줘"

**여러 파일 한 번에 전달하기:**
- 파일이 붙어있을 때: `Shift+↑↓`로 범위 선택 (노란색으로 표시)
- 파일이 떨어져있을 때: `Space`로 하나씩 선택/해제 (노란색으로 표시)
- 마우스: `Ctrl+클릭`으로 개별 선택, 드래그로 범위 선택
1. 필요한 파일들을 선택
2. `Alt+Shift+C`로 모든 경로 복사 (콤마 구분)
3. Claude Code에 붙여넣기 → "이 파일들 리뷰해줘"

IDE 없이, 드래그 앤 드롭 없이. 경로 복사해서 붙여넣기만 하면 됩니다.

## Install

### Windows (Installer)
1. [Releases](../../releases)에서 다운로드
2. ZIP 압축 해제 → `install.bat` 실행 (자동 관리자 권한 요청)
3. 새 터미널에서 `treeru` 실행, 또는 바탕화면 아이콘 클릭

> 설치 과정에서 Node.js를 자동으로 설치합니다. 자동 설치가 실패하면 [nodejs.org](https://nodejs.org)에서 직접 설치 후 `install.bat`을 다시 실행해주세요.

### Manual
```bash
git clone https://github.com/treeru/treeru.git
cd treeru
npm install
node index.js
```

### 필수 요구사항
- [Node.js](https://nodejs.org) v20.18.1 LTS 권장 (v18 이상 지원)
- [Windows Terminal](https://apps.microsoft.com/detail/9N0DX20HK701) — F9/F12 Claude Code 실행에 필요. Windows 11은 기본 내장이지만 최신 버전 업데이트 권장. Windows 10은 직접 설치 필요:
  - Microsoft Store → "Windows Terminal" 검색, 또는
  - `winget install Microsoft.WindowsTerminal`
- Windows 11 (25H2에서 테스트) / Windows 10

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
| `F6` / `Alt+Shift+C` | 경로 클립보드 복사 (다중 선택 시 콤마 구분) |
| `F2` | 이름 변경 |
| `F4` | 메모장으로 편집 |
| `F5` | 파일 붙여넣기 |
| `F7` | 새 폴더 생성 |
| `Del` | 삭제 |
| `F9` | 현재 폴더를 Claude Code 워크스페이스로 등록 |
| `F10` | SSH 접속 / 연결 끊기 |
| `F12` | 등록된 워크스페이스에서 Claude Code 실행 |
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
