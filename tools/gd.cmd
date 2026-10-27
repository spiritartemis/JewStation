@echo off
REM gd —— JewStation 仓内的 gd-core 入口（Windows 版）
REM 用法：tools\gd <命令> [参数]        例：tools\gd core status
setlocal
node "%~dp0gd-core\core\bin\gd" %*
