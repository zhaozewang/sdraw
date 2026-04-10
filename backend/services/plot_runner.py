#!/usr/bin/env python3
"""Standalone plot runner. Executed by the backend in a subprocess.

Usage: python plot_runner.py <code_file_path>

Env vars:
  SDRAW_PLOT_DPI  - DPI for matplotlib output (default 150)

Reads user code from the given file, executes it, and captures any
matplotlib or plotly figure output as a base64-encoded PNG on stdout.
Text output (print statements) is captured separately.

Output format (JSON on stdout):
  {"image": "<base64 png or null>", "stdout": "<captured print output>"}

Errors go to stderr.
"""

import sys
import os
import base64
import io
import json


def main():
    if len(sys.argv) < 2:
        print("Usage: plot_runner.py <code_file>", file=sys.stderr)
        sys.exit(1)

    code_path = sys.argv[1]
    dpi = int(os.environ.get("SDRAW_PLOT_DPI", "150"))

    with open(code_path, "r") as f:
        code = f.read()

    # Force matplotlib to use non-interactive backend before any user imports
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        plt.show = lambda *a, **kw: None  # no-op
    except ImportError:
        pass

    # Capture stdout from user code
    captured_stdout = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured_stdout

    # Execute user code
    ns = {"__name__": "__main__"}
    try:
        exec(compile(code, "<plot>", "exec"), ns)
    finally:
        sys.stdout = old_stdout

    stdout_text = captured_stdout.getvalue()
    image_data = None

    # Try matplotlib first
    try:
        import matplotlib.pyplot as plt
        fig = plt.gcf()
        if fig.get_axes():
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
            buf.seek(0)
            image_data = base64.b64encode(buf.read()).decode("ascii")
            plt.close("all")
    except ImportError:
        pass

    # Try plotly if matplotlib didn't produce output
    if not image_data:
        try:
            import plotly.graph_objects as go
            for val in ns.values():
                if isinstance(val, go.Figure):
                    img_bytes = val.to_image(format="png", scale=2)
                    image_data = base64.b64encode(img_bytes).decode("ascii")
                    break
        except ImportError:
            pass

    # Output JSON result
    result = {
        "image": image_data,
        "stdout": stdout_text,
    }
    old_stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
