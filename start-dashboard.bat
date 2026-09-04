@echo off
REM ======================================================================
REM FINAL OPERATOR DASHBOARD — WINDOWS DOUBLE-CLICK LAUNCHER
REM ======================================================================
setlocal enabledelayedexpansion

title Operator Dashboard - Lead Generation Automation

cd /d "%~dp0"

echo ======================================================================
echo           OPERATOR DASHBOARD — LEAD GENERATION SYSTEM
echo ======================================================================
echo.

REM Verify Node.js presence
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is required but was not found in PATH.
    echo Please install Node.js 18+ and try again.
    pause
    exit /b 1
)

REM Verify if dist-dashboard exists; if not, build it safely
if not exist "dist-dashboard\index.html" (
    echo [INFO] First-time setup: Building local dashboard assets...
    call npm run build:dashboard
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Dashboard build failed.
        pause
        exit /b 1
    )
)

echo [INFO] Starting local dashboard server at http://127.0.0.1:3000...
echo [INFO] A browser window will open automatically once ready.
echo [INFO] Press Ctrl+C in this window to stop the dashboard.
echo.

npm run dashboard
