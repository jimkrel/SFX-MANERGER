@echo off
title SFX Music Manager
cd /d "%~dp0"
echo Starting SFX Music Manager...
if exist "node_modules\.bin\electron.cmd" (
    call "node_modules\.bin\electron.cmd" .
) else (
    call pnpm start
)
