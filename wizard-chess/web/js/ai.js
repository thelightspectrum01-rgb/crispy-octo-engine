// Single-player opponent: iterative-deepening PVS alpha-beta with a transposition table,
// quiescence search, null-move pruning, LMR and PeSTO's tapered piece-square evaluation.
import {WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, FLAG_CAPTURE, movePromo, moveCaptured, movePiece, moveTo} from './chess.js';

export const MATE = 30000;
const INF = 32000, MAX_PLY = 96;
const EXACT = 1, LOWER = 2, UPPER = 3;

export const LEVELS = {
  novice: {label: 'Novice', depth: 1, time: 300, noise: 150},
  apprentice: {label: 'Apprentice', depth: 2, time: 500, noise: 60},
  adept: {label: 'Adept', depth: 5, time: 900, noise: 0, variety: 20},
  archmage: {label: 'Archmage', depth: 64, time: 2200, noise: 0, variety: 8},
  hint: {label: 'Hint', depth: 64, time: 900, noise: 0},
};

// PeSTO tables by Ronald Friederich, listed from a8 to h1 (white's point of view).
const MG_VALUE = [0, 82, 337, 365, 477, 1025, 0];
const EG_VALUE = [0, 94, 281, 297, 512, 936, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const MG_PST = [null, [
  0, 0, 0, 0, 0, 0, 0, 0, 98, 134, 61, 95, 68, 126, 34, -11, -6, 7, 26, 31, 65, 56, 25, -20, -14, 13, 6, 21, 23, 12, 17, -23,
  -27, -2, -5, 12, 17, 6, 10, -25, -26, -4, -4, -10, 3, 3, 33, -12, -35, -1, -20, -23, -15, 24, 38, -22, 0, 0, 0, 0, 0, 0, 0, 0,
], [
  -167, -89, -34, -49, 61, -97, -15, -107, -73, -41, 72, 36, 23, 62, 7, -17, -47, 60, 37, 65, 84, 129, 73, 44, -9, 17, 19, 53, 37, 69, 18, 22,
  -13, 4, 16, 13, 28, 19, 21, -8, -23, -9, 12, 10, 19, 17, 25, -16, -29, -53, -12, -3, -1, 18, -14, -19, -105, -21, -58, -33, -17, -28, -19, -23,
], [
  -29, 4, -82, -37, -25, -42, 7, -8, -26, 16, -18, -13, 30, 59, 18, -47, -16, 37, 43, 40, 35, 50, 37, -2, -4, 5, 19, 50, 37, 37, 7, -2,
  -6, 13, 13, 26, 34, 12, 10, 4, 0, 15, 15, 15, 14, 27, 18, 10, 4, 15, 16, 0, 7, 21, 33, 1, -33, -3, -14, -21, -13, -12, -39, -21,
], [
  32, 42, 32, 51, 63, 9, 31, 43, 27, 32, 58, 62, 80, 67, 26, 44, -5, 19, 26, 36, 17, 45, 61, 16, -24, -11, 7, 26, 24, 35, -8, -20,
  -36, -26, -12, -1, 9, -7, 6, -23, -45, -25, -16, -17, 3, 0, -5, -33, -44, -16, -20, -9, -1, 11, -6, -71, -19, -13, 1, 17, 16, 7, -37, -26,
], [
  -28, 0, 29, 12, 59, 44, 43, 45, -24, -39, -5, 1, -16, 57, 28, 54, -13, -17, 7, 8, 29, 56, 47, 57, -27, -27, -16, -16, -1, 17, -2, 1,
  -9, -26, -9, -10, -2, -4, 3, -3, -14, 2, -11, -2, -5, 2, 14, 5, -35, -8, 11, 2, 8, 15, -3, 1, -1, -18, -9, 10, -15, -25, -31, -50,
], [
  -65, 23, 16, -15, -56, -34, 2, 13, 29, -1, -20, -7, -8, -4, -38, -29, -9, 24, 2, -16, -20, 6, 22, -22, -17, -20, -12, -27, -30, -25, -14, -36,
  -49, -1, -27, -39, -46, -44, -33, -51, -14, -14, -22, -46, -44, -30, -15, -27, 1, 7, -8, -64, -43, -16, 9, 8, -15, 36, 12, -54, 8, -28, 24, 14,
]];
const EG_PST = [null, [
  0, 0, 0, 0, 0, 0, 0, 0, 178, 173, 158, 134, 147, 132, 165, 187, 94, 100, 85, 67, 56, 53, 82, 84, 32, 24, 13, 5, -2, 4, 17, 17,
  13, 9, -3, -7, -7, -8, 3, -1, 4, 7, -6, 1, 0, -5, -1, -8, 13, 8, 8, 10, 13, 0, 2, -7, 0, 0, 0, 0, 0, 0, 0, 0,
], [
  -58, -38, -13, -28, -31, -27, -63, -99, -25, -8, -25, -2, -9, -25, -24, -52, -24, -20, 10, 9, -1, -9, -19, -41, -17, 3, 22, 22, 22, 11, 8, -18,
  -18, -6, 16, 25, 16, 17, 4, -18, -23, -3, -1, 15, 10, -3, -20, -22, -42, -20, -10, -5, -2, -20, -23, -44, -29, -51, -23, -15, -22, -18, -50, -64,
], [
  -14, -21, -11, -8, -7, -9, -17, -24, -8, -4, 7, -12, -3, -13, -4, -14, 2, -8, 0, -1, -2, 6, 0, 4, -3, 9, 12, 9, 14, 10, 3, 2,
  -6, 3, 13, 19, 7, 10, -3, -9, -12, -3, 8, 10, 13, 3, -7, -15, -14, -18, -7, -1, 4, -9, -15, -27, -23, -9, -23, -5, -9, -16, -5, -17,
], [
  13, 10, 18, 15, 12, 12, 8, 5, 11, 13, 13, 11, -3, 3, 8, 3, 7, 7, 7, 5, 4, -3, -5, -3, 4, 3, 13, 1, 2, 1, -1, 2,
  3, 5, 8, 4, -5, -6, -8, -11, -4, 0, -5, -1, -7, -12, -8, -16, -6, -6, 0, 2, -9, -9, -11, -3, -9, 2, 3, -1, -5, -13, 4, -20,
], [
  -9, 22, 22, 27, 27, 19, 10, 20, -17, 20, 32, 41, 58, 25, 30, 0, -20, 6, 9, 49, 47, 35, 19, 9, 3, 22, 24, 45, 57, 40, 57, 36,
  -18, 28, 19, 47, 31, 34, 39, 23, -16, -27, 15, 6, 9, 17, 10, 5, -22, -23, -30, -16, -16, -23, -36, -32, -33, -28, -22, -43, -5, -32, -20, -41,
], [
  -74, -35, -18, -18, -11, 15, 4, -17, -12, 17, 14, 17, 17, 38, 23, 11, 10, 17, 23, 15, 20, 45, 44, 13, -8, 22, 24, 27, 26, 33, 26, 3,
  -18, -4, 21, 24, 27, 23, 9, -11, -19, -3, 11, 21, 23, 16, 7, -9, -27, -11, 4, 13, 14, 4, -5, -17, -53, -34, -21, -11, -28, -14, -24, -43,
]];

// Combined material + square tables per piece code, signed from white's point of view.
const MG = [], EG = [];
for (let p = 0; p < 16; p++) { MG.push(new Int16Array(128)); EG.push(new Int16Array(128)); }
for (let type = PAWN; type <= KING; type++) {
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const rank = sq >> 4, file = sq & 7;
    const w = (7 - rank) * 8 + file, b = rank * 8 + file;
    MG[type][sq] = MG_VALUE[type] + MG_PST[type][w];
    EG[type][sq] = EG_VALUE[type] + EG_PST[type][w];
    MG[8 | type][sq] = -(MG_VALUE[type] + MG_PST[type][b]);
    EG[8 | type][sq] = -(EG_VALUE[type] + EG_PST[type][b]);
  }
}

const PASSED_MG = [0, 0, 4, 8, 16, 28, 45, 0];
const PASSED_EG = [0, 8, 14, 24, 42, 68, 105, 0];
const ORDER_VALUE = [0, 100, 320, 330, 500, 900, 2000];
const wPawnFiles = new Int8Array(8), bPawnFiles = new Int8Array(8);
const wMinRank = new Int8Array(8), bMaxRank = new Int8Array(8);
const centerDistance = sq => Math.max(3 - (sq & 7), (sq & 7) - 4) + Math.max(3 - (sq >> 4), (sq >> 4) - 4);

// Static evaluation in centipawns from the side to move's point of view.
export function evaluate(pos) {
  const b = pos.board;
  let mg = 0, eg = 0, phase = 0, wBishops = 0, bBishops = 0;
  wPawnFiles.fill(0); bPawnFiles.fill(0); wMinRank.fill(8); bMaxRank.fill(-1);
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    mg += MG[p][sq]; eg += EG[p][sq];
    const t = p & 7;
    phase += PHASE[t];
    if (t === PAWN) {
      const f = sq & 7, r = sq >> 4;
      if (p === PAWN) { wPawnFiles[f]++; if (r < wMinRank[f]) wMinRank[f] = r; }
      else { bPawnFiles[f]++; if (r > bMaxRank[f]) bMaxRank[f] = r; }
    } else if (t === BISHOP) { if (p >> 3) bBishops++; else wBishops++; }
  }
  if (wBishops >= 2) { mg += 30; eg += 50; }
  if (bBishops >= 2) { mg -= 30; eg -= 50; }
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    const t = p & 7;
    if (t !== PAWN && t !== ROOK) continue;
    const f = sq & 7, r = sq >> 4;
    const white = (p >> 3) === WHITE;
    if (t === PAWN) {
      const own = white ? wPawnFiles : bPawnFiles;
      const isolated = (f === 0 || !own[f - 1]) && (f === 7 || !own[f + 1]);
      let passed = true;
      for (let g = Math.max(0, f - 1); g <= Math.min(7, f + 1); g++) {
        if (white ? bMaxRank[g] > r : wMinRank[g] < r) { passed = false; break; }
      }
      let smg = 0, seg = 0;
      if (isolated) { smg -= 10; seg -= 12; }
      if (own[f] > 1) { smg -= 6; seg -= 14; }
      if (passed) { const rel = white ? r : 7 - r; smg += PASSED_MG[rel]; seg += PASSED_EG[rel]; }
      if (white) { mg += smg; eg += seg; } else { mg -= smg; eg -= seg; }
    } else {
      const ownPawns = white ? wPawnFiles[f] : bPawnFiles[f];
      const theirPawns = white ? bPawnFiles[f] : wPawnFiles[f];
      const bonus = ownPawns ? 0 : theirPawns ? 10 : 22;
      if (white) mg += bonus; else mg -= bonus;
    }
  }
  if (phase > 24) phase = 24;
  // Mop-up: with a decisive material edge, drive the losing king to the rim.
  if (phase <= 8 && Math.abs(eg) > 350) {
    const winner = eg > 0 ? WHITE : BLACK;
    const loserKing = pos.kings[winner ^ 1], winnerKing = pos.kings[winner];
    const dist = Math.abs((loserKing & 7) - (winnerKing & 7)) + Math.abs((loserKing >> 4) - (winnerKing >> 4));
    const bonus = 14 * centerDistance(loserKing) + 5 * (14 - dist);
    eg += winner === WHITE ? bonus : -bonus;
  }
  const score = ((mg * phase + eg * (24 - phase)) / 24) | 0;
  return (pos.side === WHITE ? score : -score) + 12;
}

function hasPieces(pos, color) {
  const b = pos.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (p && (p >> 3) === color && (p & 7) !== PAWN && (p & 7) !== KING) return true;
  }
  return false;
}

function gaussian(random) {
  const u = Math.max(1e-9, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Searcher {
  constructor(ttBits = 19) {
    const size = 1 << ttBits;
    this.ttMask = size - 1;
    this.ttKey = new Int32Array(size);
    this.ttMove = new Int32Array(size);
    this.ttScore = new Int16Array(size);
    this.ttDepth = new Int8Array(size);
    this.ttFlag = new Uint8Array(size);
    this.killers = new Int32Array(MAX_PLY * 2);
    this.history = new Int32Array(16 * 128);
    this.lists = Array.from({length: MAX_PLY + 1}, () => []);
    this.scores = Array.from({length: MAX_PLY + 1}, () => new Int32Array(256));
    this.random = Math.random;
  }

  // Chooses a move for the side to move. Returns {move, score, depth, nodes}.
  think(pos, level = LEVELS.adept) {
    this.pos = pos;
    this.nodes = 0;
    this.stopped = false;
    this.killers.fill(0);
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 3;
    const legal = pos.legalMoves();
    if (!legal.length) return {move: 0, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0};
    if (legal.length === 1) return {move: legal[0], score: 0, depth: 0, nodes: 0};
    const start = now();
    if (level.noise) {
      this.deadline = start + level.time * 4;
      return this.pickNoisy(pos, legal, level);
    }
    let bestMove = legal[0], bestScore = 0, depthDone = 0;
    for (let depth = 1; depth <= Math.min(level.depth, MAX_PLY - 8); depth++) {
      this.deadline = depth === 1 ? Infinity : start + level.time;
      this.rootBest = 0;
      let alpha = -INF, beta = INF, delta = 35, score = 0;
      if (depth >= 4) { alpha = Math.max(-INF, bestScore - delta); beta = Math.min(INF, bestScore + delta); }
      for (;;) {
        score = this.negamax(depth, alpha, beta, 0, false);
        if (this.stopped) break;
        if (score <= alpha) { alpha = Math.max(-INF, alpha - delta); delta *= 3; continue; }
        if (score >= beta) { beta = Math.min(INF, beta + delta); delta *= 3; continue; }
        break;
      }
      if (this.stopped) {
        if (this.rootBest) bestMove = this.rootBest;
        break;
      }
      if (this.rootBest) bestMove = this.rootBest;
      bestScore = score;
      depthDone = depth;
      if (Math.abs(score) > MATE - MAX_PLY) break;
      if (now() - start > level.time * 0.45) break;
    }
    if (level.variety && pos.fullmove <= 4 && Math.abs(bestScore) < 200) {
      const alt = this.varietyPick(pos, legal, level.variety, bestMove);
      if (alt) bestMove = alt;
    }
    return {move: bestMove, score: bestScore, depth: depthDone, nodes: this.nodes};
  }

  // Low levels: score every root move exactly, then add human-like noise.
  pickNoisy(pos, legal, level) {
    const scored = this.scoreRoot(pos, legal, level.depth);
    let best = scored[0];
    let bestNoisy = -Infinity;
    for (const entry of scored) {
      const noisy = entry.score + gaussian(this.random) * level.noise;
      if (noisy > bestNoisy) { bestNoisy = noisy; best = entry; }
    }
    return {move: best.move, score: best.score, depth: level.depth, nodes: this.nodes};
  }

  // Opening variety for strong levels: any move within `margin` of the best at shallow depth.
  varietyPick(pos, legal, margin, bestMove) {
    const saved = this.deadline;
    this.deadline = Infinity;
    const scored = this.scoreRoot(pos, legal, 3);
    this.deadline = saved;
    const top = Math.max(...scored.map(s => s.score));
    const pool = scored.filter(s => s.score >= top - margin);
    if (!pool.length || !pool.some(s => s.move === bestMove)) return 0;
    return pool[Math.floor(this.random() * pool.length)].move;
  }

  scoreRoot(pos, legal, depth) {
    this.stopped = false;
    const out = [];
    for (const m of legal) {
      pos.make(m);
      const score = -this.negamax(depth - 1, -INF, INF, 1, true);
      pos.unmake();
      out.push({move: m, score});
    }
    return out;
  }

  scoreMoves(list, scores, ttMove, ply) {
    const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      let s;
      if (m === ttMove) s = 3000000;
      else if (m & (FLAG_CAPTURE << 14)) s = 2000000 + ORDER_VALUE[moveCaptured(m) & 7] * 16 - ORDER_VALUE[movePiece(m) & 7] / 10;
      else if (movePromo(m) === QUEEN) s = 1900000;
      else if (m === k1) s = 1800000;
      else if (m === k2) s = 1700000;
      else s = this.history[(movePiece(m) << 7) | moveTo(m)];
      scores[i] = s;
    }
  }

  negamax(depth, alpha, beta, ply, allowNull) {
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0 && now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    const pvNode = beta - alpha > 1;
    if (ply > 0) {
      if (pos.halfmove >= 100 || pos.isRepetition() || pos.insufficientMaterial()) return 0;
      const mated = -MATE + ply;
      if (mated > alpha) { alpha = mated; if (alpha >= beta) return alpha; }
      const mating = MATE - ply - 1;
      if (mating < beta) { beta = mating; if (alpha >= beta) return beta; }
    }
    const inCheck = pos.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    if (ply >= MAX_PLY - 1) return evaluate(pos);

    const idx = pos.hashLo & this.ttMask;
    let ttMove = 0;
    if (this.ttFlag[idx] && this.ttKey[idx] === pos.hashHi) {
      ttMove = this.ttMove[idx];
      if (!pvNode && ply > 0 && this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s > MATE - MAX_PLY) s -= ply; else if (s < -MATE + MAX_PLY) s += ply;
        const flag = this.ttFlag[idx];
        if (flag === EXACT || (flag === LOWER && s >= beta) || (flag === UPPER && s <= alpha)) return s;
      }
    }

    const staticEval = inCheck ? -INF : evaluate(pos);
    if (!pvNode && !inCheck && ply > 0) {
      if (depth <= 3 && staticEval - 110 * depth >= beta && Math.abs(beta) < MATE - MAX_PLY) return staticEval;
      if (allowNull && depth >= 3 && staticEval >= beta && hasPieces(pos, pos.side)) {
        const r = depth >= 7 ? 3 : 2;
        pos.makeNull();
        const s = -this.negamax(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNull();
        if (this.stopped) return 0;
        if (s >= beta) return s > MATE - MAX_PLY ? beta : s;
      }
    }

    const list = this.lists[ply];
    list.length = 0;
    pos.generate(list);
    const scores = this.scores[ply];
    this.scoreMoves(list, scores, ttMove, ply);
    const alphaStart = alpha;
    let best = -INF, bestMove = 0, legal = 0;
    const futile = !pvNode && !inCheck && depth <= 2 && staticEval + 120 + 140 * depth <= alpha;
    for (let i = 0; i < list.length; i++) {
      let bi = i;
      for (let j = i + 1; j < list.length; j++) if (scores[j] > scores[bi]) bi = j;
      const m = list[bi];
      if (bi !== i) { list[bi] = list[i]; list[i] = m; const t = scores[bi]; scores[bi] = scores[i]; scores[i] = t; }
      const tactical = (m & (FLAG_CAPTURE << 14)) !== 0 || movePromo(m) !== 0;
      if (futile && legal > 0 && !tactical) continue;
      if (!pos.make(m)) continue;
      legal++;
      const givesCheck = pos.inCheck();
      let score;
      if (legal === 1) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        let r = 0;
        if (depth >= 3 && legal > 3 && !tactical && !inCheck && !givesCheck && scores[i] < 1700000) {
          r = legal > 10 ? 2 : 1;
          if (pvNode) r--;
        }
        score = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && r > 0) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake();
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (ply === 0) this.rootBest = m;
          if (score >= beta) {
            if (!tactical) {
              if (this.killers[ply * 2] !== m) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = m; }
              const h = (movePiece(m) << 7) | moveTo(m);
              this.history[h] = Math.min(1600000, this.history[h] + depth * depth);
            }
            break;
          }
        }
      }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;

    const flag = best >= beta ? LOWER : best > alphaStart ? EXACT : UPPER;
    let stored = best;
    if (stored > MATE - MAX_PLY) stored += ply; else if (stored < -MATE + MAX_PLY) stored -= ply;
    if (this.ttFlag[idx] === 0 || this.ttDepth[idx] <= depth || this.ttKey[idx] !== pos.hashHi) {
      this.ttKey[idx] = pos.hashHi;
      this.ttMove[idx] = bestMove;
      this.ttScore[idx] = stored;
      this.ttDepth[idx] = depth;
      this.ttFlag[idx] = flag;
    }
    return best;
  }

  quiesce(alpha, beta, ply) {
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0 && now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 1) return evaluate(pos);
    const inCheck = pos.inCheck();
    let best = -INF;
    let standPat = 0;
    if (!inCheck) {
      standPat = evaluate(pos);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      best = standPat;
    }
    const list = this.lists[ply];
    list.length = 0;
    pos.generate(list, !inCheck);
    const scores = this.scores[ply];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      scores[i] = (m & (FLAG_CAPTURE << 14)) ? ORDER_VALUE[moveCaptured(m) & 7] * 16 - ORDER_VALUE[movePiece(m) & 7] / 10 : movePromo(m) ? 9000 : 0;
    }
    let legal = 0;
    for (let i = 0; i < list.length; i++) {
      let bi = i;
      for (let j = i + 1; j < list.length; j++) if (scores[j] > scores[bi]) bi = j;
      const m = list[bi];
      if (bi !== i) { list[bi] = list[i]; list[i] = m; const t = scores[bi]; scores[bi] = scores[i]; scores[i] = t; }
      if (!inCheck && !movePromo(m) && standPat + ORDER_VALUE[moveCaptured(m) & 7] + 180 < alpha) continue;
      if (!pos.make(m)) continue;
      legal++;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      pos.unmake();
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) { alpha = score; if (score >= beta) break; }
      }
    }
    if (inCheck && !legal) return -MATE + ply;
    return best;
  }
}
