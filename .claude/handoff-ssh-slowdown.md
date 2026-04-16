# Session handoff — investigating SSH slowdown when frontend is open

## The problem (user's report)
Opening the sdraw frontend over SSH port-forward makes the SSH connection
extremely slow. User suspects large network transfers. Last working state
was commit `a35fa64` — **do not casually refactor, the software works
otherwise**. User asked to be extra careful and use Playwright MCP (or them)
to measure before changing anything.

## What I already investigated (no code changed yet)

### Likely suspects, ranked
1. **Full autosave blasts the whole board, including base64 payloads**
   - `frontend/src/hooks/useAutoSave.ts:4` — `saveCheckpoint` every 3s of quiet
   - `frontend/src/hooks/useAutoSave.ts:9` — `saveBoard` every 8s of quiet
   - Both go through `frontend/src/api/client.ts:42` (`saveBoardToFile`) and
     `frontend/src/api/client.ts:71` (`saveCheckpoint`), POSTing
     `JSON.stringify({ board, path })`.
   - The board carries, for every plot element, `metadata.lastOutput`
     (base64 PNG, commonly 300–800 KB each), plus `image.source.embeddedData`
     and the `board.thumbnail`. A board with a few figures can hit several
     MB per autosave.

2. **Auto-export POSTs a whole-canvas data URL every 5s**
   - `frontend/src/store/boardStore.ts:1177` `triggerAutoExport`
   - Only fires when `board.autoExport.enabled && outputPath` are set.
   - Renders at `dpi=2` and POSTs the data URL to `/api/export/save`.
   - Unknown whether the user currently has this enabled.

3. **Vite dev bundle over SSH tunnel** — one-time cost on page load, but
   large and will saturate the tunnel briefly.

4. **WebSocket file watcher** (`frontend/src/hooks/useWebSocket.ts`) —
   messages themselves are small, but each event can bump image versions
   and trigger auto-export.

### What I have NOT confirmed
Which of the above is *actually* the one saturating the SSH pipe. I refused
to guess-and-fix; the user said the app works and shouldn't be disturbed.

## Why the session ended here

I asked the user to install Playwright MCP so I could drive a headless
browser, capture the network tab, and *measure* instead of guess. They
ran `claude mcp add playwright npx @playwright/mcp@latest`, but MCPs
register at Claude Code session startup — the newly-added server does
not hot-load. Playwright tools were NOT visible via ToolSearch.

**Next session must be a fresh Claude Code session** so the Playwright MCP
is loaded at startup.

## What to do first in the next session

1. **Verify the MCP is loaded.** Run a ToolSearch for `playwright browser`.
   You should see tools like `mcp__playwright__browser_navigate`,
   `mcp__playwright__browser_network_requests` or similar. If still absent,
   have the user run `claude mcp list` in their shell and share output.

2. **Ask the user for:**
   - The frontend URL they open (likely `http://localhost:<port>`).
   - Whether `board.autoExport.enabled` is on for the board they open
     (Inspector → Board → Auto Export), since that's a top suspect.
   - Which `.sdraw` file they open (ideally one that reproduces the
     slowdown). Likely candidate:
     `/home/zhaoze/projects/grip/plots/multi_compartment/theory.sdraw`
     per prior work.

3. **Measure with Playwright:**
   - Navigate to the frontend URL.
   - Start a network log.
   - Let it sit for ~15 seconds with the app idle on a loaded board.
   - Dump request URLs, sizes, and frequencies.
   - Identify the top offender(s) by **total bytes/sec**, not count.

4. **Propose a targeted fix** — do NOT open the code until the measurement
   points to a specific endpoint. Likely fix shapes (for when we get there):
   - Strip `metadata.lastOutput` and `source.embeddedData` from the
     *checkpoint* payload (keep full autosave intact, since that's the
     "render guarantee" path).
   - Widen the checkpoint/full-save debounce, or skip checkpoints while
     a full save is pending.
   - Gate auto-export more strictly (skip when fingerprint only changes
     in irrelevant fields).

   Whatever the fix ends up being, keep it minimal and do not refactor
   anything unrelated. The autosave + embed + thumbnail path is
   load-bearing for the "render guarantee" — any change must preserve it.

## Files touched in this session
None. All investigation was read-only. Last commit is still `a35fa64`.

## User preferences reminded during this session
- Be extra careful, the software finally works well.
- Prefer measurement over speculation.
- Playwright MCP is the agreed-upon measurement tool.
