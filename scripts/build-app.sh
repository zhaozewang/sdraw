#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== SDraw Desktop App Builder ==="
echo ""

# Detect platform
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="mac" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
  Linux) PLATFORM="linux" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac
echo "[1/5] Platform: $PLATFORM"

# Step 1: Install Electron dependencies
echo "[2/5] Installing Electron dependencies..."
npm install

# Step 2: Build frontend
echo "[3/5] Building frontend..."
cd frontend
npm install
npm run build
cd "$ROOT"

# Step 3: Set up Python venv and install PyInstaller
echo "[4/5] Building Python backend..."
cd backend

if [ ! -d "venv" ]; then
  python3 -m venv venv
fi

if [ "$PLATFORM" = "win" ]; then
  source venv/Scripts/activate
else
  source venv/bin/activate
fi

pip install -r requirements.txt
pip install pyinstaller

# Build with PyInstaller using the spec file
python3 -m PyInstaller --noconfirm sdraw-backend.spec

deactivate 2>/dev/null || true
cd "$ROOT"

# Step 4: Package with electron-builder
echo "[5/5] Packaging with electron-builder..."
case "$PLATFORM" in
  mac)   npx electron-builder --mac ;;
  win)   npx electron-builder --win ;;
  linux) npx electron-builder --linux ;;
esac

echo ""
echo "=== Build complete! ==="
echo "Output in: $ROOT/release/"
ls -la "$ROOT/release/" 2>/dev/null || echo "(check release/ directory)"
