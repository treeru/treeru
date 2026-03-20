@echo off
chcp 65001 >nul 2>&1
echo.
echo   Building TreeRU release package...
echo.

set "ROOT=%~dp0"
set "BUILD=%ROOT%build\TreeRU"

:: Clean
if exist "%ROOT%build" rmdir /S /Q "%ROOT%build"
mkdir "%BUILD%\app"

:: install.bat goes to root
copy /Y "%ROOT%install.bat" "%BUILD%\" >nul

:: Everything else goes to app/
copy /Y "%ROOT%index.js" "%BUILD%\app\" >nul
copy /Y "%ROOT%package.json" "%BUILD%\app\" >nul
copy /Y "%ROOT%CHANGELOG.md" "%BUILD%\app\" >nul
copy /Y "%ROOT%clip_check.ps1" "%BUILD%\app\" >nul
copy /Y "%ROOT%clip_save.ps1" "%BUILD%\app\" >nul
copy /Y "%ROOT%treeru.ico" "%BUILD%\app\" >nul
copy /Y "%ROOT%uninstall.bat" "%BUILD%\app\" >nul
xcopy /E /Y /Q "%ROOT%node_modules" "%BUILD%\app\node_modules\" >nul

:: Create ZIP
powershell -NoProfile -Command "Compress-Archive -Path '%BUILD%' -DestinationPath '%ROOT%build\TreeRU-v1.1.0.zip' -Force"

echo.
echo   Done: build\TreeRU-v1.1.0.zip
echo.
pause
