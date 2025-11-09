# DrawBoard – Collaborative Canvas

DrawBoard is a lightweight, real-time whiteboard that lets multiple users sketch together on an HTML5 canvas. The app focuses on low-latency interactions, resilient session state, and a modern, material-inspired UI that stays consistent across screen sizes.

## 🧩 Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Runtime | **Node.js** | Hosts the collaboration server and serves static assets |
| Server Framework | **Express 4** | Serves the client bundle and exposes the Socket.IO endpoint |
| Real-time Transport | **Socket.IO 4** | Broadcasts drawing segments, undo/redo commands, cursor presence, and display-name updates |
| Client Application | **Vanilla ES Modules (HTML, CSS, JavaScript)** | Renders the UI, handles input tools, and manages socket events |
| Development Tooling | **Nodemon 3** | Provides automatic restarts during development |

No frontend frameworks are used—the UI is entirely hand-written HTML/CSS with a small JS controller layer.

## ✨ Core Features

- **Responsive drawing tools**: Brush and eraser with smoothed quadratic-curve rendering and adjustable stroke width/color.
- **Global history management**: Undo/redo stack tracked on the server to keep clients in sync.
- **Resettable sessions**: A shared reset action clears the canvas (including background color) for every connected user and persists across reloads.
- **Live collaborator presence**: Cursor positions, color-coded avatars, and a user roster update continuously.
- **Display name updates**: Users can rename themselves with optimistic UI feedback and server-side validation.
- **Material-inspired UI**: Rounded cards, light palette, and consistent layout for control and presence panels.

## 🚀 Getting Started

```bash
npm install
npm run dev
```

The `dev` script starts the Express/Socket.IO server with Nodemon at [`http://localhost:3000`](http://localhost:3000) and serves the static client from `client/`.

For a production-style process (no hot reload):

```bash
npm start
```

### Testing Multiple Clients

1. Run the server (dev or start).
2. Open `http://localhost:3000` in your default browser.
3. Open the same URL in another browser profile or an incognito/private window.
4. Draw, undo/redo, rename, or reset the canvas in one window and watch the changes mirror instantly in all sessions.

## 🗂️ Project Structure

```
drawBoard/
├── client/
│   ├── index.html          # Layout shell and control panels
│   ├── style.css           # Material-inspired theme + responsive tweaks
│   ├── canvas.js           # Canvas rendering, smoothing, and background management
│   ├── websocket.js        # Socket.IO client wrapper and emit helpers
│   └── main.js             # UI coordination & state management
├── server/
│   ├── server.js           # Express + Socket.IO server, reset handling
│   ├── drawing-state.js    # Shared history store with undo/redo/clear APIs
│   └── rooms.js            # Lightweight user registry
├── ARCHITECTURE.md         # Deep dive into event flow and design decisions
├── package.json
└── README.md
```

## 🔧 Available Scripts

- `npm run dev` – Start the server with Nodemon for auto-restart during development.
- `npm start` – Launch the server with plain Node.js.

## 🧠 Implementation Notes

- **Canvas background**: The canvas surface respects the CSS custom property `--canvas-background` on `.canvas-container`. The shared reset action stores and re-applies this color so the canvas stays filled after reloads.
- **Eraser behavior**: Eraser strokes repaint with the current background color for consistent exports instead of leaving transparent pixels.
- **Networking**: All clients join a single Socket.IO “global” room. Events include drawing segments, stroke completions, undo/redo, cursor updates, name changes, and canvas clears.
- **Resilience**: Display name updates and canvas resets use acknowledgement callbacks plus timeouts to provide reliable UX feedback.

## ⚠️ Limitations & Future Ideas

- Only one shared room is available; multi-room support would require namespace or room management.
- The in-memory history can grow large over long sessions. Implementing pruning or persistence would improve scalability.
- Offline strokes drawn during network interruptions aren’t replayed when the connection resumes.
- There is no authentication—anyone with the URL can join the shared session.

## 📚 Additional Docs

Refer to `ARCHITECTURE.md` for a deeper look at module responsibilities, socket event payloads, and rendering details.

---

Happy drawing! Contributions, issue reports, or design suggestions are always welcome.
# Collaborative-Canvas
