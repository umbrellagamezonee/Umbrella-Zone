@echo off
rem Ek din ka poora hisaab (PDF + Excel): us din ka Cash/Account/Credit, kisne credit liya/chukaya,
rem aur Kitchen / Cigarettes / Fridge / Chocolate ka har item alag. Date likho, jaise: day.cmd 2026-10-01
cd /d "%~dp0"
set D=%1
if "%D%"=="" set /p D=Kaunsi date? (jaise 2026-10-01): 
if not exist node_modules call npm install --no-audit --no-fund
node fetch.js || goto :err
call npx tsx day.ts %D% > nul || goto :err
node day-pdf.js %D% || goto :err
echo.
echo Ho gaya. Files yaha hain: %~dp0out
explorer "%~dp0out"
exit /b 0
:err
echo Kuch gadbad hui.
exit /b 1
