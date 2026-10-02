@echo off
rem Credit Hisaab (PDF + Excel) banata hai taaza data se. Result "out" folder mein aata hai.
cd /d "%~dp0"
if not exist node_modules call npm install --no-audit --no-fund
node fetch.js || goto :err
call npx tsx gen.ts > nul || goto :err
node pdf.js || goto :err
node xlsx.js || goto :err
echo.
echo Ho gaya. Files yaha hain: %~dp0out
explorer "%~dp0out"
exit /b 0
:err
echo Kuch gadbad hui.
exit /b 1
