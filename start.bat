@echo off
title WinGo Real-Time Prediction Studio
echo Starting WinGo Real-Time Prediction Studio on port 8088...
timeout /t 1 >nul
start http://localhost:8088
python server.py
pause
