#!/usr/bin/env python3
"""Standalone plot runner. Executed by the backend in a subprocess.

Usage: python plot_runner.py <code_file_path>

Env vars:
  SDRAW_PLOT_DPI  - DPI for matplotlib output (default 150)

Reads user code from the given file, executes it, and captures any
matplotlib or plotly figure output as a base64-encoded PNG on stdout.
Text output (print statements) is captured separately.

Output format (JSON on stdout):
  {"image": "<base64 png or null>", "stdout": "<captured print output>", "error": "<traceback or null>"}

Exit code is always 0 if we produce JSON output (error is in the JSON).
Non-zero exit only for runner-level failures (can't read file, etc.)
"""

import sys
import os
import base64
import io
import json
import traceback


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

    # Neutralize plotly show() — otherwise `fig.show()` tries to open a
    # browser / local HTTP server in this headless subprocess.
    try:
        import plotly.graph_objects as _go
        import plotly.io as _pio
        def _plotly_noop_show(*args, **kwargs):
            return None
        _go.Figure.show = _plotly_noop_show  # type: ignore[assignment]
        _pio.show = _plotly_noop_show  # type: ignore[assignment]
    except ImportError:
        pass

    # Capture stdout from user code
    captured_stdout = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured_stdout

    # Execute user code
    ns = {"__name__": "__main__"}
    exec_error = None
    try:
        exec(compile(code, "<plot>", "exec"), ns)
    except Exception:
        exec_error = traceback.format_exc()
    finally:
        sys.stdout = old_stdout

    stdout_text = captured_stdout.getvalue()
    image_data = None

    # Try to capture plot output even if there was an error
    # (user might have created a partial plot before the error)
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
    plotly_json = None
    if not image_data:
        try:
            import plotly.graph_objects as go
            for val in ns.values():
                if isinstance(val, go.Figure):
                    # Capture the figure spec for interactive rendering
                    plotly_json = val.to_json()
                    # Also render a static fallback
                    try:
                        img_bytes = val.to_image(format="png", scale=2)
                        image_data = base64.b64encode(img_bytes).decode("ascii")
                    except Exception:
                        pass  # kaleido not available; frontend will capture
                    break
        except (ImportError, Exception):
            pass

    # Always output JSON result
    result = {
        "image": image_data,
        "stdout": stdout_text,
        "error": exec_error,
        "plotly_json": plotly_json,
    }
    old_stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
