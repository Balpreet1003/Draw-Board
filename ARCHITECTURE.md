# Collaborative Canvas Architecture

## Runtime Overview

The application is now hosted as two independent services:

- **Frontend (`frontend/`)** – vanilla ES modules rendered in the browser and deployed as static assets (Vercel).
- **Backend (`server/`)** – Node.js + Socket.IO service deployed to Render.

The browser client renders onto an HTML5 canvas and streams drawing events to the backend. Clients are authoritative over in-progress strokes, while the server owns the final operation history and cursor presence for every connected user.

### Data Flow Diagram

```
┌────────────┐        pointer events        ┌────────────┐
│  User Hand │ ───────────────────────────▶ │ canvas.js  │
└────────────┘                               │  (UI)     │
                                             │ smooth +  │
                                             │ batch     │
                                             └────┬──────┘
                                                 │ onSegment
                                                 ▼
                                         ┌──────────────┐
                                         │ websocket.js │
                                         │  (client)    │
                                         └────┬─────────┘
                                              │ Socket.IO
                                              ▼
                                     ┌──────────────────────┐
                                     │  server/server.js    │
                                     │  + drawing-state.js  │
                                     └────┬────────┬────────┘
                                          │        │
                global_history_update ◀───┘        └───▶ broadcast draw_event
                                          │
                                          ▼
                                ┌────────────────────┐
                                │ Other client tabs  │
                                │ canvas.js redraw() │
                                └────────────────────┘
```

## Client Modules

- `frontend/canvas.js` – Owns the `<canvas>` context, translates pointer events into smoothed brush paths, and exposes pure drawing helpers for remote playback.
- `frontend/websocket.js` – Wraps the Socket.IO client (loaded from the official CDN), resolves the backend URL from `app-config.js`, serialises outgoing messages, throttles cursor broadcasts, and forwards server events to consumers.
- `frontend/main.js` – Coordinates UI controls, binds the canvas callbacks to websocket emitters, keeps a local history cache for fast redraws, and renders remote cursors & user presence.

## WebSocket Protocol

| Event | Direction | Payload | Notes |
| --- | --- | --- | --- |
| `draw_event` | client → server | `{ strokeId, tool, color, width, from:{x,y}, to:{x,y} }` | Fired on every pointer move while drawing. The server sanitises and fan-outs to other clients for immediate rendering. |
| `stroke_complete` | client ↔ server | `{ strokeId, tool, color, width, points:[{x,y}, …] }` | Sent on pointerup. Server normalises, appends to history, and broadcasts the canonical operation so all caches stay consistent. |
| `global_history_update` | server → client | `Operation[]` | Full history snapshot emitted after undo/redo or when a new user joins. Clients clear and redraw the canvas using `redrawCanvas`. |
| `request_undo` / `request_redo` | client → server | `null` | Commands the server to mutate the global history stack. |
| `user_list_update` | server → client | `[{ id, color, label }]` | Updates the collaborator sidebar. |
| `cursor_move` | client → server | `{ x, y }` or `null` | Throttled position stream; `null` removes the cursor. |
| `set_display_name` | client → server | `string` (acknowledged) | Sanitises and persists a user's preferred label; ack returns `{ ok, label \| error }`. |
| `display_name_update_result` | server → client | `{ ok, label \| error }` | Confirmation emitted alongside the ack so clients can update UI even if the callback is dropped. |
| `user_cursors` | server → client | `[{ id, color, position, label }]` | Rendered as floating markers above the canvas (local cursor omitted). |

## Undo/Redo Strategy

`server/drawing-state.js` is the single source of truth. It keeps two stacks:

- `operationHistory` – ordered list of committed strokes.
- `redoStack` – operations that have been undone and can be reinstated.

Workflow:

1. `stroke_complete` pushes a normalised operation onto `operationHistory` and clears `redoStack`.
2. `request_undo` pops from `operationHistory`, pushes to `redoStack`, and emits the full history via `global_history_update`.
3. `request_redo` pops from `redoStack`, re-appends to `operationHistory`, and broadcasts the updated history.

Because the server owns the single global stack, all clients converge on the same state regardless of who initiated the undo/redo. Client caches (`historyCache` in `main.js`) are replaced whenever a snapshot arrives to guarantee consistency across resizes and reconnects.

## Performance Decisions

- **Stroke smoothing & batching**: `canvas.js` collects pointer samples and renders them inside `requestAnimationFrame`, using quadratic curves to reduce point count while maintaining smooth lines. This keeps CPU and network usage modest even for fast freehand drawing.
- **Incremental segment streaming**: Instead of broadcasting full stroke arrays during drawing, the client emits lightweight `{from,to}` segments. This minimises bandwidth and latency, while the final `stroke_complete` message consolidates the history.
- **Device-pixel aware canvas scaling**: On init and resize the canvas is scaled by `window.devicePixelRatio`, ensuring crisp rendering on HiDPI displays without redundant repainting.
- **Throttled cursor updates**: Cursor positions are rate-limited to every 50 ms, striking a balance between responsiveness and network chatter during high user counts.

## Conflict Resolution

- **Authoritative history**: Only the server mutates `operationHistory`. Client undo/redo actions become requests that the server validates, eliminating race conditions between peers.
- **Stroke IDs**: Each stroke carries a unique `strokeId`; when the canonical operation is rebroadcast, clients de-duplicate or update their local caches based on that identifier.
- **Simultaneous drawing**: Because in-progress segments are simply broadcast and composited, overlapping strokes from multiple users render in arrival order. Global undo/redo operates purely on the chronological stack, so whoever drew last is the first to be undone.
- **Cursor presence**: Cursor updates are idempotent and keyed by socket id, so later updates naturally overwrite earlier ones without explicit locking.
