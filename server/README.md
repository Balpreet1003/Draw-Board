# Collaborative Canvas Server

This directory contains the Node.js + Socket.IO backend. It exposes the realtime collaboration API consumed by the frontend.

## Local development

```bash
cd server
npm install
npm run dev
```

The server listens on `http://localhost:3000` by default. Set the `PORT` environment variable to override the listen port.

## CORS configuration

When deploying to Render, set the `ALLOWED_ORIGINS` environment variable to a comma-separated list of frontend URLs (for example `https://canvas-balpreet.vercel.app`). If this variable is left empty, the server will mirror the origin of incoming requests.

## Health checks

A simple `GET /health` endpoint returns `{ "status": "ok" }` and can be used by Render for uptime monitoring.

## Deployment to Render

1. Create a new Web Service and point it at the server repository.
2. Specify the **Build Command** as `npm install` and the **Start Command** as `npm start`.
3. Add environment variables:
   - `PORT` – Render automatically injects the port; leave the value blank to accept Render's default.
   - `ALLOWED_ORIGINS` – Comma-separated list of frontend origins (optional but recommended).
4. Enable websocket support in the Render dashboard (Settings → Web Sockets).

## Project files

- `server.js` – Express + Socket.IO entry point
- `drawing-state.js` – Shared history with undo/redo support
- `rooms.js` – Lightweight in-memory room and user registry
