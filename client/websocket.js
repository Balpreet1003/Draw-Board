let socket;
let handlers = {
  onDrawSegment: null,
  onHistoryUpdate: null,
  onStrokeComplete: null,
  onUserListUpdate: null,
  onCursorUpdate: null,
  onDisplayNameResult: null,
  onConnect: null,
  onDisconnect: null,
  onCanvasCleared: null,
};

const CURSOR_EMIT_INTERVAL = 50;
let lastCursorEmit = 0;
let pendingNameUpdate = null;

export function initWebsocket(customHandlers = {}, roomId = null) {
  handlers = { ...handlers, ...customHandlers };

  if (typeof io === "undefined") {
    console.error("Socket.io client library not found.");
    return null;
  }

  const opts = { transports: ["websocket"] };
  if (roomId) {
    // pass room id to server via the auth payload so the server can place sockets in the correct room
    opts.auth = { room: String(roomId) };
  }

  socket = io(opts);

  socket.on("connect", () => {
    handlers.onConnect?.(socket.id);
  });

  socket.on("disconnect", (reason) => {
    handlers.onDisconnect?.(reason);
  });

  socket.on("draw_event", (segment) => {
    handlers.onDrawSegment?.(segment);
  });

  socket.on("stroke_complete", (operation) => {
    handlers.onStrokeComplete?.(operation);
  });

  socket.on("global_history_update", (history) => {
    handlers.onHistoryUpdate?.(history);
  });

  socket.on("user_list_update", (users) => {
    handlers.onUserListUpdate?.(users);
  });

  socket.on("user_cursors", (cursors) => {
    handlers.onCursorUpdate?.(cursors);
  });

  socket.on("display_name_update_result", (payload) => {
    handlers.onDisplayNameResult?.(payload);
    if (!pendingNameUpdate) {
      return;
    }
    clearTimeout(pendingNameUpdate.timer);
    const { resolve, reject } = pendingNameUpdate;
    pendingNameUpdate = null;
    if (payload?.ok) {
      resolve({ ok: true, label: payload.label });
    } else {
      reject(new Error(payload?.error || "Failed to update display name."));
    }
  });

  socket.on("canvas_cleared", (payload) => {
    handlers.onCanvasCleared?.(payload);
  });

  return socket;
}

export function emitDrawSegment(segment) {
  if (!socket) return;
  socket.emit("draw_event", segment);
}

export function emitStrokeComplete(operation) {
  if (!socket) return;
  socket.emit("stroke_complete", operation);
}

export function requestUndo() {
  if (!socket) return;
  socket.emit("request_undo");
}

export function requestRedo() {
  if (!socket) return;
  socket.emit("request_redo");
}

export function requestClear(background) {
  if (!socket) {
    return Promise.reject(new Error("Not connected."));
  }
  if (!socket.connected) {
    return Promise.reject(new Error("Connection lost."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Clear request timed out."));
      }
    }, 5000);

    socket.emit("request_clear", { background }, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!response || response.ok) {
        resolve(response || { ok: true });
      } else {
        reject(new Error(response.error || "Failed to clear canvas."));
      }
    });
  });
}

export function emitCursorPosition(position) {
  if (!socket) return;
  if (position == null) {
    socket.emit("cursor_move", null);
    lastCursorEmit = 0;
    return;
  }
  const now = Date.now();
  if (now - lastCursorEmit < CURSOR_EMIT_INTERVAL) return;
  lastCursorEmit = now;
  socket.emit("cursor_move", position);
}

export function getSocketId() {
  return socket?.id || null;
}

export function updateDisplayName(name) {
  if (!socket) {
    return Promise.reject(new Error("Not connected."));
  }
  if (!socket.connected) {
    return Promise.reject(new Error("Connection lost."));
  }

  if (pendingNameUpdate) {
    clearTimeout(pendingNameUpdate.timer);
    pendingNameUpdate.reject?.(new Error("Another update is in progress."));
    pendingNameUpdate = null;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingNameUpdate = null;
      reject(new Error("Request timed out."));
    }, 7000);

    pendingNameUpdate = { resolve, reject, timer };

    socket.emit("set_display_name", name, (response) => {
      if (!pendingNameUpdate) {
        return;
      }
      clearTimeout(timer);
      pendingNameUpdate = null;
      if (response?.ok) {
        resolve(response);
      } else {
        reject(new Error(response?.error || "Failed to update display name."));
      }
    });
  });
}
