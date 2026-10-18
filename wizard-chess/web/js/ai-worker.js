// Runs the search off the main thread so the cathedral keeps animating while the opponent thinks.
import {Position, moveToUci} from './chess.js';
import {Searcher, LEVELS} from './ai.js';

const searcher = new Searcher(19);

self.onmessage = event => {
  const {id, startFen, moves, level} = event.data || {};
  try {
    const pos = new Position(startFen);
    for (const uci of moves || []) {
      const m = pos.moveFromUci(uci);
      if (!m) throw new Error('Illegal move in history: ' + uci);
      pos.make(m);
    }
    const result = searcher.think(pos, LEVELS[level] || LEVELS.adept);
    self.postMessage({id, ok: true, uci: result.move ? moveToUci(result.move) : null,
      score: result.score, depth: result.depth, nodes: result.nodes});
  } catch (error) {
    self.postMessage({id, ok: false, error: String((error && error.message) || error)});
  }
};

self.postMessage({ready: true});
