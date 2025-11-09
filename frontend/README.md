# Collaborative Canvas Frontend

This folder contains the static client for the collaborative canvas experience. It is a plain HTML/CSS/JavaScript application that relies on a Socket.IO backend. The frontend can be served from any static hosting provider; the instructions below assume deployment to Vercel.

## Local development

Because the frontend is pure static HTML/CSS/JS, you only need a lightweight static file server during development:

```bash
cd frontend
npx serve .
# or
python3 -m http.server 4173
```

After starting the server, open the printed URL in your browser. Update `app-config.js` so `backendUrl` points to your locally running backend (for example `http://localhost:3000`).

## Production configuration

1. Copy `app-config.example.js` to `app-config.js` and change `backendUrl` to the public URL of your Render deployment. Commit the updated `app-config.js` to the frontend repository.
2. When you create a Vercel project, set the project root to the `frontend` directory.
3. Use the following Vercel settings:
   - **Framework preset**: `Other` (static site)
   - **Build command**: leave empty
   - **Output directory**: `.`

## Files

- `index.html`: UI shell and layout
- `style.css`: Material-inspired theme
- `canvas.js`: Rendering, smoothing, exports
- `websocket.js`: Socket.IO client configured for cross-origin deployments
- `app-config.js`: Runtime configuration (edit per environment)

Customize the markup, styles, or copy to match your branding before deployment.
