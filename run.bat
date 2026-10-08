@echo off
TITLE WebRTC Server & Secure Tunnel
cd /d "%CD%"
echo Starting Java WebRTC Signaling Server...
:: Start Java server in a new window automatically
start "Java Server (Do Not Close)" cmd /c "java -cp bin com.transfer.network.WebRelayServer"
:: Wait 2 seconds for server to bind to port 8080
timeout /t 2 /nobreak >nul
echo.
echo ========================================================
echo   GENERATING SECURE HTTPS LINK FOR MOBILE...
echo   Look for the URL that ends in "localhost.run"
echo ========================================================
:: Automatically bypass yes/no prompts and create tunnel
ssh -o StrictHostKeyChecking=no -R 80:localhost:8080 nokey@localhost.run
pause
