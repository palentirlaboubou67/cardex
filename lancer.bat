@echo off
cd /d "%~dp0"
echo Cardex tourne sur http://localhost:8000  (Ctrl+C pour arreter)
start "" http://localhost:8000
python -m http.server 8000
