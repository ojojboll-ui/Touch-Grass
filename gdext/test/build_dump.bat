@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>nul
cd /d "%~dp0"
cl /nologo /std:c++17 /O2 /EHsc /fp:precise dump.cpp /Fe:dump.exe >nul && "%~dp0dump.exe"
