# TreeRU - Claude 작업 규칙

## 버전 관리

### devlog.txt (로컬 전용, gitignore)
- 모든 코드 수정 사항을 하나하나 디테일하게 기록
- 형식: `숫자 - 수정내용` (최신이 맨 위)
- 코드 수정할 때마다 반드시 기록

### CHANGELOG.md (공개, git 추적)
- 사용자에게 의미 있는 중요 변경만 간추려서 기록
- 형식: `숫자 - 수정내용` (최신이 맨 위)
- 버그픽스 디테일, 내부 리팩토링 등은 생략
- 프로그램 실행 시 첫 줄에서 버전 번호를 읽어 상단 헤더에 표시

### 버전 번호
- devlog.txt와 CHANGELOG.md는 같은 번호 체계 공유
- devlog.txt에 먼저 기록하고, 중요한 것만 CHANGELOG.md에도 추가

### 커밋 규칙
- 커밋 메시지는 버전 숫자만 사용 (예: `1004`)
- 커밋 후 push

## GitHub 릴리즈
- 릴리즈 노트는 **영어**로 작성 (Initial Release와 일관성 유지)
- gh CLI 사용: `gh release create vX.Y.Z`
- gh CLI 경로: `/c/Program Files/GitHub CLI` (PATH에 추가 필요)
- **릴리즈 시 반드시 ZIP 첨부**: `build/TreeRU/` 폴더를 ZIP으로 만들어서 릴리즈에 업로드
  - ZIP 만들기 전에 `build/TreeRU/app/`의 index.js, package.json, CHANGELOG.md를 최신 소스로 동기화
  - node_modules도 `npm install --production`으로 최신화
  - 명령: `gh release upload vX.Y.Z TreeRU-vX.Y.Z.zip`

## Git 설정
- remote는 SSH 방식 사용: `git@github.com:treeru/treeru.git`
- gh CLI 인증 완료 (treeru 계정)

## 코드 작성 시 주의사항
- blessed 태그에서 `{/}` 사용 시 모든 스타일이 리셋됨 → 이후 텍스트에 색상 명시적으로 재지정 필요
- Windows Terminal이 Ctrl+V, Ctrl+C 등을 가로챔 → 터미널 앱에서 쓰는 단축키는 F키 사용
- 배경색 `#1A1A2E`(C.header)에서 `gray` 텍스트는 안 보임 → `#87AFD7` 이상 밝기 사용

## README
- 영문(README.md) + 한국어(README.ko.md) 동시 관리
- 기능 추가/변경 시 양쪽 모두 업데이트
