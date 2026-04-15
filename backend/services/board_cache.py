"""Centralized board cache at ~/.sdraw/cache/<board-id>/.

Stores large regenerable data (plotlyJson, thumbnails) separate from the
.sdraw file. The .sdraw file stays self-contained (cropped PNGs, embedded
images, code, camera, crop rects) for git portability.

Cache is keyed by board UUID so moving .sdraw files doesn't break it.
If cache is missing, the user re-runs code to regenerate.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CACHE_ROOT = Path.home() / ".sdraw" / "cache"

# Fields cached (stripped from .sdraw, stored in cache).
# Thumbnail used to live here; it now persists in the .sdraw file itself so a
# fresh device shows the preview without re-opening the board. Only plotlyJson
# (the interactive Plotly spec) stays cache-only — that's the stated design.
_CACHE_METADATA_KEYS = {"plotlyJson"}
_CACHE_BOARD_KEYS: set[str] = set()

CURRENT_SCHEMA_VERSION = 3


def migrate_board_schema(board: dict) -> dict:
    """Upgrade an in-memory board dict to the current schema version.

    Returns the same dict reference with any missing fields populated.
    Does NOT write to disk — the next normal save will persist the upgrade.
    """
    version = board.get("schema_version", 1)

    # v1 → v2: introduce board-level setup block
    if version < 2:
        if "setup" not in board or not isinstance(board.get("setup"), dict):
            board["setup"] = {"code": "", "timeout": 120}
        board["schema_version"] = 2

    # v2 → v3: introduce board-level plot code registry. Move every plot
    # element's inline metadata.code to a new registry entry and rewrite
    # sibling-pointer metadata.sourceElementId references to share the same
    # plotCodeId. The frontend also runs this migration (defensively), so
    # nothing breaks if we somehow skip the backend step.
    if version < 3:
        import uuid

        if "plotCodes" not in board or not isinstance(board.get("plotCodes"), dict):
            board["plotCodes"] = {}
        plot_codes: dict = board["plotCodes"]
        elements = board.get("elements") or []

        # Pass 1: legacy sources (had inline code) become registry entries.
        el_to_pcid: dict[str, str] = {}
        for el in elements:
            if el.get("type") != "plot":
                continue
            meta = el.get("metadata") or {}
            if isinstance(meta.get("plotCodeId"), str):
                el_to_pcid[el.get("id", "")] = meta["plotCodeId"]
                continue
            if isinstance(meta.get("code"), str):
                new_id = str(uuid.uuid4())
                plot_codes[new_id] = {"code": meta["code"]}
                meta["plotCodeId"] = new_id
                el_to_pcid[el.get("id", "")] = new_id
                meta.pop("code", None)
                el["metadata"] = meta

        # Pass 2: siblings inherit their old source's plotCodeId.
        for el in elements:
            if el.get("type") != "plot":
                continue
            meta = el.get("metadata") or {}
            if isinstance(meta.get("plotCodeId"), str):
                meta.pop("sourceElementId", None)
                el["metadata"] = meta
                continue
            src_id = meta.get("sourceElementId")
            if isinstance(src_id, str) and src_id in el_to_pcid:
                meta["plotCodeId"] = el_to_pcid[src_id]
                meta.pop("sourceElementId", None)
                el["metadata"] = meta
                continue
            # Orphan plot with no code and no source → give it a fresh entry.
            new_id = str(uuid.uuid4())
            plot_codes[new_id] = {"code": ""}
            meta["plotCodeId"] = new_id
            meta.pop("sourceElementId", None)
            el["metadata"] = meta

        board["schema_version"] = 3

    # Future migrations chain here.
    return board


def _cache_dir(board_id: str) -> Path:
    return CACHE_ROOT / board_id


def save_cache(board: dict) -> None:
    """Extract cacheable data from a board and write to cache dir."""
    board_id = board.get("id")
    if not board_id:
        return

    cache = {}

    # Board-level cache
    for key in _CACHE_BOARD_KEYS:
        if board.get(key):
            cache[key] = board[key]

    # Element-level cache (plotlyJson per element)
    elements_cache = {}
    for el in board.get("elements", []):
        el_id = el.get("id")
        meta = el.get("metadata") or {}
        el_cache = {}
        for key in _CACHE_METADATA_KEYS:
            if meta.get(key):
                el_cache[key] = meta[key]
        if el_cache:
            elements_cache[el_id] = el_cache

    if elements_cache:
        cache["elements"] = elements_cache

    if not cache:
        return

    d = _cache_dir(board_id)
    d.mkdir(parents=True, exist_ok=True)
    try:
        (d / "cache.json").write_text(json.dumps(cache))
    except OSError as e:
        logger.warning("Failed to write cache for board %s: %s", board_id, e)


def load_cache(board_id: str) -> dict:
    """Load cache data for a board. Returns empty dict if not found."""
    d = _cache_dir(board_id)
    cache_file = d / "cache.json"
    if not cache_file.exists():
        return {}
    try:
        return json.loads(cache_file.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read cache for board %s: %s", board_id, e)
        return {}


def strip_cached_fields(board: dict) -> dict:
    """Return a copy of the board with cached fields removed.
    This is what gets written to the .sdraw file.
    """
    clean = {**board}

    # Remove board-level cached fields
    for key in _CACHE_BOARD_KEYS:
        clean.pop(key, None)

    # Remove element-level cached fields
    clean_elements = []
    for el in board.get("elements", []):
        clean_el = {**el}
        if "metadata" in el and el["metadata"]:
            clean_meta = {**el["metadata"]}
            for key in _CACHE_METADATA_KEYS:
                clean_meta.pop(key, None)
            clean_el["metadata"] = clean_meta
        clean_elements.append(clean_el)
    clean["elements"] = clean_elements

    return clean


def merge_cache_into_board(board: dict) -> dict:
    """Merge cached data back into a board loaded from .sdraw file."""
    board_id = board.get("id")
    if not board_id:
        return board

    cache = load_cache(board_id)
    if not cache:
        return board

    merged = {**board}

    # Board-level cache
    for key in _CACHE_BOARD_KEYS:
        if key in cache:
            merged[key] = cache[key]

    # Legacy fallback: older boards cached the thumbnail separately. If the
    # .sdraw doesn't carry one yet, hydrate from cache so the next save
    # migrates it into the file itself.
    if "thumbnail" not in merged and cache.get("thumbnail"):
        merged["thumbnail"] = cache["thumbnail"]

    # Element-level cache
    elements_cache = cache.get("elements", {})
    if elements_cache:
        merged_elements = []
        for el in board.get("elements", []):
            el_cache = elements_cache.get(el.get("id", ""), {})
            if el_cache and "metadata" in el:
                merged_el = {**el, "metadata": {**el["metadata"], **el_cache}}
                merged_elements.append(merged_el)
            else:
                merged_elements.append(el)
        merged["elements"] = merged_elements

    return merged


def delete_cache(board_id: str) -> None:
    """Delete cache for a board."""
    import shutil
    d = _cache_dir(board_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
