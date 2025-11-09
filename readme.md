# Collaborative Canvas – Split Deployment Setup

This repository now holds two independent deployable packages so you can host the frontend on Vercel and the realtime backend on Render. Each folder is ready to be pushed to its own GitHub repository.

## Repository layout

```
.
├── frontend/                # Static client for Vercel (plain HTML/CSS/JS)
│   ├── index.html
│   ├── canvas.js
│   ├── main.js
│   ├── websocket.js
│   ├── style.css
│   └── app-config.js        # Runtime configuration (edit per environment)
├── server/                  # Node.js + Socket.IO backend for Render
│   ├── server.js
│   ├── drawing-state.js
│   ├── rooms.js
│   ├── package.json
│   └── README.md
├── ARCHITECTURE.md          # Design notes (updated to reference split hosting)
└── README.md (this file)
```

## How to create the two GitHub repositories

1. **Frontend repo**
	- Create a new repository (e.g. `collaborative-canvas-frontend`).
	- Copy the contents of `frontend/` into that repository.
	- Update `frontend/app-config.js` so `backendUrl` points at your Render URL. Commit the change.

2. **Server repo**
	- Create a second repository (e.g. `collaborative-canvas-server`).
	- Copy the contents of `server/` into that repository.
	- Add an `.env` file (based on `.env.example`) with `ALLOWED_ORIGINS=<your Vercel URL>`.

Both directories include their own `package.json` files, so the repos stay completely isolated.

## Local development workflow

```bash
# Terminal 1 – backend
cd server
npm install
npm run dev

# Terminal 2 – frontend
cd frontend
npx serve .
# or python3 -m http.server 4173
```

Update `frontend/app-config.js` to use `http://localhost:3000` (or whatever port the backend is listening on).

## Deploying to Vercel (frontend)

1. Connect the frontend GitHub repository to Vercel.
2. Use the following project settings:
   - **Framework preset**: `Other`
   - **Build command**: leave empty (static export)
   - **Output directory**: `.`
3. Ensure `app-config.js` contains the production Render URL before pushing.

## Deploying to Render (backend)

1. Create a new **Web Service**.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add environment variables:
	- `ALLOWED_ORIGINS=https://<your-vercel-domain>` (comma-separated if multiple)
5. Enable WebSockets in the Render service settings.

Render automatically supplies the `PORT` variable; the server will use it when present.

## Feature summary

- Real-time brush & eraser with stroke smoothing
- Undo/redo and shared canvas resets
- Cursor presence with live collaborator list
- Export to PNG, JPEG, or SVG
- Customisable display names with server-side validation

Refer to `ARCHITECTURE.md` for a deep dive into the event flow and module responsibilities.

Happy drawing!
