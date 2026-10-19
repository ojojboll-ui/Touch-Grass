@echo off
rem build.bat         builds the extension into ..\bin (close Godot first: it locks the dll)
rem build.bat test    builds and runs the offline engine test in test\
setlocal
cd /d "%~dp0"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>nul
where cl >nul 2>nul || (echo cl not found & exit /b 1)

if /i "%1"=="test" (
    cd test
    cl /nologo /std:c++17 /O2 /EHsc /W3 /fp:precise enginetest.cpp /Fe:enginetest.exe || exit /b 1
    "%~dp0test\enginetest.exe"
    exit /b %errorlevel%
)

if not exist extension_api.json (
    "C:\Users\oloff\Downloads\Godot_v4.7.2-stable_win64.exe\Godot_v4.7.2-stable_win64_console.exe" --headless --dump-extension-api || exit /b 1
)
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 ^
    -DPython3_EXECUTABLE="%~dp0..\..\handtrack\.venv\Scripts\python.exe" ^
    -DGODOTCPP_CUSTOM_API_FILE="%~dp0extension_api.json" || exit /b 1
cmake --build build --config Release --parallel || exit /b 1
