@echo off
setlocal

set "APP_VERSION=%~1"
if "%APP_VERSION%"=="" (
  if exist "..\VERSION.txt" set /p APP_VERSION=<"..\VERSION.txt"
)
if "%APP_VERSION%"=="" set "APP_VERSION=0.0.0-dev"

set "RUNTIME=%~2"
if "%RUNTIME%"=="" set "RUNTIME=win-x64"

set "ISCC_EXE="
where ISCC.exe >nul 2>nul
if "%ERRORLEVEL%"=="0" set "ISCC_EXE=ISCC.exe"
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC_EXE=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC_EXE=%ProgramFiles%\Inno Setup 6\ISCC.exe"

if "%ISCC_EXE%"=="" (
  echo Inno Setup 6 was not found. Install it or add ISCC.exe to PATH.
  exit /b 1
)

"%ISCC_EXE%" /DAppVersion="%APP_VERSION%" /DRuntime="%RUNTIME%" stackarr.iss
