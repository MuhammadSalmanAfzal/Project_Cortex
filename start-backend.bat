@echo off
title CityLab Backend
cd /d "%~dp0citylab-explainer\backend"
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
