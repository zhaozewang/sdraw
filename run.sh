#!/bin/bash
# Start both backend and frontend for SDraw
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== SDraw - Plot Board ==="
echo ""

# Check Python venv
if [ ! -d "$DIR/backend/venv" ]; then
  echo "Setting up Python virtual environment..."
  cd "$DIR/backend"
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
else
  source "$DIR/backend/venv/bin/activate"
fi

# Check node_modules
if [ ! -d "$DIR/frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  cd "$DIR/frontend"
  npm install
fi

# Generate sample data if not present
if [ ! -f "$DIR/sample_data/line_plot.png" ]; then
  echo "Generating sample data..."
  cd "$DIR"
  python scripts/generate_sample_data.py
fi

echo "Starting backend on http://localhost:8000 ..."
cd "$DIR/backend"
source venv/bin/activate
python main.py &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:3000 ..."
cd "$DIR/frontend"
npx vite --host &
FRONTEND_PID=$!

echo ""
echo "Open http://localhost:3000 in your browser"
echo "Press Ctrl+C to stop both services"
echo ""

cleanup() {
  echo "Stopping services..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  wait
}
trap cleanup EXIT INT TERM

wait
