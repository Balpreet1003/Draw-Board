const DEFAULT_BACKGROUND = "#ffffff";
let backgroundFill = DEFAULT_BACKGROUND;
let canvasEl;
let ctx;
let previewCanvasEl;
let previewCtx;
let tool = "brush";
let strokeColor = "#000000";
let strokeWidth = 4;
let deviceRatio = window.devicePixelRatio || 1;
let isDrawing = false;
let activeStrokeId = null;
let points = [];
let renderedIndex = 0;
let rafHandle = null;
let segmentCallback = null;
let completeCallback = null;

/**
 * Initialize canvas drawing layer and register pointer handlers.
 * @param {HTMLCanvasElement} canvas
 * @param {{ onSegment:(segment)=>void, onStrokeComplete:(stroke)=>void }} handlers
 */
export function initCanvas(canvas, handlers = {}) {
  canvasEl = canvas;
  ctx = canvasEl.getContext("2d");
  // Create an overlay preview canvas for in-progress strokes to avoid overdrawing
  const container = canvasEl.parentElement || document.body;
  previewCanvasEl = container.querySelector("#preview-canvas");
  if (!previewCanvasEl) {
    previewCanvasEl = document.createElement("canvas");
    previewCanvasEl.id = "preview-canvas";
    previewCanvasEl.style.position = "absolute";
    previewCanvasEl.style.inset = "0";
    previewCanvasEl.style.pointerEvents = "none";
    previewCanvasEl.style.borderRadius = canvasEl.style.borderRadius || "0";
    // insert preview canvas below the cursor layer (if present) so cursors render on top
    const cursorLayer = container.querySelector("#cursor-layer");
    if (cursorLayer) {
      container.insertBefore(previewCanvasEl, cursorLayer);
    } else {
      container.appendChild(previewCanvasEl);
    }
  }
  previewCtx = previewCanvasEl.getContext("2d");
  segmentCallback = handlers.onSegment || null;
  completeCallback = handlers.onStrokeComplete || null;
  configureCanvasSize();
  attachPointerHandlers();
  clearCanvas();
}

export function setTool(nextTool) {
  tool = nextTool === "eraser" ? "eraser" : "brush";
}
export function setColor(nextColor) {
  strokeColor = nextColor;
}

export function setCanvasBackground(color) {
  backgroundFill = normalizeBackground(color);
}

export function setStrokeWidth(nextWidth) {
  strokeWidth = Math.max(1, Math.min(50, Number(nextWidth) || 1));
}

export function clearCanvas(fillColor) {
  if (!ctx || !canvasEl) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const color = normalizeBackground(fillColor);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.restore();
  // clear preview layer
  if (previewCtx && previewCanvasEl) {
    previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
  }
}

function normalizeBackground(color) {
  if (typeof color === "string") {
    const trimmed = color.trim();
    if (trimmed) {
      const sanitized = trimmed.replace(/[^#(),.%0-9a-zA-Z\/\s-]/g, "").trim().slice(0, 64);
      if (sanitized) {
        backgroundFill = sanitized;
        return sanitized;
      }
    }
  }
  return backgroundFill || DEFAULT_BACKGROUND;
}

export function resizeCanvas(history = null) {
  if (!canvasEl) return;
  const needsResize = deviceRatio !== window.devicePixelRatio;
  const { clientWidth, clientHeight } = canvasEl.parentElement || canvasEl;
  deviceRatio = window.devicePixelRatio || 1;
  if (canvasEl.width !== clientWidth * deviceRatio || canvasEl.height !== clientHeight * deviceRatio || needsResize) {
    canvasEl.width = clientWidth * deviceRatio;
    canvasEl.height = clientHeight * deviceRatio;
    canvasEl.style.width = `${clientWidth}px`;
    canvasEl.style.height = `${clientHeight}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(deviceRatio, deviceRatio);
    if (history) {
      redrawCanvas(history);
    } else {
      clearCanvas();
    }
  }
}

export function drawRemoteSegment(segment) {
  if (!ctx || !segment) return;
  const { tool: remoteTool = "brush", color = strokeColor, width = strokeWidth, from, to } = segment;
  if (!from || !to) return;
  ctx.save();
  applyStrokeStyle(remoteTool, color, width);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

export function redrawCanvas(history) {
  clearCanvas();
  if (!Array.isArray(history)) return;
  history.forEach((operation) => {
    renderStroke(operation);
  });
}

/**
 * Export the current canvas as a data URL (png/jpeg) or SVG string.
 * @param {string} format 'png'|'jpeg'|'svg'
 * @param {number} quality for jpeg (0..1)
 * @param {Array} history optional history to use for SVG generation
 * @returns {Promise<{ type: string, data: string|Blob }>} data for download
 */
export async function exportCanvas(format = "png", quality = 0.92, history = null) {
  if (!canvasEl) {
    throw new Error("Canvas not initialized");
  }

  const fmt = String(format || "png").toLowerCase();
  if (fmt === "svg") {
    const hist = Array.isArray(history) ? history : [];
    const svg = generateSVG(hist);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    return { type: "image/svg+xml", data: blob };
  }

  // For raster formats, use the canvas element's data URL
  const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : "image/png";
  // toDataURL may be synchronous; convert to blob for consistent download handling
  const dataUrl = canvasEl.toDataURL(mime, Number(quality) || 0.92);
  // convert dataURL to blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return { type: mime, data: blob };
}

function generateSVG(history = []) {
  // SVG dimensions in CSS pixels
  const rect = canvasEl.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const bg = normalizeBackground();

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  // background
  parts.push(`<rect width="100%" height="100%" fill="${escapeXml(bg)}" />`);

  // render strokes
  history.forEach((op) => {
    if (!op || !Array.isArray(op.points) || op.points.length < 2) return;
    const stroke = escapeXml(String(op.strokeId || ""));
    const color = escapeXml(String(op.color || "#000000"));
    const w = Number(op.width) || 1;
    const toolType = op.tool === "eraser" ? "eraser" : "brush";

    // Build path using quadratic segments similar to canvas rendering
    const p = [];
    const pts = op.points;
    p.push(`M ${pts[0].x} ${pts[0].y}`);
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const midX = (prev.x + cur.x) / 2;
      const midY = (prev.y + cur.y) / 2;
      p.push(`Q ${prev.x} ${prev.y} ${midX} ${midY}`);
    }
    const last = pts[pts.length - 1];
    p.push(`L ${last.x} ${last.y}`);

    const strokeColor = toolType === "eraser" ? bg : color;
    parts.push(`<path d="${p.join(" ")}" stroke="${strokeColor}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`);
  });

  parts.push(`</svg>`);
  return parts.join('\n');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function configureCanvasSize() {
  if (!canvasEl) return;
  const { clientWidth, clientHeight } = canvasEl.parentElement || canvasEl;
  deviceRatio = window.devicePixelRatio || 1;
  canvasEl.width = clientWidth * deviceRatio;
  canvasEl.height = clientHeight * deviceRatio;
  canvasEl.style.width = `${clientWidth}px`;
  canvasEl.style.height = `${clientHeight}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(deviceRatio, deviceRatio);
  if (previewCanvasEl && previewCtx) {
    previewCanvasEl.width = clientWidth * deviceRatio;
    previewCanvasEl.height = clientHeight * deviceRatio;
    previewCanvasEl.style.width = `${clientWidth}px`;
    previewCanvasEl.style.height = `${clientHeight}px`;
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.scale(deviceRatio, deviceRatio);
  }
}

function attachPointerHandlers() {
  const start = (event) => {
    event.preventDefault();
    const pos = getRelativePosition(event);
    if (!pos) return;
    if (canvasEl.setPointerCapture) {
      canvasEl.setPointerCapture(event.pointerId);
    }
    isDrawing = true;
    activeStrokeId = `${crypto.randomUUID?.() || Date.now()}`;
    points = [pos];
    renderedIndex = 0;
  };

  const move = (event) => {
    if (!isDrawing) return;
    event.preventDefault();
    const pos = getRelativePosition(event);
    if (!pos) return;
    const prev = points[points.length - 1];
    points.push(pos);
    scheduleFrame();
    if (segmentCallback && prev) {
      segmentCallback({
        strokeId: activeStrokeId,
        tool,
        color: tool === "eraser" ? backgroundFill : strokeColor,
        width: strokeWidth,
        from: prev,
        to: pos,
      });
    }
  };

  const end = (event) => {
    if (!isDrawing) return;
    event?.preventDefault();
    if (canvasEl.releasePointerCapture) {
      try {
        canvasEl.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* pointer already released */
      }
    }
    isDrawing = false;
    // Final render to preview then commit to main canvas
    flushFrame();
    if (completeCallback && points.length > 1) {
      const op = {
        strokeId: activeStrokeId,
        tool,
        color: tool === "eraser" ? backgroundFill : strokeColor,
        width: strokeWidth,
        points: [...points],
      };
      // commit stroke to base canvas
      renderStroke(op);
      completeCallback(op);
    }
    // clear preview
    if (previewCtx && previewCanvasEl) {
      previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
    }
    points = [];
    activeStrokeId = null;
    renderedIndex = 0;
  };

  canvasEl.addEventListener("pointerdown", start);
  canvasEl.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  canvasEl.addEventListener("pointerleave", end);
}

function scheduleFrame() {
  if (rafHandle) return;
  rafHandle = requestAnimationFrame(flushFrame);
}

function flushFrame() {
  rafHandle = null;
  if (!previewCtx || points.length < 2) return;
  // Draw the current in-progress stroke onto the preview layer using full smoothing
  previewCtx.save();
  applyStrokeStyleToContext(previewCtx, tool, tool === "eraser" ? backgroundFill : strokeColor, strokeWidth);
  previewCtx.beginPath();
  previewCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const midPoint = getMidPoint(prev, cur);
    previewCtx.quadraticCurveTo(prev.x, prev.y, midPoint.x, midPoint.y);
  }
  const lastPoint = points[points.length - 1];
  previewCtx.lineTo(lastPoint.x, lastPoint.y);
  previewCtx.stroke();
  previewCtx.restore();
  renderedIndex = points.length - 1;
}

function renderStroke(operation) {
  if (!operation || !Array.isArray(operation.points) || operation.points.length < 2) return;
  ctx.save();
  applyStrokeStyle(operation.tool, operation.color, operation.width);
  ctx.beginPath();
  ctx.moveTo(operation.points[0].x, operation.points[0].y);
  for (let i = 1; i < operation.points.length; i += 1) {
    const current = operation.points[i];
    const previous = operation.points[i - 1];
    const midPoint = getMidPoint(previous, current);
    ctx.quadraticCurveTo(previous.x, previous.y, midPoint.x, midPoint.y);
  }
  const lastPoint = operation.points[operation.points.length - 1];
  ctx.lineTo(lastPoint.x, lastPoint.y);
  ctx.stroke();
  ctx.restore();
}

function applyStrokeStyle(strokeTool, color, width) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  if (strokeTool === "eraser") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = backgroundFill;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color || strokeColor;
  }
}

function applyStrokeStyleToContext(context, strokeTool, color, width) {
  context.lineJoin = "round";
  context.lineCap = "round";
  context.lineWidth = width;
  if (strokeTool === "eraser") {
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = backgroundFill;
  } else {
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = color || strokeColor;
  }
}

function getRelativePosition(event) {
  const rect = canvasEl.getBoundingClientRect();
  const x = (event.clientX - rect.left);
  const y = (event.clientY - rect.top);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function getMidPoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
