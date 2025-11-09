const MAX_HISTORY_LENGTH = 10000;

class DrawingState {
  constructor() {
    this.operationHistory = [];
    this.redoStack = [];
  }

  addOperation(operation) {
    const normalized = this.#normalizeOperation(operation);
    if (!normalized) {
      return null;
    }
    this.operationHistory.push(normalized);
    if (this.operationHistory.length > MAX_HISTORY_LENGTH) {
      this.operationHistory.shift();
    }
    this.redoStack.length = 0;
    return normalized;
  }

  undo() {
    if (!this.operationHistory.length) {
      return this.getHistory();
    }
    const op = this.operationHistory.pop();
    if (op) {
      this.redoStack.push(op);
    }
    return this.getHistory();
  }

  redo() {
    if (!this.redoStack.length) {
      return this.getHistory();
    }
    const op = this.redoStack.pop();
    if (op) {
      this.operationHistory.push(op);
    }
    return this.getHistory();
  }

  getHistory() {
    return this.operationHistory.map((operation) => ({
      strokeId: operation.strokeId,
      tool: operation.tool,
      color: operation.color,
      width: operation.width,
      points: operation.points.map((point) => ({ x: point.x, y: point.y })),
    }));
  }

  clear() {
    this.operationHistory = [];
    this.redoStack = [];
  }

  #normalizeOperation(operation) {
    if (!operation || !Array.isArray(operation.points) || operation.points.length < 2) {
      return null;
    }

    const points = operation.points
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }));

    if (points.length < 2) {
      return null;
    }

    const width = Number(operation.width);
    return {
      strokeId: typeof operation.strokeId === "string" ? operation.strokeId : `stroke-${Date.now()}`,
      tool: operation.tool === "eraser" ? "eraser" : "brush",
      color: typeof operation.color === "string" ? operation.color : "#000000",
      width: Number.isFinite(width) ? Math.min(50, Math.max(1, width)) : 1,
      points,
    };
  }
}

module.exports = {
  DrawingState,
};
