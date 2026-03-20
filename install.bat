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
echo [1/5] Install path: %INSTALL_DIR%
echo.

:: ── Node.js check ──
echo [2/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
    echo       Node.js !NODE_VER! found
    echo.
    goto :install_treeru
)

echo       Node.js not found.
echo.
echo [2/5] Installing Node.js...

where winget >nul 2>&1
if %errorlevel% equ 0 (
    echo       Installing via winget...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -h
    if %errorlevel% equ 0 (
        echo       Node.js installed
        echo.
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
        goto :install_treeru
    )
)

echo       Downloading directly...
set "NODE_MSI=%TEMP%\node-install.msi"
set "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"

powershell -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_MSI%'" 2>nul
if not exist "%NODE_MSI%" (
    echo.
    echo [X] Download failed!
    echo     Install manually: https://nodejs.org
    echo.
    pause
    endlocal
    exit
)

echo       Installing...
msiexec /i "%NODE_MSI%" /qn /norestart
if %errorlevel% neq 0 (
    echo [X] Install failed!
    echo     Install manually: https://nodejs.org
    pause
    endlocal
    exit
)
del "%NODE_MSI%" >nul 2>&1
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo       Node.js installed
echo.

:install_treeru
echo [3/5] Installing TreeRU...

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
echo [4/5] Registering PATH...

powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('PATH','Machine'); if ($p -notlike '*TreeRU*') { [Environment]::SetEnvironmentVariable('PATH', $p + ';%INSTALL_DIR%', 'Machine'); Write-Host '      PATH registered' } else { Write-Host '      Already in PATH' }"

echo.

:: ── Desktop shortcut ──
echo [5/5] Creating desktop shortcut...

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\TreeRU.lnk'); $sc.TargetPath = 'cmd.exe'; $sc.Arguments = '/k \"\"%INSTALL_DIR%\treeru.bat\"\"'; $sc.IconLocation = '%INSTALL_DIR%\treeru.ico,0'; $sc.Description = 'TreeRU - Terminal File Explorer'; $sc.Save(); Write-Host '      Desktop shortcut created'"

echo.
echo   ===============================================
echo   Installation complete!
echo   설치가 완료되었습니다!
echo.
echo   Open a new terminal and run: treeru
echo   새 터미널을 열고 treeru 를 입력하세요.
echo   또는 바탕화면의 TreeRU 아이콘을 클릭하세요.
echo   ===============================================
echo.
pause
endlocal
exit
