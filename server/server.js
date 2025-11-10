const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { DrawingState } = require("./drawing-state");
const { RoomRegistry } = require("./rooms");

const PORT = process.env.PORT || 3000;
const allowedOrigins = parseAllowedOrigins("draw-board-canvas.vercel.app");
const GLOBAL_ROOM = "global";
const DEFAULT_CANVAS_BACKGROUND = "#ffffff";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ["websocket", "polling"],
  cors: buildCorsOptions(allowedOrigins),
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const drawingState = new DrawingState();
const rooms = new RoomRegistry();
const cursorPositions = new Map();
let canvasBackground = DEFAULT_CANVAS_BACKGROUND;

io.on("connection", (socket) => {
  const userColor = assignUserColor(socket.id);
  const label = buildDefaultLabel(socket.id);

  // allow clients to request a specific room (sheet) via socket auth payload
  const requestedRoom = socket.handshake && socket.handshake.auth && socket.handshake.auth.room;
  const roomId = typeof requestedRoom === "string" && requestedRoom ? requestedRoom : GLOBAL_ROOM;

  socket.join(roomId);
  rooms.addUser(roomId, socket.id, { color: userColor, label });

  // send current canvas state/history to the newly connected client (scoped to room)
  socket.emit("canvas_cleared", { background: canvasBackground });
  socket.emit("global_history_update", drawingState.getHistory());
  broadcastUserList(roomId);

  socket.on("draw_event", (segment) => {
    if (!isValidSegment(segment)) {
      return;
    }
    socket.to(roomId).emit("draw_event", sanitizeSegment(segment));
  });

  socket.on("stroke_complete", (operation) => {
    const normalized = drawingState.addOperation(operation);
    if (!normalized) {
      return;
    }
    io.to(roomId).emit("stroke_complete", normalized);
  });

  socket.on("request_undo", () => {
    const history = drawingState.undo();
    io.to(roomId).emit("global_history_update", history);
  });

  socket.on("request_redo", () => {
    const history = drawingState.redo();
    io.to(roomId).emit("global_history_update", history);
  });

  socket.on("request_clear", (options = {}, ack) => {
    const requestedBackground = normalizeBackgroundColor(options.background);
    canvasBackground = requestedBackground;
    drawingState.clear();
    io.to(roomId).emit("canvas_cleared", { background: canvasBackground });
    io.to(roomId).emit("global_history_update", drawingState.getHistory());
    if (typeof ack === "function") {
      ack({ ok: true });
    }
  });

  socket.on("set_display_name", (rawName, ack) => {
    const result = normalizeDisplayName(rawName);
    if (!result.ok) {
      if (typeof ack === "function") {
        ack({ ok: false, error: result.error });
      }
      emitDisplayNameResult(socket, { ok: false, error: result.error });
      return;
    }
    const updatedUser = rooms.updateUser(roomId, socket.id, { label: result.value });
    if (!updatedUser) {
      const errorMessage = "User not found.";
      if (typeof ack === "function") {
        ack({ ok: false, error: errorMessage });
      }
      emitDisplayNameResult(socket, { ok: false, error: errorMessage });
      return;
    }

    const existingCursor = cursorPositions.get(socket.id);
    if (existingCursor) {
      cursorPositions.set(socket.id, { ...existingCursor, label: updatedUser.label });
    }

    broadcastUserList(roomId);
    broadcastCursors(roomId);

    if (typeof ack === "function") {
      ack({ ok: true, label: updatedUser.label });
    }
    emitDisplayNameResult(socket, { ok: true, label: updatedUser.label });
  });

  socket.on("cursor_move", (position) => {
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      const userRecord = rooms.getUser(roomId, socket.id);
      cursorPositions.set(socket.id, {
        position,
        color: userColor,
        label: userRecord?.label || buildDefaultLabel(socket.id),
      });
    } else {
      cursorPositions.delete(socket.id);
    }
    broadcastCursors(roomId);
  });

  socket.on("disconnect", () => {
    rooms.removeUser(roomId, socket.id);
    cursorPositions.delete(socket.id);
    broadcastUserList(roomId);
    broadcastCursors(roomId);
  });
});

function broadcastUserList(roomId = GLOBAL_ROOM) {
  const list = rooms.listUsers(roomId);
  // Debug: log the user list count and ids to help diagnose duplicate/ghost connections
  // This will print lines like: user_list_update -> room=abc count= 2 ids= [ 'abc123', 'def456' ]
  // Remove or tone down this logging once the issue is resolved.
  // eslint-disable-next-line no-console
  console.log("user_list_update -> room=", roomId, "count=", list.length, "ids=", list.map((u) => u.id));
  io.to(roomId).emit("user_list_update", list);
}

function broadcastCursors(roomId = GLOBAL_ROOM) {
  const payload = Array.from(cursorPositions.entries())
    // only include cursors for users in this room
    .filter(([id]) => Boolean(rooms.getUser(roomId, id)))
    .map(([id, cursor]) => ({
      id,
      color: cursor.color,
      position: cursor.position,
      label: cursor.label || rooms.getUser(roomId, id)?.label || buildDefaultLabel(id),
    }));
  io.to(roomId).emit("user_cursors", payload);
}

function isValidSegment(segment) {
  if (!segment) return false;
  const { from, to } = segment;
  return (
    from &&
    to &&
    Number.isFinite(from.x) &&
    Number.isFinite(from.y) &&
    Number.isFinite(to.x) &&
    Number.isFinite(to.y)
  );
}

function sanitizeSegment(segment) {
  return {
    strokeId: typeof segment.strokeId === "string" ? segment.strokeId : `stroke-${Date.now()}`,
    tool: segment.tool === "eraser" ? "eraser" : "brush",
    color: typeof segment.color === "string" ? segment.color : "#000000",
    width: clampWidth(segment.width),
    from: {
      x: Number(segment.from.x),
      y: Number(segment.from.y),
    },
    to: {
      x: Number(segment.to.x),
      y: Number(segment.to.y),
    },
  };
}

function assignUserColor(seed) {
  const palette = [
    "#FF6B6B",
    "#4ECDC4",
    "#FFD93D",
    "#1A535C",
    "#FF9F1C",
    "#9B5DE5",
    "#00BBF9",
    "#F15BB5",
  ];
  const index = Math.abs(hashCode(seed)) % palette.length;
  return palette[index];
}

function clampWidth(width) {
  const value = Number(width);
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, value));
}

function hashCode(input) {
  return Array.from(input).reduce((hash, char) => (hash << 5) - hash + char.charCodeAt(0), 0);
}

function buildDefaultLabel(socketId) {
  if (typeof socketId !== "string" || socketId.length < 4) {
    return "User";
  }
  return `User ${socketId.slice(-4).toUpperCase()}`;
}

function normalizeDisplayName(rawValue) {
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Display name must be text." };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length < 2) {
    return { ok: false, error: "Display name must be at least 2 characters." };
  }
  const sanitized = trimmed.replace(/[^A-Za-z0-9\s'._-]/g, "");
  const collapsed = sanitized.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return { ok: false, error: "Display name cannot be empty." };
  }
  if (collapsed.length > 32) {
    return { ok: false, error: "Display name must be 32 characters or less." };
  }
  return { ok: true, value: collapsed };
}

function emitDisplayNameResult(socket, payload) {
  socket.emit("display_name_update_result", payload);
}

function normalizeBackgroundColor(value) {
  if (typeof value !== "string") {
    return DEFAULT_CANVAS_BACKGROUND;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_CANVAS_BACKGROUND;
  }
  const sanitized = trimmed.replace(/[^#(),.%0-9a-zA-Z\/\s-]/g, "").trim();
  if (!sanitized) {
    return DEFAULT_CANVAS_BACKGROUND;
  }
  return sanitized.slice(0, 64);
}

function start(listenPort = PORT) {
  server.listen(listenPort, () => {
    // eslint-disable-next-line no-console
    console.log(`Collaborative canvas server running at http://localhost:${listenPort}`);
  });
}

function parseAllowedOrigins(rawOrigins) {
  if (!rawOrigins) {
    return [];
  }
  return rawOrigins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCorsOptions(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    return { origin: true };
  }
  if (origins.includes("*")) {
    return { origin: true };
  }
  return { origin: origins, credentials: true };
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  server,
  start,
};