@echo off
title Starting CityLab Diagnostics (Backend & Frontend)
echo ========================================================
echo   CityLab Diagnostics - Problem Statement B
echo   Starting FastAPI Backend and Next.js Frontend...
echo ========================================================

start "CityLab Backend (Port 8000)" cmd /k "cd /d "%~dp0citylab-explainer\backend" && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

timeout /t 2 /nobreak > nul

start "CityLab Frontend (Port 3000)" cmd /k "cd /d "%~dp0citylab-explainer\frontend" && npm run dev"

echo.
echo ========================================================
echo Services started in separate terminal windows:
echo - Frontend: http://localhost:3000
echo - Backend:  http://127.0.0.1:8000
echo - API Docs: http://127.0.0.1:8000/docs
echo ========================================================
pause
