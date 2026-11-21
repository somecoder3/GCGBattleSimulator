@echo off
rem Startet das Labor (Simulator, Replays, Daten in data-lab\) und oeffnet es im Browser: http://localhost:5180
rem Doppelklick genuegt; beenden mit Strg+C oder durch Schliessen des Fensters.
title GCG Battle Simulator - Labor
cd /d "%~dp0"

if not exist "node_modules\" (
  echo node_modules fehlt, installiere Abhaengigkeiten ^(npm ci^) ...
  call npm ci || goto :error
)
if not exist "gcgdb\data\cards.json" (
  echo Submodul gcgdb fehlt, hole es ...
  git submodule update --init gcgdb || goto :error
)
if not exist "build\images\" (
  echo Hinweis: Keine Kartenbilder in build\images. Bei Bedarf "npm run images" ausfuehren.
)

call npm run lab -- --open
goto :eof

:error
echo.
echo Fehler beim Vorbereiten, siehe oben.
pause
exit /b 1
