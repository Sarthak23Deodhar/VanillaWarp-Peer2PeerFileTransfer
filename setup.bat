@echo off
cd /d "%~dp0"
where javac >nul 2>nul
if errorlevel 1 (
  echo Install JDK 17 or newer and add javac to PATH.
  pause
  exit /b 1
)
if not exist out\vanillawarp mkdir out\vanillawarp
javac -d out\vanillawarp src\com\transfer\network\WebRelayServer.java src\com\transfer\gui\P2PApplicationGUI.java
if errorlevel 1 (
  echo Compilation failed.
  pause
  exit /b 1
)
echo Build complete. Run run.bat to start the server and tunnel.
pause
