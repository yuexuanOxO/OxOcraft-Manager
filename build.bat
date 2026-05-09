@echo off
setlocal

cd /d "%~dp0"

echo ================================
echo OxOcraft-Manager Build
echo ================================

if not exist "app.py" (
    echo [ERROR] Please run this build.bat from the OxOcraft-Manager project root.
    pause
    exit /b 1
)

if not exist "backend\credentials\google_credentials.json" (
    echo [ERROR] Missing backend\credentials\google_credentials.json
    echo This file is required for Google Drive login and will be bundled.
    pause
    exit /b 1
)

echo.
echo Cleaning old build output...
if exist "build" rmdir /s /q "build"
if exist "dist\OxOcraft-Manager" rmdir /s /q "dist\OxOcraft-Manager"

echo.
echo Building with PyInstaller...
pyinstaller OxOcraft-Manager.spec

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo Build completed.
echo Output:
echo   dist\OxOcraft-Manager\OxOcraft-Manager.exe
echo.
echo Reminder:
echo   server.jar is NOT bundled.
echo   Put server.jar beside OxOcraft-Manager.exe before running.
echo.
pause
