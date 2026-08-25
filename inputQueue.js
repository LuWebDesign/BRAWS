/**
 * InputQueue
 *
 * Valida y ordena inputs de red antes de que GameRoom los aplique.
 * No conoce Socket.IO ni reglas de física.
 */

const DEFAULT_MAX_SIZE = 120;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class InputQueue {
  constructor({ maxSize = DEFAULT_MAX_SIZE } = {}) {
    this.maxSize = maxSize;
    this.queues = new Map();
    this.lastReceived = new Map();
    this.lastProcessed = new Map();
  }

  addPlayer(playerId) {
    this.queues.set(playerId, []);
    this.lastReceived.set(playerId, -1);
    this.lastProcessed.set(playerId, -1);
  }

  removePlayer(playerId) {
    this.queues.delete(playerId);
    this.lastReceived.delete(playerId);
    this.lastProcessed.delete(playerId);
  }

  enqueue(playerId, input) {
    const queue = this.queues.get(playerId);
    if (!queue) return false;

    const seq = Number(input.seq);
    if (!Number.isSafeInteger(seq) || seq < 0) return false;
    if (seq <= (this.lastReceived.get(playerId) ?? -1)) return false;

    queue.push({
      seq,
      dx: clamp(Number(input.dx) || 0, -1, 1),
      dy: clamp(Number(input.dy) || 0, -1, 1),
      action: !!input.action,
    });
    this.lastReceived.set(playerId, seq);

    while (queue.length > this.maxSize) {
      const discarded = queue.shift();
      if (discarded) this.lastProcessed.set(playerId, discarded.seq);
    }
    return true;
  }

  consume(playerId, callback) {
    const queue = this.queues.get(playerId);
    if (!queue) return 0;

    let consumed = 0;
    let input;
    while ((input = queue.shift())) {
      this.lastProcessed.set(playerId, input.seq);
      callback(input);
      consumed += 1;
    }
    return consumed;
  }

  lastProcessedInput(playerId) {
    return this.lastProcessed.get(playerId) ?? -1;
  }

  pendingCount(playerId) {
    return this.queues.get(playerId)?.length ?? 0;
  }

  clear() {
    this.queues.clear();
    this.lastReceived.clear();
    this.lastProcessed.clear();
  }
}

module.exports = { InputQueue };
