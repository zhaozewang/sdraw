<p align="center">
  <h1 align="center">SDraw</h1>
  <p align="center">
    A local-first plot board for arranging, annotating, and composing scientific figures.
    <br />
    <em>Think "draw.io for plots" &mdash; not a dashboard, not a notebook.</em>
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#keyboard-shortcuts">Shortcuts</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/typescript-5.6-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/fastapi-0.104+-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/python-3.10+-3776AB?logo=python&logoColor=white" alt="Python 3.10+" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  <img src="https://img.shields.io/badge/local--first-no_cloud-orange" alt="Local First" />
</p>

---

## Why SDraw?

Researchers run experiments that produce plots into folders. They need to **arrange** those plots into coherent figures — drag, resize, align, label, group — and keep the layout **live** while re-running experiments. When the underlying image files change on disk, the displayed panels refresh automatically. No cloud, no accounts, no sync overhead.

## Features

- **Infinite canvas** — pan, zoom, and arrange unlimited panels on a React Flow canvas
- **Live file watching** — images auto-refresh via WebSocket when source files change on disk
- **Drag-and-drop panels** — add images by browsing local directories or drag-and-drop
- **Rich annotations** — text boxes, arrows, rectangles with full style controls
- **Alignment & snapping** — grid snapping, alignment guides, and smart snap
- **Grouping & layering** — group panels, lock elements, control z-order
- **Inspector panel** — per-element style controls (borders, opacity, fit mode, font, stroke)
- **Keyboard shortcuts** — copy/paste, undo/redo, delete, select-all, zoom controls
- **Auto-save** — boards persist automatically to local JSON files
- **Export** — compose and export figures as PNG/SVG/PDF
- **Recent boards** — quick access to recently opened boards
- **Sample data generator** — Python script to generate demo plots for testing

## Quick Start

### Prerequisites

- **Python 3.10+**
- **Node.js 18+**

### One-command launch

```bash
chmod +x run.sh
./run.sh
```

This will:
1. Create a Python virtualenv and install backend dependencies
2. Install frontend npm packages
3. Generate sample plot data
4. Start the backend (`:8000`) and frontend (`:3000`)

Then open **http://localhost:3000** in your browser.

### Manual setup

**Backend:**

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

**Frontend:**

```bash
cd frontend
npm install
npx vite --host
```

## Architecture

```
sdraw/
├── backend/                 # FastAPI + Python
│   ├── main.py              # App entry, WebSocket endpoint
│   ├── models/board.py      # Pydantic board/element models
│   ├── routers/
│   │   ├── boards.py        # CRUD for board JSON files
│   │   ├── export.py        # PNG/SVG/PDF export
│   │   └── files.py         # Local filesystem browsing & image serving
│   └── services/
│       ├── watcher.py       # File watcher (watchdog) + WebSocket broadcast
│       └── workspace.py     # Workspace/config management
├── frontend/                # React + TypeScript + Vite
│   └── src/
│       ├── App.tsx           # Main app shell (home screen + board view)
│       ├── api/client.ts     # HTTP + WebSocket API client
│       ├── components/
│       │   ├── Canvas/       # React Flow canvas wrapper
│       │   ├── InsertPanel/  # File browser & image inserter
│       │   ├── Inspector/    # Per-element property editor
│       │   ├── StatusBar/    # Bottom status bar
│       │   ├── Toolbar/      # Top toolbar (tools, actions)
│       │   └── nodes/        # Custom React Flow nodes (Image, Text, Rect, Arrow)
│       ├── hooks/            # useAutoSave, useKeyboardShortcuts, useWebSocket
│       ├── store/            # Zustand stores (board state, UI state)
│       ├── types/board.ts    # TypeScript type definitions
│       └── utils/helpers.ts  # Utility functions
├── scripts/                 # Sample data generator
├── run.sh                   # One-command launcher
└── workspace/               # Default workspace directory (git-ignored)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Canvas | [React Flow](https://reactflow.dev/) (xy-flow) |
| UI Components | [Radix UI](https://www.radix-ui.com/) + [Tailwind CSS](https://tailwindcss.com/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Icons | [Lucide](https://lucide.dev/) |
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) |
| File Watching | [watchdog](https://python-watchdog.readthedocs.io/) |
| Real-time | WebSocket (native) |
| Export | [html-to-image](https://github.com/bubkoo/html-to-image) + [Pillow](https://pillow.readthedocs.io/) |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + C` | Copy selected |
| `Ctrl/Cmd + V` | Paste |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + S` | Save board |
| `Delete / Backspace` | Delete selected |
| `Ctrl/Cmd + G` | Group selected |
| `Ctrl/Cmd + Shift + G` | Ungroup |
| `Ctrl/Cmd + L` | Lock/unlock |
| `Ctrl/Cmd + +/-` | Zoom in/out |
| `Ctrl/Cmd + 0` | Fit view |

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Built for researchers who are tired of manually stitching plots together.
</p>
