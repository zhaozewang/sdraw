@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo === SDraw Desktop App Builder (Windows) ===
echo.

:: Step 1: Install Electron deps
echo [1/5] Installing Electron dependencies...
call npm install

:: Step 2: Build frontend
echo [2/5] Building frontend...
cd frontend
call npm install
call npm run build
cd ..

:: Step 3: Build Python backend
echo [3/5] Building Python backend...
cd backend

if not exist "venv" (
  python -m venv venv
)
call venv\Scripts\activate.bat

pip install -r requirements.txt
pip install pyinstaller

python -m PyInstaller ^
  --noconfirm ^
  --onedir ^
  --name sdraw-backend ^
  --add-data "..\frontend\dist;frontend_dist" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import uvicorn.lifespan.off ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.http.h11_impl ^
  --hidden-import uvicorn.protocols.http.httptools_impl ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.protocols.websockets.wsproto_impl ^
  --hidden-import uvicorn.protocols.websockets.websockets_impl ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.loops.asyncio ^
  main.py

call deactivate
cd ..

:: Step 4: Package
echo [4/5] Packaging with electron-builder...
call npx electron-builder --win

echo.
echo === Build complete! ===
echo Output in: release\
dir release\ 2>nul

pause
