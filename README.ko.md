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

> 기본값으로 `F12`는 `claude`를 그대로 실행합니다. `--dangerously-skip-permissions`
> 플래그를 붙여 실행하고 싶으면 `~/.treeru_config.json`(최초 실행 시 자동 생성)에서
> `"claudeSkipPermissions": true`로 설정하세요. 이 플래그의 의미를 이해하는 경우에만 켜세요.

## 탭 (세션)

하나의 TreeRU 창 안에서 로컬·SSH 작업 폴더 여러 개를 zellij처럼 탭으로 관리합니다.

- **`T`** = 새 탭 픽커: 현재 탭 복제 / 홈 / **`~/.ssh/config`의 SSH 호스트로 바로 접속**
- 탭 **클릭**으로 전환, **우클릭**으로 닫기, **`+`** 클릭으로 새 탭
- **`Tab` / `Shift+Tab`** 순환, **`Alt+1`~`9`** 바로 점프, **`W`** 현재 탭 닫기
- 탭마다 **독립적인 SSH 연결** — 서버 3대를 탭 3개로 동시에 탐색 가능
- **재실행 시 세션 자동 복원**: 껐다 켜면 탭 구성이 그대로 돌아옵니다 (SSH 탭은 전환하는 순간 자동 재접속). 저장 위치 `~/.treeru_sessions.json`
- 스크린샷은 **활성 탭의 폴더**에 저장됩니다

## 즐겨찾기 (F8)

자주 가는 폴더 — 로컬이든 SSH 서버 깊숙한 곳이든 — 두 번의 키로 돌아갑니다.

- 어디서든 **F8** = 즐겨찾기 목록
- 맨 위 **➕ Add current folder** = 지금 위치를 추가 (SSH 탭이면 `host:/전체/경로`까지 기억)
- 화살표 + **Enter** = 즐겨찾기를 **현재 탭에서** 열기. SSH 즐겨찾기는 자동 재접속해서 그 폴더로 바로 들어갑니다
- **Del** = 삭제 (편집은 없음 — 지우고 다시 추가하면 됨)
- 저장 위치 `~/.treeru_bookmarks.json`

북마크를 **새 탭으로** 열 수도 있습니다: **T**(또는 **+** 클릭) → **★ Bookmarks ▸** 선택 → 북마크 고르면 새 탭에서 열립니다 (SSH 북마크는 자동 접속).

## Features

- **탭/세션** — 한 창에서 로컬·SSH 작업 공간 여러 개, 재실행 시 자동 복원 (위 섹션 참조)
- **멀티 컬럼 레이아웃** — Far Manager 스타일, 화면 너비에 따라 자동 2~4열 반응형. `←` `→` 방향키로 컬럼 간 이동
- **파일 뷰어** — 파일에서 `Enter`로 줄번호 포함 미리보기. 스크롤, 전체 복사(`C`), 메모장 열기(`F4`)
- **다중 선택** — `Space`로 토글, `Shift+↑↓`로 범위 선택, 마우스 드래그 또는 `Ctrl+클릭`으로 개별 선택
- **마우스 지원** — 클릭으로 이동, 더블클릭으로 폴더 진입, 드래그로 범위 선택, Ctrl+클릭으로 토글
- **F5 파일 붙여넣기** — 탐색기에서 Ctrl+C → TreeRU에서 `F5`로 붙여넣기. SSH 원격 폴더에도 지원
- **SSH/SFTP 원격 탐색** — `F10`으로 `~/.ssh/config`에 등록된 서버 목록에서 바로 접속 (SSH Key 등록 필수)
- **클립보드 이미지 자동 저장** — 스크린샷 찍으면 현재 폴더에 자동 저장. Windows 11 Print Screen, Snipaste, Win+Shift+S 모두 지원
- **다중 인스턴스** — 여러 창/탭에 TreeRU를 동시에 띄울 수 있습니다. 스크린샷은 마지막으로 조작한 인스턴스(상태바에 📷 표시)에만 저장되고 중복 저장되지 않습니다
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

> 설치 과정에서 Node.js와 Windows Terminal을 자동으로 설치합니다. 자동 설치가 실패하면 [nodejs.org](https://nodejs.org)에서 직접 설치 후 `install.bat`을 다시 실행해주세요.

> **참고:** Windows Terminal 설치/업데이트가 실패하면 Windows Update 서비스(`wuauserv`)가 꺼져있을 수 있습니다. 활성화 후 다시 시도하세요:
> ```powershell
> # 상태 확인
> Get-Service wuauserv
> # 활성화 및 시작 (관리자 권한 필요)
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
| `Enter` | 폴더 진입 / 파일 보기 / 이미지 열기 |
| `Space` | 파일 선택 토글 |
| `Shift+↑↓` | 범위 선택 |
| `Backspace` | 상위 폴더 |
| `T` | 새 탭 (픽커: 복제 / 홈 / SSH 호스트) |
| `W` | 현재 탭 닫기 |
| `Tab` / `Shift+Tab` | 다음 / 이전 탭 |
| `Alt+1`~`9` | N번 탭으로 점프 |
| `F8` | 즐겨찾기 (현재 추가 / 열기 / 삭제) |
| `F6` / `Alt+Shift+C` | 경로 클립보드 복사 (다중 선택 시 콤마 구분) |
| `F2` | 이름 변경 |
| `F4` | 메모장으로 편집 |
| `F5` | 파일 붙여넣기 |
| `F7` | 새 폴더 생성 |
| `D` | 다운로드 (원격 → ~/Downloads + 클립보드) / 로컬은 클립보드로 파일 복사 |
| `Del` | 휴지통으로 이동 — 다중 선택 시 전체 적용 (Shift+D는 영구삭제) |
| `F9` | 현재 폴더를 Claude Code 워크스페이스로 등록 |
| `F10` | SSH 접속 / 연결 끊기 |
| `F12` | 등록된 워크스페이스에서 Claude Code 실행 |
| `PrtSc` / `Win+Shift+S` | 스크린샷 촬영 → 현재 폴더에 자동 저장 |
| `Esc` | 선택 해제 |

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

호스트 키는 첫 접속 시 `~/.treeru_hosts.json`에 고정(trust-on-first-use)됩니다. 서버의 호스트 키가 바뀌면 접속이 거부됩니다 — 의도된 변경이면 해당 파일에서 항목을 지우고 다시 접속하세요.

## 파일 전송

**다운로드 (`D`)**
- **SSH 탭**에서: 선택한 파일을 로컬 `~/Downloads`에 내려받고, 동시에 클립보드에 **실제 파일로** 올립니다 — 탐색기에서 `Ctrl+V`, 또는 다른 탭(로컬/원격)에서 `F5`로 붙여넣기. 폴더는 건너뜁니다.
- **로컬 탭**에서: 선택 파일을 클립보드에 파일로 올립니다 ("탐색기로 끌어내기"의 대체).

**업로드**
- `F5` = 탐색기에서 복사(`Ctrl+C`)한 파일을 현재 탭에 붙여넣기 (로컬이면 복사, 원격 탭이면 SFTP 업로드).
- **드래그앤드롭** (실험적): 탐색기에서 파일을 TreeRU 창에 끌어다 놓고 확인하면 현재 탭으로 복사/업로드됩니다. Windows Terminal이 떨어뜨린 파일을 경로로 바꿔주기 때문에 가능합니다. 반대로 터미널에서 *끌어내는* 건 불가능하니 그 방향은 `D`(클립보드 파일)로 하세요.

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
- TreeRU를 여러 개 띄운 경우, 마지막으로 조작한 인스턴스에만 저장됩니다 — 담당 창은 상태바에 📷 표시. 특정 창으로 보내고 싶으면 스샷 찍기 전에 그 창을 한 번 클릭(또는 아무 키)하면 됩니다

## Made by

**TreeRU** | Seoul, South Korea | info@treeru.com

## License

MIT with [Commons Clause](https://commonsclause.com/) — 자유롭게 사용 가능하지만, 상업적 판매 및 수정 재배포는 금지됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참조하세요.
