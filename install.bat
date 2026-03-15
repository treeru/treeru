@echo off
chcp 65001 >nul 2>&1
title TreeRU Installer
color 0A

echo.
echo   TreeRU Installer v1.0
echo   Terminal File Explorer
echo.

:: ── Admin check ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Administrator privileges required.
    echo     Right-click, Run as administrator
    echo.
    pause
    exit /b 1
)

:: ── Install path ──
set "INSTALL_DIR=%ProgramFiles%\TreeRU"
echo [1/4] Install path: %INSTALL_DIR%
echo.

:: ── Node.js check ──
echo [2/4] Checking Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
    echo       Node.js %NODE_VER% found
    echo.
    goto :install_treeru
)

echo       Node.js not found.
echo.
echo [2/4] Installing Node.js...

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
    exit /b 1
)

echo       Installing...
msiexec /i "%NODE_MSI%" /qn /norestart
if %errorlevel% neq 0 (
    echo [X] Install failed!
    echo     Install manually: https://nodejs.org
    pause
    exit /b 1
)
del "%NODE_MSI%" >nul 2>&1
set "PATH=%ProgramFiles%\nodejs;%PATH%"
echo       Node.js installed
echo.

:install_treeru
echo [3/4] Installing TreeRU...

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy all required files
xcopy /Y /Q "%~dp0index.js" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%~dp0package.json" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%~dp0clip_check.ps1" "%INSTALL_DIR%\" >nul
xcopy /Y /Q "%~dp0clip_save.ps1" "%INSTALL_DIR%\" >nul

:: Copy node_modules or install
if exist "%~dp0node_modules" (
    xcopy /E /Y /Q "%~dp0node_modules" "%INSTALL_DIR%\node_modules\" >nul
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
echo [4/4] Registering PATH...

echo %PATH% | find /I "TreeRU" >nul
if %errorlevel% equ 0 (
    echo       Already in PATH
) else (
    setx PATH "%PATH%;%INSTALL_DIR%" /M >nul 2>&1
    if %errorlevel% equ 0 (
        echo       PATH registered
    ) else (
        echo       [!] PATH registration failed
        echo           Add manually: %INSTALL_DIR%
    )
)

echo.
echo   Installation complete!
echo.
echo   Open a new terminal and run:
echo     treeru
echo     treeru C:\path\to\folder
echo.
pause
