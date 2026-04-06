#!/usr/bin/env python3
"""Generate sample plot images and a sample board for development."""

import base64
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Try to use matplotlib for generating sample plots
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

# Try Pillow as fallback
try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "sample_data"
WORKSPACE_DIR = ROOT / "workspace"
BOARDS_DIR = WORKSPACE_DIR / "boards"
RUNNER_PATH = ROOT / "backend" / "services" / "plot_runner.py"


def generate_matplotlib_plots():
    """Generate sample scientific plots using matplotlib."""
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

    np.random.seed(42)
    plots = []

    # A. Line plot
    fig, ax = plt.subplots(figsize=(6, 4))
    x = np.linspace(0, 10, 100)
    for i in range(3):
        ax.plot(x, np.sin(x + i * 0.5) * (1 + i * 0.3), label=f'Condition {i+1}')
    ax.set_xlabel('Time (s)')
    ax.set_ylabel('Signal (mV)')
    ax.set_title('Time Series Comparison')
    ax.legend()
    ax.grid(True, alpha=0.3)
    path = SAMPLE_DIR / "line_plot.png"
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)
    plots.append(("line_plot.png", 900, 600))

    # B. Histogram (was E)
    fig, ax = plt.subplots(figsize=(6, 4))
    data1 = np.random.normal(0, 1, 500)
    data2 = np.random.normal(2, 1.2, 500)
    ax.hist(data1, bins=30, alpha=0.6, label='Group A', color='#4e79a7')
    ax.hist(data2, bins=30, alpha=0.6, label='Group B', color='#e15759')
    ax.set_xlabel('Value')
    ax.set_ylabel('Count')
    ax.set_title('Distribution Comparison')
    ax.legend()
    path = SAMPLE_DIR / "histogram.png"
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)
    plots.append(("histogram.png", 900, 600))

    # C. Scatter plot
    fig, ax = plt.subplots(figsize=(6, 4))
    n = 100
    x = np.random.randn(n)
    y = 0.7 * x + np.random.randn(n) * 0.5
    colors_scatter = np.random.rand(n)
    scatter = ax.scatter(x, y, c=colors_scatter, cmap='viridis', alpha=0.7, edgecolors='white', linewidth=0.5)
    plt.colorbar(scatter, ax=ax, label='Intensity')
    ax.set_xlabel('Feature 1')
    ax.set_ylabel('Feature 2')
    ax.set_title('Correlation Analysis')
    ax.grid(True, alpha=0.2)
    path = SAMPLE_DIR / "scatter_plot.png"
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)
    plots.append(("scatter_plot.png", 900, 600))

    # D. Heatmap
    fig, ax = plt.subplots(figsize=(6, 5))
    data = np.random.rand(8, 8)
    im = ax.imshow(data, cmap='RdBu_r', aspect='auto')
    plt.colorbar(im, ax=ax)
    ax.set_xlabel('Samples')
    ax.set_ylabel('Features')
    ax.set_title('Expression Heatmap')
    path = SAMPLE_DIR / "heatmap.png"
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)
    plots.append(("heatmap.png", 900, 750))

    return plots


def generate_pillow_plots():
    """Generate simple placeholder images using Pillow."""
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

    plots = []
    names = ["line_plot", "histogram", "scatter_plot", "heatmap"]
    colors = ["#4e79a7", "#e15759", "#f28e2b", "#76b7b2"]

    for name, color in zip(names, colors):
        img = Image.new('RGB', (600, 400), 'white')
        draw = ImageDraw.Draw(img)
        draw.rectangle([10, 10, 589, 389], outline=color, width=3)
        import random
        random.seed(hash(name))
        points = [(20 + i * 5, 200 + random.randint(-150, 150)) for i in range(112)]
        for i in range(len(points) - 1):
            draw.line([points[i], points[i+1]], fill=color, width=2)
        draw.text((250, 20), name.replace('_', ' ').title(), fill='#333333')

        path = SAMPLE_DIR / f"{name}.png"
        img.save(path)
        plots.append((f"{name}.png", 600, 400))

    return plots


def run_plot_code(code: str) -> str | None:
    """Run Python plot code through plot_runner and return base64 PNG, or None on failure."""
    import tempfile
    if not RUNNER_PATH.is_file():
        print(f"  WARNING: plot_runner.py not found at {RUNNER_PATH}")
        return None

    python = sys.executable
    tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, prefix='sdraw_sample_')
    try:
        tmp.write(code)
        tmp.close()
        env = {**os.environ, "SDRAW_PLOT_DPI": "150"}
        result = subprocess.run(
            [python, str(RUNNER_PATH), tmp.name],
            capture_output=True, text=True, timeout=30, env=env,
        )
        if result.returncode != 0:
            print(f"  Plot execution failed: {result.stderr.strip()[:200]}")
            return None
        b64 = result.stdout.strip()
        if b64:
            return b64
        print("  Plot produced no output")
        return None
    except Exception as e:
        print(f"  Plot execution error: {e}")
        return None
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# Python code for the in-line plot elements
INLINE_PLOT_CODE = """\
import matplotlib.pyplot as plt
import numpy as np

# Box plot with individual data points
np.random.seed(42)
groups = ['A', 'B', 'C', 'D', 'E']
data = [np.random.normal(loc, 1, 50) for loc in [2, 3, 2.5, 4, 3.5]]
colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f']

fig, ax = plt.subplots(figsize=(6, 4))
bp = ax.boxplot(data, labels=groups, patch_artist=True, widths=0.5)
for patch, c in zip(bp['boxes'], colors):
    patch.set_facecolor(c)
    patch.set_alpha(0.7)

# Overlay individual points
for i, d in enumerate(data):
    jitter = np.random.uniform(-0.1, 0.1, len(d))
    ax.scatter(np.full_like(d, i + 1) + jitter, d,
               alpha=0.4, s=12, color=colors[i], edgecolors='none')

ax.set_ylabel('Measurement')
ax.set_title('Group Statistics')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
fig.tight_layout()
"""

INLINE_PLOTLY_3D_CODE = """\
import plotly.graph_objects as go
import numpy as np

# Generate a 3D mesh surface
np.random.seed(0)
x = np.linspace(-3, 3, 50)
y = np.linspace(-3, 3, 50)
X, Y = np.meshgrid(x, y)
Z = np.sin(np.sqrt(X**2 + Y**2)) * np.cos(X * 0.5)

fig = go.Figure(data=[go.Surface(
    x=X, y=Y, z=Z,
    colorscale='Viridis',
    showscale=True,
    colorbar=dict(title='Z'),
)])

fig.update_layout(
    title='3D Surface Mesh',
    scene=dict(
        xaxis_title='X',
        yaxis_title='Y',
        zaxis_title='Z',
        camera=dict(eye=dict(x=1.5, y=1.5, z=1.0)),
    ),
    width=700,
    height=500,
    margin=dict(l=20, r=20, t=40, b=20),
)
"""


def create_sample_board(plots):
    """Create a sample board JSON pre-wired to the generated plots."""
    BOARDS_DIR.mkdir(parents=True, exist_ok=True)

    board_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    elements = []

    # Title
    elements.append({
        "id": str(uuid.uuid4()),
        "type": "text",
        "x": 60,
        "y": 20,
        "width": 500,
        "height": 40,
        "z_index": 100,
        "locked": False,
        "visible": True,
        "rotation": 0,
        "style": {
            "fontSize": 28,
            "fontWeight": 700,
            "color": "#111111",
            "background": "transparent",
            "padding": 4,
            "textAlign": "left"
        },
        "text": "Sample Figure Board",
        "metadata": {}
    })

    # Layout: 6 panels in a 3x2 grid
    # A: line_plot, B: histogram, C: scatter_plot, D: heatmap (static)
    # E: matplotlib box plot (python), F: plotly 3D (python)
    python_plots = [
        (INLINE_PLOT_CODE, 'In-line Python — matplotlib'),
        (INLINE_PLOTLY_3D_CODE, 'In-line Python — Plotly 3D'),
    ]

    # Pre-render python plots
    python_outputs = []
    for code, label in python_plots:
        print(f"  Running python plot: {label}...")
        b64 = run_plot_code(code)
        python_outputs.append(b64)
        if b64:
            print(f"    OK ({len(b64)} bytes)")
        else:
            print(f"    Failed — will show as empty plot node")

    labels = ['A', 'B', 'C', 'D', 'E', 'F']
    descriptions = [
        'Static image — time series',
        'Static image — histogram',
        'Static image — scatter plot',
        'Static image — heatmap',
        python_plots[0][1],
        python_plots[1][1],
    ]

    cols = 3
    gap = 30
    panel_w = 420
    panel_h = 300
    start_x = 60
    start_y = 80
    total_items = len(plots) + len(python_plots)

    for i in range(total_items):
        col = i % cols
        row = i // cols
        x = start_x + col * (panel_w + gap)
        y = start_y + row * (panel_h + gap + 60)

        is_python_plot = (i >= len(plots))

        # Panel label (A, B, C, ...)
        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": x,
            "y": y,
            "width": 30,
            "height": 30,
            "z_index": 50 + i * 3 + 2,
            "locked": False,
            "visible": True,
            "rotation": 0,
            "style": {
                "fontSize": 22,
                "fontWeight": 700,
                "color": "#111111",
                "background": "transparent",
                "padding": 2,
                "textAlign": "center"
            },
            "text": labels[i] if i < len(labels) else "",
            "metadata": {}
        })

        if is_python_plot:
            py_idx = i - len(plots)
            elements.append({
                "id": str(uuid.uuid4()),
                "type": "plot",
                "x": x + 35,
                "y": y,
                "width": panel_w - 35,
                "height": panel_h,
                "z_index": 50 + i * 3 + 1,
                "locked": False,
                "visible": True,
                "rotation": 0,
                "style": {
                    "borderColor": "#d0d0d0",
                    "borderWidth": 1,
                    "borderRadius": 6,
                    "shadow": True,
                    "background": "#ffffff",
                    "opacity": 1
                },
                "metadata": {
                    "code": python_plots[py_idx][0],
                    "lastOutput": python_outputs[py_idx],
                    "lastError": None
                }
            })
        else:
            filename, w, h = plots[i]
            abs_path = str((SAMPLE_DIR / filename).resolve())
            elements.append({
                "id": str(uuid.uuid4()),
                "type": "image",
                "x": x + 35,
                "y": y,
                "width": panel_w - 35,
                "height": panel_h,
                "z_index": 50 + i * 3 + 1,
                "locked": False,
                "visible": True,
                "rotation": 0,
                "style": {
                    "borderColor": "#d0d0d0",
                    "borderWidth": 1,
                    "borderRadius": 6,
                    "shadow": True,
                    "background": "#ffffff",
                    "fitMode": "contain",
                    "opacity": 1
                },
                "source": {
                    "mode": "exact",
                    "path": abs_path,
                    "followLatest": False,
                    "autoRefresh": True
                },
                "crop": None,
                "metadata": {
                    "lastKnownWidth": w,
                    "lastKnownHeight": h
                }
            })

        # Description text below the plot
        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": x + 35,
            "y": y + panel_h + 4,
            "width": panel_w - 35,
            "height": 20,
            "z_index": 50 + i * 3,
            "locked": False,
            "visible": True,
            "rotation": 0,
            "style": {
                "fontSize": 20,
                "fontWeight": 600,
                "color": "#374151",
                "background": "transparent",
                "padding": 2,
                "textAlign": "center"
            },
            "text": descriptions[i] if i < len(descriptions) else "",
            "metadata": {}
        })

    # A decorative rectangle around the top row
    elements.append({
        "id": str(uuid.uuid4()),
        "type": "rectangle",
        "x": start_x - 10,
        "y": start_y - 10,
        "width": cols * (panel_w + gap) - gap + 20,
        "height": panel_h + 20,
        "z_index": 1,
        "locked": False,
        "visible": True,
        "rotation": 0,
        "style": {
            "strokeColor": "#e2e8f0",
            "strokeWidth": 1,
            "strokeStyle": "dashed",
            "fill": "transparent",
            "borderRadius": 8,
            "opacity": 0.5
        },
        "metadata": {}
    })

    board = {
        "schema_version": 1,
        "id": board_id,
        "name": "Sample Figure Board",
        "canvas": {
            "width": 1500,
            "height": 1100,
            "background": "#ffffff",
            "grid_enabled": True,
            "grid_size": 20,
            "grid_pattern": "dots",
            "snap_enabled": True,
            "snap_size": 10
        },
        "elements": elements,
        "created_at": now,
        "updated_at": now,
        "app_version": "0.1.0"
    }

    board_path = BOARDS_DIR / f"{board_id}.sdraw"
    board_path.write_text(json.dumps(board, indent=2))
    print(f"Created board: {board_path}")

    # Write workspace config
    config_path = WORKSPACE_DIR / "config.json"
    config = {
        "recent_boards": [board_id],
        "watched_roots": [str(SAMPLE_DIR.resolve())],
        "allowed_roots": [str(SAMPLE_DIR.resolve())],
        "default_export_dpi": 150
    }
    config_path.write_text(json.dumps(config, indent=2))
    print(f"Updated config: {config_path}")

    return board_id


def main():
    print("Generating sample data...")

    if HAS_MPL:
        print("Using matplotlib for high-quality plots")
        plots = generate_matplotlib_plots()
    elif HAS_PIL:
        print("Using Pillow for placeholder plots (install matplotlib for better samples)")
        plots = generate_pillow_plots()
    else:
        print("ERROR: Neither matplotlib nor Pillow available.")
        print("Install with: pip install matplotlib numpy  OR  pip install Pillow")
        sys.exit(1)

    print(f"Generated {len(plots)} sample plots in {SAMPLE_DIR}")

    board_id = create_sample_board(plots)
    print(f"Created sample board with ID: {board_id}")
    print("\nDone! Start the app and the sample board will be available.")


if __name__ == "__main__":
    main()
