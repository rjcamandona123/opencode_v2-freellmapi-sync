@echo off
rem Windows shim: `opencode` with FreeLLMAPI auto-activation.
rem Put this directory before the real opencode.exe in PATH.
node "%~dp0opencode-launcher.js" %*
exit /b %ERRORLEVEL%
