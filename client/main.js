import {
  initCanvas,
  setTool,
  setColor,
  setStrokeWidth,
  drawRemoteSegment,
  redrawCanvas,
  resizeCanvas,
  clearCanvas,
  setCanvasBackground,
  exportCanvas,
} from "./canvas.js";
import {
  initWebsocket,
  emitDrawSegment,
  emitStrokeComplete,
  emitCursorPosition,
  requestUndo,
  requestRedo,
  requestClear,
  getSocketId,
  updateDisplayName,
} from "./websocket.js";

const TOOL_BUTTON_ACTIVE_CLASS = "active";

let historyCache = [];
const cursorElements = new Map();
let localSocketId = null;
let currentDisplayName = "";
let localUserColor = "#6B8BFF";
let defaultNameButtonText = "Update";
let nameFeedbackTimer = null;
let awaitingNameConfirmation = false;
let pendingDisplayName = null;
let resetPending = false;

let displayNameForm = null;
let displayNameInput = null;
let displayNameButton = null;
let profileName = null;
let nameFeedback = null;
let selfColorSwatch = null;
let colorPreviewValue = null;
let strokeWidthValue = null;
let userCountEl = null;

window.addEventListener("DOMContentLoaded", () => {
  // ensure we have a room (sheet) id in the URL so multiple users can join the same sheet
  const sheetId = ensureRoomInUrl();
  const sheetIdEl = document.getElementById("sheet-id-value");
  if (sheetIdEl) {
    sheetIdEl.textContent = sheetId;
  }
  const copySheetBtn = document.getElementById("copy-sheet-id");
  if (copySheetBtn) {
    copySheetBtn.addEventListener("click", async () => {
      const fullUrl = window.location.href;
      const previousText = copySheetBtn.textContent;
      // Try navigator.clipboard first
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(fullUrl);
        } else {
          // Fallback: use a temporary textarea and execCommand
          const ta = document.createElement("textarea");
          ta.value = fullUrl;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        copySheetBtn.textContent = "Copied!";
        copySheetBtn.disabled = true;
        setTimeout(() => {
          copySheetBtn.textContent = previousText;
          copySheetBtn.disabled = false;
        }, 1800);
      } catch (err) {
        // show a brief failure state
        copySheetBtn.textContent = "Failed";
        copySheetBtn.disabled = true;
        setTimeout(() => {
          copySheetBtn.textContent = previousText;
          copySheetBtn.disabled = false;
        }, 1800);
      }
    });
  }
  const canvasEl = document.getElementById("drawing-canvas");
  const cursorLayer = document.getElementById("cursor-layer");
  const brushButton = document.getElementById("tool-brush");
  const eraserButton = document.getElementById("tool-eraser");
  const colorInput = document.getElementById("stroke-color");
  const widthInput = document.getElementById("stroke-width");
  const undoButton = document.getElementById("undo-button");
  const redoButton = document.getElementById("redo-button");
  const resetButton = document.getElementById("reset-button");
  const usersContainer = document.getElementById("online-users");

  displayNameForm = document.getElementById("display-name-form");
  displayNameInput = document.getElementById("display-name-input");
  displayNameButton = document.getElementById("display-name-apply");
  profileName = document.getElementById("profile-name");
  nameFeedback = document.getElementById("name-feedback");
  selfColorSwatch = document.getElementById("self-color");
  colorPreviewValue = document.getElementById("color-preview-value");
  strokeWidthValue = document.getElementById("stroke-width-value");
  userCountEl = document.getElementById("user-count");

  if (displayNameButton) {
    const label = displayNameButton.textContent?.trim();
    if (label) {
      defaultNameButtonText = label;
    }
  }
  if (displayNameInput) {
    displayNameInput.dataset.pristine = "true";
  }

  if (!canvasEl) {
    console.error("Canvas element not found in DOM.");
    return;
  }

  let currentCanvasBackground = applyCanvasBackground(canvasEl, getCanvasBackgroundColor(canvasEl));

  initCanvas(canvasEl, {
    onSegment: (segment) => {
      emitDrawSegment(segment);
    },
    onStrokeComplete: (stroke) => {
      historyCache.push(stroke);
      emitStrokeComplete(stroke);
    },
  });

  const initialColor = colorInput?.value || "#000000";
  const initialWidth = widthInput?.value || 4;
  setTool("brush");
  setColor(initialColor);
  setStrokeWidth(initialWidth);
  setColorPreview(initialColor);
  setStrokeWidthLabel(initialWidth);

  const socket = initWebsocket({
    onConnect: (id) => {
      localSocketId = id;
    },
    onDrawSegment: (segment) => {
      if (segment?.strokeId?.startsWith(localSocketId)) return;
      drawRemoteSegment(segment);
    },
    onStrokeComplete: (operation) => {
      if (!operation) return;
      const index = historyCache.findIndex((item) => item.strokeId === operation.strokeId);
      if (index >= 0) {
        historyCache[index] = operation;
      } else {
        historyCache.push(operation);
      }
    },
    onHistoryUpdate: (history) => {
      historyCache = Array.isArray(history) ? history : [];
      redrawCanvas(historyCache);
    },
    onUserListUpdate: (users) => {
      renderUserList(usersContainer, users, localSocketId);
      updateLocalUserProfile(users);
    },
    onCursorUpdate: (cursors) => {
      renderRemoteCursors(cursorLayer, cursors, localSocketId);
    },
    onDisplayNameResult: (payload) => {
      handleDisplayNameResult(payload);
    },
    onCanvasCleared: (payload) => {
      const announcedBackground = typeof payload?.background === "string" ? payload.background.trim() : "";
      const nextBackground = announcedBackground || getCanvasBackgroundColor(canvasEl);
      currentCanvasBackground = applyCanvasBackground(canvasEl, nextBackground);
      historyCache = [];
      clearCanvas();
      if (resetPending) {
        resetPending = false;
        if (resetButton) {
          resetButton.disabled = false;
        }
      }
    },
  }, sheetId);
  

  if (!socket) {
    return;
  }

  // Export controls
  const exportFormatSelect = document.getElementById("export-format");
  const downloadBtn = document.getElementById("download-button");
  const exportFeedback = document.getElementById("export-feedback");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", async () => {
      const fmt = (exportFormatSelect?.value || "png").toLowerCase();
      const previous = exportFeedback?.textContent || "";
      try {
        if (exportFeedback) exportFeedback.textContent = "Preparing...";
        const result = await exportCanvas(fmt === "jpg" ? "jpeg" : fmt, 0.92, historyCache);
        const blob = result.data;
        const ext = fmt === "jpeg" || fmt === "jpg" ? "jpg" : fmt === "svg" ? "svg" : "png";
        const filename = `sheet-${sheetId}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (exportFeedback) exportFeedback.textContent = "Downloaded";
        setTimeout(() => {
          if (exportFeedback) exportFeedback.textContent = previous;
        }, 1400);
      } catch (err) {
        if (exportFeedback) exportFeedback.textContent = "Export failed";
        setTimeout(() => {
          if (exportFeedback) exportFeedback.textContent = previous;
        }, 1800);
        // eslint-disable-next-line no-console
        console.error("Export failed", err);
      }
    });
  }

  const toolButtons = [brushButton, eraserButton];
  toolButtons.forEach((button) => {
    if (!button) return;
    button.addEventListener("click", () => {
      const nextTool = button.dataset.tool;
      setTool(nextTool);
      toolButtons.forEach((btn) => btn?.classList.toggle(TOOL_BUTTON_ACTIVE_CLASS, btn === button));
    });
  });
  if (brushButton) {
    brushButton.classList.add(TOOL_BUTTON_ACTIVE_CLASS);
  }

  colorInput?.addEventListener("input", (event) => {
    const value = event.target.value;
    setColor(value);
    setColorPreview(value);
  });

  widthInput?.addEventListener("input", (event) => {
    const value = event.target.value;
    setStrokeWidth(value);
    setStrokeWidthLabel(value);
  });

  undoButton?.addEventListener("click", () => {
    requestUndo();
  });

  redoButton?.addEventListener("click", () => {
    requestRedo();
  });

  resetButton?.addEventListener("click", () => {
    if (resetPending) {
      return;
    }

  const previousHistory = historyCache;
  const desiredBackground = getCanvasBackgroundColor(canvasEl);
  currentCanvasBackground = applyCanvasBackground(canvasEl, desiredBackground);
    clearCanvas();
    historyCache = [];
    resetPending = true;
    resetButton.disabled = true;

    requestClear(currentCanvasBackground)
      .catch((error) => {
        console.error("Failed to reset shared canvas:", error);
        historyCache = previousHistory;
        redrawCanvas(historyCache);
      })
      .finally(() => {
        resetPending = false;
        resetButton.disabled = false;
      });
  });

  canvasEl.addEventListener("pointermove", (event) => {
    const pos = getRelativeCanvasPos(canvasEl, event);
    if (!pos) return;
    emitCursorPosition(pos);
  });

  canvasEl.addEventListener("pointerout", () => {
    emitCursorPosition(null);
  });

  window.addEventListener("resize", () => {
    resizeCanvas(historyCache);
  });

  displayNameForm?.addEventListener("submit", handleDisplayNameSubmit);
  displayNameInput?.addEventListener("input", handleDisplayNameInput);

  evaluateNameFormState();
});

function renderUserList(container, users, localId) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(users) ? users : [];
  if (userCountEl) {
    userCountEl.textContent = String(list.length);
  }

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "You are the first one here. Share the link to collaborate.";
    container.appendChild(empty);
    return;
  }

  list.forEach((user) => {
    const pill = document.createElement("article");
    pill.className = "user-pill";
    if (user.id === localId) {
      pill.classList.add("self");
    }

    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    avatar.style.background = user.color || "#888";
    avatar.style.color = getReadableTextColor(user.color);
    avatar.textContent = formatAvatarInitials(user.label || user.id);

    const meta = document.createElement("div");
    meta.className = "user-meta";

    const name = document.createElement("p");
    name.className = "user-name";
    name.textContent = user.label || user.id;

    const tag = document.createElement("p");
    tag.className = "user-tag";
    tag.textContent = user.id === localId ? "You" : `#${user.id.slice(-4).toUpperCase()}`;

    meta.append(name, tag);
    pill.append(avatar, meta);
    container.appendChild(pill);
  });
}

// Helpers: generate a short room id and ensure it's present in the URL
function generateId(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function ensureRoomInUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    let room = params.get("room");
    if (!room) {
      room = generateId(6);
      params.set("room", room);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      // Replace history so the user doesn't get spammed when navigating
      history.replaceState(null, "", newUrl);
    }
    return room;
  } catch (e) {
    // Fallback: if URL APIs aren't available, return a generated id
    return generateId(6);
  }
}

function renderRemoteCursors(layer, cursors, localId) {
  if (!layer) return;
  const activeIds = new Set();
  if (Array.isArray(cursors)) {
    cursors.forEach((cursor) => {
      if (!cursor || cursor.id === localId || cursor.position == null) {
        return;
      }
      activeIds.add(cursor.id);

      let entry = cursorElements.get(cursor.id);
      if (!entry) {
        const root = document.createElement("div");
        root.className = "remote-cursor";
        root.style.pointerEvents = "none";
        const labelEl = document.createElement("span");
        labelEl.className = "cursor-label";
        const dotEl = document.createElement("span");
        dotEl.className = "cursor-dot";
        root.append(labelEl, dotEl);
        layer.appendChild(root);
        entry = { root, label: labelEl, dot: dotEl };
        cursorElements.set(cursor.id, entry);
      }

      const { root, label, dot } = entry;
      root.style.left = `${cursor.position.x}px`;
      root.style.top = `${cursor.position.y}px`;
      dot.style.backgroundColor = cursor.color || "#ff6b6b";
      label.textContent = cursor.label || "Collaborator";
      label.style.borderColor = cursor.color || "#ff6b6b";
      // Always use black for cursor label text for better readability
      label.style.color = cursor.color || "#000000";
    });
  }

  cursorElements.forEach((entry, id) => {
    if (!activeIds.has(id)) {
      entry.root.remove();
      cursorElements.delete(id);
    }
  });
}

function handleDisplayNameSubmit(event) {
  event.preventDefault();
  if (!displayNameInput) return;

  const desiredName = displayNameInput.value.trim();
  if (desiredName.length < 2) {
    setNameFeedback("Name must be at least 2 characters.", true);
    evaluateNameFormState();
    return;
  }
  if (desiredName === currentDisplayName) {
    setNameFeedback("You're already using that name.");
    evaluateNameFormState();
    return;
  }

  awaitingNameConfirmation = true;
  pendingDisplayName = desiredName;
  setNameFormPending(true);

  updateDisplayName(desiredName)
    .then((response) => {
      const appliedLabel = response?.label || desiredName;
      applyDisplayNameSuccess(appliedLabel, true);
      displayNameInput?.blur();
    })
    .catch((error) => {
      const message = error?.message || "Unable to update name.";
      if (message === "Request timed out.") {
        setNameFeedback("Still syncing… waiting for confirmation.");
        awaitingNameConfirmation = true;
      } else if (message === "Another update is in progress.") {
        setNameFeedback("Already updating your name. Please wait.");
        awaitingNameConfirmation = true;
      } else {
        awaitingNameConfirmation = false;
        pendingDisplayName = null;
        setNameFeedback(message, true);
      }
    })
    .finally(() => {
      setNameFormPending(false);
      evaluateNameFormState();
    });
}

function handleDisplayNameInput() {
  if (!displayNameInput) return;
  const trimmed = displayNameInput.value.trim();
  displayNameInput.dataset.pristine = trimmed === currentDisplayName ? "true" : "false";
  setNameFeedback("");
  evaluateNameFormState();
}

function updateLocalUserProfile(users) {
  if (!Array.isArray(users) || !localSocketId) return;
  const local = users.find((user) => user.id === localSocketId);
  if (!local) return;

  currentDisplayName = local.label || buildFallbackLabel(localSocketId);
  localUserColor = local.color || localUserColor;

  if (profileName) {
    profileName.textContent = currentDisplayName;
  }
  if (selfColorSwatch) {
    selfColorSwatch.style.background = local.color || localUserColor;
  }
  if (displayNameInput && displayNameInput.dataset.pristine !== "false") {
    displayNameInput.value = currentDisplayName;
    displayNameInput.dataset.pristine = "true";
  }
  if (displayNameInput) {
    displayNameInput.placeholder = currentDisplayName;
  }

  evaluateNameFormState();
}

function setColorPreview(color) {
  if (!colorPreviewValue) return;
  const swatch = typeof color === "string" && color ? color : "#000000";
  colorPreviewValue.textContent = swatch.toUpperCase();
  colorPreviewValue.style.background = swatch;
  colorPreviewValue.style.color = getReadableTextColor(swatch);
  colorPreviewValue.style.borderColor = swatch;
}

function setStrokeWidthLabel(width) {
  if (!strokeWidthValue) return;
  const value = Number(width) || 0;
  strokeWidthValue.textContent = `${value} px`;
}

function setNameFeedback(message, isError = false) {
  if (!nameFeedback) return;
  nameFeedback.textContent = message;
  nameFeedback.classList.toggle("error", Boolean(isError));
  if (nameFeedbackTimer) {
    clearTimeout(nameFeedbackTimer);
    nameFeedbackTimer = null;
  }
  if (message) {
    nameFeedbackTimer = window.setTimeout(() => {
      if (nameFeedback) {
        nameFeedback.textContent = "";
        nameFeedback.classList.remove("error");
      }
      nameFeedbackTimer = null;
    }, isError ? 6000 : 3200);
  }
}

function setNameFormPending(pending) {
  if (displayNameButton) {
    const trimmed = displayNameInput?.value?.trim?.() || "";
    const disableForValue = trimmed.length < 2 || trimmed === currentDisplayName;
    displayNameButton.disabled = pending || disableForValue;
    displayNameButton.textContent = pending ? "Saving..." : defaultNameButtonText;
  }
  if (displayNameInput) {
    displayNameInput.setAttribute("aria-busy", pending ? "true" : "false");
  }
}

function evaluateNameFormState() {
  if (!displayNameButton) return;
  const trimmed = displayNameInput?.value?.trim?.() || "";
  const shouldDisable = trimmed.length < 2 || trimmed === currentDisplayName;
  if (!displayNameButton.disabled) {
    displayNameButton.disabled = shouldDisable;
  } else if (!shouldDisable && displayNameButton.disabled) {
    displayNameButton.disabled = false;
  }
}

function formatAvatarInitials(label) {
  if (!label) return "--";
  const parts = label.split(" ").filter(Boolean);
  if (!parts.length) return label.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function buildFallbackLabel(id) {
  if (typeof id !== "string" || id.length < 4) {
    return "User";
  }
  return `User ${id.slice(-4).toUpperCase()}`;
}

function getReadableTextColor(color) {
  if (typeof color !== "string") {
    return "#05070d";
  }
  const normalized = color.replace("#", "").slice(0, 6);
  if (normalized.length !== 6 || Number.isNaN(Number.parseInt(normalized, 16))) {
    return "#05070d";
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 160 ? "#05070d" : "#f5f9ff";
}

function applyCanvasBackground(canvas, color) {
  const trimmed = typeof color === "string" ? color.trim() : "";
  const cleaned = trimmed.replace(/[^#(),.%0-9a-zA-Z\/\s-]/g, "");
  const resolved = cleaned ? cleaned.slice(0, 64) : "#ffffff";
  setCanvasBackground(resolved);
  const container = canvas?.parentElement || canvas;
  if (container) {
    container.style.setProperty("--canvas-background", resolved);
  }
  return resolved;
}

function getCanvasBackgroundColor(canvas) {
  if (!canvas) {
    return "#ffffff";
  }
  const container = canvas.parentElement || canvas;
  const styles = window.getComputedStyle(container);
  const custom = styles.getPropertyValue("--canvas-background").trim();
  if (custom) {
    return custom;
  }
  const bg = styles.backgroundColor?.trim();
  if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
    return bg;
  }
  return "#ffffff";
}

function handleDisplayNameResult(payload) {
  if (!payload) return;
  if (payload.ok) {
    const label = payload.label || pendingDisplayName || currentDisplayName || buildFallbackLabel(localSocketId);
    const shouldAnnounce = awaitingNameConfirmation || (pendingDisplayName && label !== currentDisplayName);
    applyDisplayNameSuccess(label, shouldAnnounce);
  } else if (payload.error) {
    if (awaitingNameConfirmation) {
      setNameFeedback(payload.error, true);
    }
    awaitingNameConfirmation = false;
    pendingDisplayName = null;
    evaluateNameFormState();
  }
}

function applyDisplayNameSuccess(label, shouldAnnounce) {
  currentDisplayName = label;
  awaitingNameConfirmation = false;
  pendingDisplayName = null;
  if (profileName) {
    profileName.textContent = label;
  }
  if (displayNameInput) {
    displayNameInput.value = label;
    displayNameInput.placeholder = label;
    displayNameInput.dataset.pristine = "true";
  }
  if (shouldAnnounce) {
    setNameFeedback("Display name updated.");
  }
  evaluateNameFormState();
}

function getRelativeCanvasPos(canvas, event) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}
