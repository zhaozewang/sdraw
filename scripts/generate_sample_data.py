#!/usr/bin/env python3
"""Generate sample plot images and a sample board for development."""

import json
import os
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


def generate_matplotlib_plots():
    """Generate sample scientific plots using matplotlib."""
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

    np.random.seed(42)
    plots = []

    # 1. Line plot
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

    # 2. Bar chart
    fig, ax = plt.subplots(figsize=(6, 4))
    categories = ['Control', 'Treatment A', 'Treatment B', 'Treatment C']
    values = [23.5, 31.2, 28.7, 35.1]
    errors = [2.1, 3.4, 2.8, 4.0]
    colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2']
    ax.bar(categories, values, yerr=errors, capsize=5, color=colors, edgecolor='white')
    ax.set_ylabel('Response Rate (%)')
    ax.set_title('Treatment Comparison')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    path = SAMPLE_DIR / "bar_chart.png"
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)
    plots.append(("bar_chart.png", 900, 600))

    # 3. Scatter plot
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

    # 4. Heatmap
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

    # 5. Histogram
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

    # 6. Box plot
    fig, ax = plt.subplots(figsize=(5, 4))
    data = [np.random.normal(loc, 1, 50) for loc in [2, 3, 2.5, 4, 3.5]]
    bp = ax.boxplot(data, labels=['A', 'B', 'C', 'D', 'E'], patch_artist=True)
    colors_box = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f']
    for patch, color in zip(bp['boxes'], colors_box):
        patch.set_facecolor(color)
        patch.set_alpha(0.7)
    ax.set_ylabel('Measurement')
    ax.set_title('Group Statistics')
    path = SAMPLE_DIR / "boxplot.png"
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)
    plots.append(("boxplot.png", 750, 600))

    return plots


def generate_pillow_plots():
    """Generate simple placeholder images using Pillow."""
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

    plots = []
    names = ["line_plot", "bar_chart", "scatter_plot", "heatmap", "histogram", "boxplot"]
    colors = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948"]

    for name, color in zip(names, colors):
        img = Image.new('RGB', (600, 400), 'white')
        draw = ImageDraw.Draw(img)
        # Draw a border
        draw.rectangle([10, 10, 589, 389], outline=color, width=3)
        # Draw some lines to simulate a plot
        import random
        random.seed(hash(name))
        points = [(20 + i * 5, 200 + random.randint(-150, 150)) for i in range(112)]
        for i in range(len(points) - 1):
            draw.line([points[i], points[i+1]], fill=color, width=2)
        # Label
        draw.text((250, 20), name.replace('_', ' ').title(), fill='#333333')

        path = SAMPLE_DIR / f"{name}.png"
        img.save(path)
        plots.append((f"{name}.png", 600, 400))

    return plots


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

    # Image panels in a grid
    cols = 3
    gap = 30
    panel_w = 420
    panel_h = 300
    start_x = 60
    start_y = 80

    labels = ['A', 'B', 'C', 'D', 'E', 'F']

    for i, (filename, w, h) in enumerate(plots):
        col = i % cols
        row = i // cols
        x = start_x + col * (panel_w + gap)
        y = start_y + row * (panel_h + gap + 40)

        # Label
        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": x,
            "y": y,
            "width": 30,
            "height": 30,
            "z_index": 50 + i * 2 + 1,
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

        # Image
        abs_path = str((SAMPLE_DIR / filename).resolve())
        elements.append({
            "id": str(uuid.uuid4()),
            "type": "image",
            "x": x + 35,
            "y": y,
            "width": panel_w - 35,
            "height": panel_h,
            "z_index": 50 + i * 2,
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
            "height": 1000,
            "background": "#ffffff",
            "grid_enabled": True,
            "grid_size": 20,
            "snap_enabled": True,
            "snap_size": 10
        },
        "elements": elements,
        "created_at": now,
        "updated_at": now,
        "app_version": "0.1.0"
    }

    board_path = BOARDS_DIR / f"{board_id}.json"
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
