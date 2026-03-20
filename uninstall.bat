@echo off
chcp 65001 >nul 2>&1
title TreeRU Uninstaller
color 0C

echo.
echo   TreeRU Uninstaller
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Administrator privileges required.
    pause
    exit /b 1
)

set "INSTALL_DIR=%ProgramFiles%\TreeRU"

if not exist "%INSTALL_DIR%" (
    echo [!] TreeRU is not installed.
    pause
    exit /b 1
)

echo Uninstall TreeRU?
echo Path: %INSTALL_DIR%
echo.
set /p confirm="Press Y to confirm: "
if /i not "%confirm%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo [1/2] Removing files...
rmdir /S /Q "%INSTALL_DIR%" >nul 2>&1
echo       Done

echo [2/2] Removing from PATH...
powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('PATH','Machine'); $parts=$p.Split(';') | Where-Object { $_ -ne '%INSTALL_DIR%' }; $newPath=$parts -join ';'; [Environment]::SetEnvironmentVariable('PATH',$newPath,'Machine')"
echo       Done

echo.
echo TreeRU has been removed.
echo.
pause
