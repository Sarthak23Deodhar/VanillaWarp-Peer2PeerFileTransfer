@echo off
TITLE Java WebRTC Secure P2P Installer
echo ========================================================
echo   Setting up WebRTC Secure P2P Transfer...
echo ========================================================

:: 1. Create Directories
mkdir src\com\transfer\network 2>nul
mkdir bin 2>nul
mkdir resources 2>nul

:: 2. Create Schema File
(
echo CREATE TABLE IF NOT EXISTS transfer_logs ^(
echo     session_id VARCHAR^(64^) PRIMARY KEY,
echo     event_type VARCHAR^(50^) NOT NULL,
echo     status VARCHAR^(20^) NOT NULL
echo ^);
) > resources\schema.sql

:: 3. Compile Java Source Code
echo Compiling Java Signaling Server...
javac -d bin src\com\transfer\network\WebRelayServer.java

:: 4. Create the Automated ONE-CLICK Run Script
(
echo @echo off
echo TITLE WebRTC Server ^& Secure Tunnel
echo cd /d "%%CD%%"
echo echo Starting Java WebRTC Signaling Server...
echo :: Start Java server in a new window automatically
echo start "Java Server (Do Not Close)" cmd /c "java -cp bin com.transfer.network.WebRelayServer"
echo :: Wait 2 seconds for server to bind to port 8080
echo timeout /t 2 /nobreak ^>nul
echo echo.
echo echo ========================================================
echo echo   GENERATING SECURE HTTPS LINK FOR MOBILE...
echo echo   Look for the URL that ends in "localhost.run"
echo echo ========================================================
echo :: Automatically bypass yes/no prompts and create tunnel
echo ssh -o StrictHostKeyChecking=no -R 80:localhost:8080 nokey@localhost.run
echo pause
) > run.bat

echo ========================================================
echo   INSTALLATION COMPLETE! 
echo   From now on, just double-click 'run.bat' for ONE-CLICK startup!
echo ========================================================
pause