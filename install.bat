@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title TreeRU Installer
color 0A

echo.
echo   TreeRU Installer v1.0
echo   Terminal File Explorer
echo.

:: ── Admin auto-elevate ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    endlocal
    exit
)

:: ── Install path ──
set "INSTALL_DIR=%ProgramFiles%\TreeRU"
set "SCRIPT_DIR=%~dp0"
echo [1/6] Install path: %INSTALL_DIR%
echo.

:: ── Node.js check ──
echo [2/6] Checking Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
    echo       Node.js !NODE_VER! found
    echo.
    goto :install_wt
)

echo       Node.js not found.
echo.
echo [2/6] Installing Node.js v20 LTS...

:: ── Method 1: Direct MSI download (most reliable) ──
echo       Downloading Node.js...
set "NODE_MSI=%TEMP%\node-install.msi"
set "NODE_URL=https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi"

powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_MSI%'" 2>nul
if exist "%NODE_MSI%" (
    echo       Installing...
    msiexec /i "%NODE_MSI%" /qn /norestart
    del "%NODE_MSI%" >nul 2>&1
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>&1
    if !errorlevel! equ 0 (
        echo       Node.js installed
        echo.
        goto :install_wt
    )
)

:: ── Method 2: winget fallback ──
echo       Direct download failed, trying winget...
where winget >nul 2>&1
if %errorlevel% equ 0 (
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -h --source winget --disable-interactivity
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>&1
    if !errorlevel! equ 0 (
        echo       Node.js installed
        echo.
        goto :install_wt
    )
)

:: ── Both methods failed — continue anyway ──
echo.
echo [!] Node.js auto-install failed. Continuing without Node.js...
echo     You can install it manually later: https://nodejs.org
echo.
echo [!] Node.js 자동 설치에 실패했습니다. 설치를 계속합니다.
echo     나중에 https://nodejs.org 에서 Node.js를 직접 설치해주세요.
echo.

:install_wt
:: ── Windows Terminal check & update ──
echo [3/6] Checking Windows Terminal...
where wt >nul 2>&1
if %errorlevel% equ 0 (
    echo       Windows Terminal found. Updating to latest...
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        winget upgrade Microsoft.WindowsTerminal --accept-source-agreements --accept-package-agreements -h --disable-interactivity --source winget 2>nul
    )
    echo       Windows Terminal is up to date
    echo.
    goto :install_treeru
)

echo       Windows Terminal not found.
echo.
echo [3/6] Installing Windows Terminal...

where winget >nul 2>&1
if %errorlevel% equ 0 (
    winget install Microsoft.WindowsTerminal --accept-source-agreements --accept-package-agreements -h --source msstore --disable-interactivity 2>nul
    where wt >nul 2>&1
    if !errorlevel! equ 0 (
        echo       Windows Terminal installed
        echo.
        goto :install_treeru
    )
)

echo.
echo [!] Windows Terminal auto-install failed.
echo     Install from Microsoft Store: "Windows Terminal"
echo     https://apps.microsoft.com/detail/9N0DX20HK701
echo.
echo [!] Windows Terminal 자동 설치에 실패했습니다.
echo     Microsoft Store에서 "Windows Terminal"을 검색하여 설치해주세요.
echo     https://apps.microsoft.com/detail/9N0DX20HK701
echo.

:install_treeru
echo [4/6] Installing TreeRU...

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Source files are in app/ subfolder
set "APP_DIR=%SCRIPT_DIR%app\"

:: Copy all required files
xcopy /Y /Q "%APP_DIR%index.js" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%APP_DIR%package.json" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%APP_DIR%CHANGELOG.md" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%APP_DIR%clip_check.ps1" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%APP_DIR%clip_save.ps1" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%APP_DIR%treeru.ico" "%INSTALL_DIR%\" >nul

:: Copy node_modules or install
if exist "%APP_DIR%node_modules" (
    xcopy /E /Y /Q "%APP_DIR%node_modules" "%INSTALL_DIR%\node_modules\" >nul
) else (
    pushd "%INSTALL_DIR%"
    call npm install --production >nul 2>&1
    popd
)

:: Create launcher with UTF-8 codepage
(
    echo @echo off
    echo chcp 65001 ^>nul 2^>^&1
    echo node "%INSTALL_DIR%\index.js" %%*
) > "%INSTALL_DIR%\treeru.bat"

echo       Files copied
echo.

:: ── PATH ──
echo [5/6] Registering PATH...

powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('PATH','Machine'); if ($p -notlike '*TreeRU*') { [Environment]::SetEnvironmentVariable('PATH', $p + ';%INSTALL_DIR%', 'Machine'); Write-Host '      PATH registered' } else { Write-Host '      Already in PATH' }"

echo.

:: ── Shortcuts ──
echo [6/6] Creating shortcuts...

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\TreeRU.lnk'); $sc.TargetPath = 'cmd.exe'; $sc.Arguments = '/k \"\"%INSTALL_DIR%\treeru.bat\"\"'; $sc.IconLocation = '%INSTALL_DIR%\treeru.ico,0'; $sc.Description = 'TreeRU - Terminal File Explorer'; $sc.Save(); Write-Host '      Desktop shortcut created'"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%SCRIPT_DIR%TreeRU.lnk'); $sc.TargetPath = 'cmd.exe'; $sc.Arguments = '/k \"\"%INSTALL_DIR%\treeru.bat\"\"'; $sc.IconLocation = '%INSTALL_DIR%\treeru.ico,0'; $sc.Description = 'TreeRU - Terminal File Explorer'; $sc.Save(); Write-Host '      Local shortcut created'"

:: ── Verify installation ──
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo   ===============================================
    echo   Files installed, but Node.js is missing.
    echo   Install Node.js from https://nodejs.org
    echo   Then open a new terminal and run: treeru
    echo.
    echo   파일은 설치되었으나 Node.js가 없습니다.
    echo   https://nodejs.org 에서 Node.js 설치 후
    echo   새 터미널에서 treeru 를 입력하세요.
    echo   ===============================================
) else (
    echo.
    echo   ===============================================
    echo   Installation complete!
    echo   설치가 완료되었습니다!
)
echo.
echo   Open a new terminal and run: treeru
echo   새 터미널을 열고 treeru 를 입력하세요.
echo   또는 바탕화면의 TreeRU 아이콘을 클릭하세요.
echo   ===============================================
echo.
pause
endlocal
exit
