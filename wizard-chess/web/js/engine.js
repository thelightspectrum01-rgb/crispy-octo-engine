// Main-thread client for the AI. Prefers a module worker; falls back to searching inline
// (briefly blocking) when workers are unavailable, e.g. in restrictive embedded browsers.
import {Position, moveToUci} from './chess.js';

export class Engine {
  constructor() {
    this.sequence = 0;
    this.pending = null;
    this.inline = false;
    this.spawn();
  }

  spawn() {
    try {
      this.worker = new Worker(new URL('./ai-worker.js', import.meta.url), {type: 'module'});
      this.worker.onmessage = event => this.receive(event.data);
      this.worker.onerror = event => {
        if (event && event.preventDefault) event.preventDefault();
        this.useInline();
      };
    } catch {
      this.worker = null;
      this.inline = true;
    }
  }

  receive(data) {
    if (!data || data.ready) return;
    const pending = this.pending;
    if (!pending || pending.id !== data.id) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (data.ok) pending.resolve(data);
    else pending.reject(new Error(data.error));
  }

  useInline() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.inline = true;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      this.runInline(pending.request, pending.id).then(pending.resolve, pending.reject);
    }
  }

  async runInline(request, id) {
    const {Searcher, LEVELS} = await import('./ai.js');
    if (!this.searcher) this.searcher = new Searcher(18);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (id !== this.sequence) return new Promise(() => {});
    const pos = new Position(request.startFen);
    for (const uci of request.moves) pos.make(pos.moveFromUci(uci));
    const result = this.searcher.think(pos, LEVELS[request.level] || LEVELS.adept);
    if (id !== this.sequence) return new Promise(() => {});
    return {uci: result.move ? moveToUci(result.move) : null, score: result.score, depth: result.depth, nodes: result.nodes};
  }

  // request: {startFen, moves: [uci], level}. Resolves with {uci, score, depth, nodes}.
  // A request superseded by cancel() or a newer think() never settles.
  think(request, timeLimit = 2500) {
    this.cancel();
    const id = this.sequence;
    if (this.inline) return this.runInline(request, id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.useInline(), timeLimit + 6000);
      this.pending = {id, resolve, reject, timer, request};
      this.worker.postMessage({id, ...request});
    });
  }

  cancel() {
    this.sequence++;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
      if (this.worker) { this.worker.terminate(); this.spawn(); }
    }
  }
}
