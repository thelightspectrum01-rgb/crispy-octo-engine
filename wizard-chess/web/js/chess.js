// Chess rules on a 0x88 board. Shared by the 3D game, the AI worker and the Node tests.
// Moves are packed integers so the search can generate millions of them without allocation.

export const WHITE = 0, BLACK = 1;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const FLAG_CAPTURE = 1, FLAG_EP = 2, FLAG_DOUBLE = 4, FLAG_CASTLE = 8;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const makePiece = (color, type) => type | (color << 3);
export const pieceType = p => p & 7;
export const pieceColor = p => p >> 3;

export const square = (file, rank) => rank * 16 + file;
export const sqFile = sq => sq & 7;
export const sqRank = sq => sq >> 4;
export const sqName = sq => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
export const parseSquare = name => square(name.charCodeAt(0) - 97, name.charCodeAt(1) - 49);
export const isLightSquare = sq => ((sq & 7) + (sq >> 4)) % 2 === 1;

export const encodeMove = (from, to, flags, promo, captured, piece) =>
  from | (to << 7) | (flags << 14) | (promo << 18) | (captured << 21) | (piece << 25);
export const moveFrom = m => m & 127;
export const moveTo = m => (m >> 7) & 127;
export const moveFlags = m => (m >> 14) & 15;
export const movePromo = m => (m >> 18) & 7;
export const moveCaptured = m => (m >> 21) & 15;
export const movePiece = m => (m >> 25) & 15;

export const KNIGHT_OFFSETS = [33, 31, 18, 14, -14, -18, -31, -33];
export const KING_OFFSETS = [17, 16, 15, 1, -1, -15, -16, -17];
export const BISHOP_DIRS = [17, 15, -15, -17];
export const ROOK_DIRS = [16, 1, -1, -16];

const PIECE_CHARS = ' pnbrqk';
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[7] = 15 & ~1;
CASTLE_MASK[112] = 15 & ~8; CASTLE_MASK[116] = 15 & ~12; CASTLE_MASK[119] = 15 & ~4;

// Deterministic Zobrist keys (two 32-bit halves) so every thread hashes identically.
let zseed = 0x2545F491;
const rand32 = () => { zseed ^= zseed << 13; zseed ^= zseed >>> 17; zseed ^= zseed << 5; return zseed | 0; };
const Z_PIECE_LO = new Int32Array(16 * 128), Z_PIECE_HI = new Int32Array(16 * 128);
for (let i = 0; i < Z_PIECE_LO.length; i++) { Z_PIECE_LO[i] = rand32(); Z_PIECE_HI[i] = rand32(); }
const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
for (let i = 1; i < 16; i++) { Z_CASTLE_LO[i] = rand32(); Z_CASTLE_HI[i] = rand32(); }
const Z_EP_LO = new Int32Array(8), Z_EP_HI = new Int32Array(8);
for (let i = 0; i < 8; i++) { Z_EP_LO[i] = rand32(); Z_EP_HI[i] = rand32(); }
const Z_SIDE_LO = rand32(), Z_SIDE_HI = rand32();

const STACK = 4096;

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.kings = [0, 0];
    this.stMove = new Int32Array(STACK);
    this.stCastle = new Uint8Array(STACK);
    this.stEp = new Int16Array(STACK);
    this.stHalf = new Int16Array(STACK);
    this.stLo = new Int32Array(STACK);
    this.stHi = new Int32Array(STACK);
    this.load(fen);
  }

  load(fen) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error('Invalid FEN');
    this.board.fill(0);
    let rank = 7, file = 0;
    for (const ch of parts[0]) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '8') { file += ch.charCodeAt(0) - 48; continue; }
      const type = PIECE_CHARS.indexOf(ch.toLowerCase());
      if (type < 1 || file > 7 || rank < 0) throw new Error('Invalid FEN');
      const color = ch === ch.toLowerCase() ? BLACK : WHITE;
      const sq = square(file, rank);
      this.board[sq] = makePiece(color, type);
      if (type === KING) this.kings[color] = sq;
      file++;
    }
    this.side = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (parts[2].includes('K')) this.castling |= 1;
    if (parts[2].includes('Q')) this.castling |= 2;
    if (parts[2].includes('k')) this.castling |= 4;
    if (parts[2].includes('q')) this.castling |= 8;
    this.ep = parts[3] !== '-' ? parseSquare(parts[3]) : -1;
    this.halfmove = parseInt(parts[4] || '0', 10) || 0;
    this.fullmove = parseInt(parts[5] || '1', 10) || 1;
    this.ply = 0;
    const kings = [0, 0];
    for (let sq = 0; sq < 128; sq++) {
      if (!(sq & 0x88) && (this.board[sq] & 7) === KING) kings[this.board[sq] >> 3]++;
    }
    if (kings[0] !== 1 || kings[1] !== 1) throw new Error('Invalid FEN: each side needs one king');
    this.computeHash();
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p) { lo ^= Z_PIECE_LO[p * 128 + sq]; hi ^= Z_PIECE_HI[p * 128 + sq]; }
    }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    if (this.ep !== -1) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
    if (this.side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    this.hashLo = lo; this.hashHi = hi;
  }

  fen() {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[square(file, rank)];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = PIECE_CHARS[p & 7];
        out += (p >> 3) === WHITE ? ch.toUpperCase() : ch;
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    let castle = '';
    if (this.castling & 1) castle += 'K';
    if (this.castling & 2) castle += 'Q';
    if (this.castling & 4) castle += 'k';
    if (this.castling & 8) castle += 'q';
    return [out, this.side === WHITE ? 'w' : 'b', castle || '-',
      this.ep === -1 ? '-' : sqName(this.ep), this.halfmove, this.fullmove].join(' ');
  }

  get(sq) { return this.board[sq]; }

  isAttacked(sq, by) {
    const b = this.board;
    if (by === WHITE) {
      if (!((sq - 15) & 0x88) && b[sq - 15] === 1) return true;
      if (!((sq - 17) & 0x88) && b[sq - 17] === 1) return true;
    } else {
      if (!((sq + 15) & 0x88) && b[sq + 15] === 9) return true;
      if (!((sq + 17) & 0x88) && b[sq + 17] === 9) return true;
    }
    const knight = makePiece(by, KNIGHT), king = makePiece(by, KING);
    for (let i = 0; i < 8; i++) {
      const t = sq + KNIGHT_OFFSETS[i];
      if (!(t & 0x88) && b[t] === knight) return true;
      const k = sq + KING_OFFSETS[i];
      if (!(k & 0x88) && b[k] === king) return true;
    }
    const bishop = makePiece(by, BISHOP), rook = makePiece(by, ROOK), queen = makePiece(by, QUEEN);
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i];
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (p) { if (p === bishop || p === queen) return true; break; }
      }
      const r = ROOK_DIRS[i];
      for (let t = sq + r; !(t & 0x88); t += r) {
        const p = b[t];
        if (p) { if (p === rook || p === queen) return true; break; }
      }
    }
    return false;
  }

  inCheck(color = this.side) { return this.isAttacked(this.kings[color], color ^ 1); }

  // Pseudo-legal moves; make() rejects the ones that leave the king attacked.
  // With tacticalOnly, only captures and queen promotions are produced (quiescence search).
  generate(list, tacticalOnly = false) {
    const b = this.board, us = this.side, them = us ^ 1;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p || (p >> 3) !== us) continue;
      const type = p & 7;
      if (type === PAWN) {
        const fwd = us === WHITE ? 16 : -16;
        const promoRank = us === WHITE ? 7 : 0;
        const t1 = sq + fwd;
        if (!(t1 & 0x88) && !b[t1]) {
          if ((t1 >> 4) === promoRank) {
            list.push(encodeMove(sq, t1, 0, QUEEN, 0, p));
            if (!tacticalOnly) {
              list.push(encodeMove(sq, t1, 0, KNIGHT, 0, p));
              list.push(encodeMove(sq, t1, 0, ROOK, 0, p));
              list.push(encodeMove(sq, t1, 0, BISHOP, 0, p));
            }
          } else if (!tacticalOnly) {
            list.push(encodeMove(sq, t1, 0, 0, 0, p));
            const t2 = t1 + fwd;
            if ((sq >> 4) === (us === WHITE ? 1 : 6) && !b[t2]) list.push(encodeMove(sq, t2, FLAG_DOUBLE, 0, 0, p));
          }
        }
        for (let side = -1; side <= 1; side += 2) {
          const t = t1 + side;
          if (t & 0x88) continue;
          const c = b[t];
          if (c && (c >> 3) === them) {
            if ((t >> 4) === promoRank) {
              list.push(encodeMove(sq, t, FLAG_CAPTURE, QUEEN, c, p));
              if (!tacticalOnly) {
                list.push(encodeMove(sq, t, FLAG_CAPTURE, KNIGHT, c, p));
                list.push(encodeMove(sq, t, FLAG_CAPTURE, ROOK, c, p));
                list.push(encodeMove(sq, t, FLAG_CAPTURE, BISHOP, c, p));
              }
            } else list.push(encodeMove(sq, t, FLAG_CAPTURE, 0, c, p));
          } else if (t === this.ep && !c) {
            list.push(encodeMove(sq, t, FLAG_CAPTURE | FLAG_EP, 0, makePiece(them, PAWN), p));
          }
        }
      } else if (type === KNIGHT || type === KING) {
        const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (let i = 0; i < 8; i++) {
          const t = sq + offsets[i];
          if (t & 0x88) continue;
          const c = b[t];
          if (!c) { if (!tacticalOnly) list.push(encodeMove(sq, t, 0, 0, 0, p)); }
          else if ((c >> 3) === them) list.push(encodeMove(sq, t, FLAG_CAPTURE, 0, c, p));
        }
        if (type === KING && !tacticalOnly) this.generateCastles(list, sq, p);
      } else {
        const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_OFFSETS;
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          for (let t = sq + d; !(t & 0x88); t += d) {
            const c = b[t];
            if (!c) { if (!tacticalOnly) list.push(encodeMove(sq, t, 0, 0, 0, p)); continue; }
            if ((c >> 3) === them) list.push(encodeMove(sq, t, FLAG_CAPTURE, 0, c, p));
            break;
          }
        }
      }
    }
    return list;
  }

  generateCastles(list, sq, king) {
    const b = this.board, us = this.side, them = us ^ 1;
    const home = us === WHITE ? 4 : 116;
    if (sq !== home) return;
    const kingSide = us === WHITE ? 1 : 4, queenSide = us === WHITE ? 2 : 8;
    const rook = makePiece(us, ROOK);
    if ((this.castling & kingSide) && !b[home + 1] && !b[home + 2] && b[home + 3] === rook &&
        !this.isAttacked(home, them) && !this.isAttacked(home + 1, them) && !this.isAttacked(home + 2, them)) {
      list.push(encodeMove(home, home + 2, FLAG_CASTLE, 0, 0, king));
    }
    if ((this.castling & queenSide) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook &&
        !this.isAttacked(home, them) && !this.isAttacked(home - 1, them) && !this.isAttacked(home - 2, them)) {
      list.push(encodeMove(home, home - 2, FLAG_CASTLE, 0, 0, king));
    }
  }

  // Plays a pseudo-legal move. Returns false (and restores the position) when it is illegal.
  make(m) {
    const b = this.board;
    const from = m & 127, to = (m >> 7) & 127, flags = (m >> 14) & 15, promo = (m >> 18) & 7;
    const piece = b[from];
    const us = this.side, them = us ^ 1;
    const ply = this.ply;
    this.stMove[ply] = m; this.stCastle[ply] = this.castling; this.stEp[ply] = this.ep;
    this.stHalf[ply] = this.halfmove; this.stLo[ply] = this.hashLo; this.stHi[ply] = this.hashHi;
    let lo = this.hashLo, hi = this.hashHi;
    if (this.ep !== -1) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    if (flags & FLAG_EP) {
      const capSq = to + (us === WHITE ? -16 : 16);
      const cp = b[capSq];
      b[capSq] = 0;
      lo ^= Z_PIECE_LO[cp * 128 + capSq]; hi ^= Z_PIECE_HI[cp * 128 + capSq];
    } else if (flags & FLAG_CAPTURE) {
      const cp = b[to];
      lo ^= Z_PIECE_LO[cp * 128 + to]; hi ^= Z_PIECE_HI[cp * 128 + to];
    }
    b[from] = 0;
    lo ^= Z_PIECE_LO[piece * 128 + from]; hi ^= Z_PIECE_HI[piece * 128 + from];
    const placed = promo ? makePiece(us, promo) : piece;
    b[to] = placed;
    lo ^= Z_PIECE_LO[placed * 128 + to]; hi ^= Z_PIECE_HI[placed * 128 + to];
    if ((piece & 7) === KING) this.kings[us] = to;
    if (flags & FLAG_CASTLE) {
      const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1;
      const rook = b[rf];
      b[rf] = 0; b[rt] = rook;
      lo ^= Z_PIECE_LO[rook * 128 + rf] ^ Z_PIECE_LO[rook * 128 + rt];
      hi ^= Z_PIECE_HI[rook * 128 + rf] ^ Z_PIECE_HI[rook * 128 + rt];
    }
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    this.ep = -1;
    if (flags & FLAG_DOUBLE) {
      const enemyPawn = makePiece(them, PAWN);
      if ((!((to - 1) & 0x88) && b[to - 1] === enemyPawn) || (!((to + 1) & 0x88) && b[to + 1] === enemyPawn)) {
        this.ep = (from + to) >> 1;
        lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7];
      }
    }
    this.halfmove = ((piece & 7) === PAWN || (flags & FLAG_CAPTURE)) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = them;
    this.hashLo = lo ^ Z_SIDE_LO; this.hashHi = hi ^ Z_SIDE_HI;
    this.ply = ply + 1;
    if (this.isAttacked(this.kings[us], them)) { this.unmake(); return false; }
    return true;
  }

  unmake() {
    const ply = --this.ply;
    const m = this.stMove[ply];
    const b = this.board;
    const from = m & 127, to = (m >> 7) & 127, flags = (m >> 14) & 15, promo = (m >> 18) & 7;
    this.side ^= 1;
    const us = this.side;
    const piece = promo ? makePiece(us, PAWN) : b[to];
    b[from] = piece;
    b[to] = 0;
    if (flags & FLAG_EP) b[to + (us === WHITE ? -16 : 16)] = (m >> 21) & 15;
    else if (flags & FLAG_CAPTURE) b[to] = (m >> 21) & 15;
    if ((piece & 7) === KING) this.kings[us] = from;
    if (flags & FLAG_CASTLE) {
      const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1;
      b[rf] = b[rt]; b[rt] = 0;
    }
    if (us === BLACK) this.fullmove--;
    this.castling = this.stCastle[ply]; this.ep = this.stEp[ply]; this.halfmove = this.stHalf[ply];
    this.hashLo = this.stLo[ply]; this.hashHi = this.stHi[ply];
  }

  makeNull() {
    const ply = this.ply;
    this.stMove[ply] = 0; this.stCastle[ply] = this.castling; this.stEp[ply] = this.ep;
    this.stHalf[ply] = this.halfmove; this.stLo[ply] = this.hashLo; this.stHi[ply] = this.hashHi;
    if (this.ep !== -1) { this.hashLo ^= Z_EP_LO[this.ep & 7]; this.hashHi ^= Z_EP_HI[this.ep & 7]; }
    this.ep = -1;
    this.halfmove = 0; // repetition look-back never crosses a null move
    this.side ^= 1;
    this.hashLo ^= Z_SIDE_LO; this.hashHi ^= Z_SIDE_HI;
    this.ply = ply + 1;
  }

  unmakeNull() {
    const ply = --this.ply;
    this.side ^= 1;
    this.ep = this.stEp[ply]; this.halfmove = this.stHalf[ply];
    this.hashLo = this.stLo[ply]; this.hashHi = this.stHi[ply];
  }

  // True when the current position occurred earlier since the last irreversible move.
  isRepetition() {
    const stop = Math.max(0, this.ply - this.halfmove);
    for (let i = this.ply - 4; i >= stop; i -= 2) {
      if (this.stLo[i] === this.hashLo && this.stHi[i] === this.hashHi) return true;
    }
    return false;
  }

  repetitionCount() {
    let count = 1;
    const stop = Math.max(0, this.ply - this.halfmove);
    for (let i = this.ply - 2; i >= stop; i -= 2) {
      if (this.stLo[i] === this.hashLo && this.stHi[i] === this.hashHi) count++;
    }
    return count;
  }

  insufficientMaterial() {
    let minors = 0, lightBishops = 0, darkBishops = 0, knights = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const t = this.board[sq] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) knights++;
      else if (isLightSquare(sq)) lightBishops++;
      else darkBishops++;
    }
    if (minors <= 1) return true;
    return knights === 0 && (lightBishops === 0 || darkBishops === 0);
  }

  legalMoves() {
    const pseudo = this.generate([]);
    const legal = [];
    for (const m of pseudo) if (this.make(m)) { this.unmake(); legal.push(m); }
    return legal;
  }

  hasLegalMove() {
    const pseudo = this.generate([]);
    for (const m of pseudo) if (this.make(m)) { this.unmake(); return true; }
    return false;
  }

  status() {
    const winner = this.side ^ 1;
    if (!this.hasLegalMove()) {
      return this.inCheck() ? {over: true, result: 'checkmate', winner} : {over: true, result: 'stalemate', winner: -1};
    }
    if (this.insufficientMaterial()) return {over: true, result: 'insufficient', winner: -1};
    if (this.halfmove >= 100) return {over: true, result: 'fifty', winner: -1};
    if (this.repetitionCount() >= 3) return {over: true, result: 'repetition', winner: -1};
    return {over: false, result: null, winner: -1, check: this.inCheck()};
  }

  san(m, legal = this.legalMoves()) {
    const from = moveFrom(m), to = moveTo(m), flags = moveFlags(m), promo = movePromo(m);
    const piece = movePiece(m), type = piece & 7;
    let s;
    if (flags & FLAG_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else if (type === PAWN) {
      s = (flags & FLAG_CAPTURE) ? 'abcdefgh'[from & 7] + 'x' + sqName(to) : sqName(to);
      if (promo) s += '=' + ' PNBRQK'[promo];
    } else {
      s = ' PNBRQK'[type];
      let ambiguous = false, sameFile = false, sameRank = false;
      for (const o of legal) {
        if (o === m || moveTo(o) !== to || movePiece(o) !== piece || moveFrom(o) === from) continue;
        ambiguous = true;
        if ((moveFrom(o) & 7) === (from & 7)) sameFile = true;
        if ((moveFrom(o) >> 4) === (from >> 4)) sameRank = true;
      }
      if (ambiguous) s += !sameFile ? 'abcdefgh'[from & 7] : !sameRank ? String((from >> 4) + 1) : sqName(from);
      if (flags & FLAG_CAPTURE) s += 'x';
      s += sqName(to);
    }
    if (this.make(m)) {
      if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
      this.unmake();
    }
    return s;
  }

  moveFromUci(uci) {
    if (typeof uci !== 'string' || uci.length < 4) return 0;
    const from = parseSquare(uci.slice(0, 2)), to = parseSquare(uci.slice(2, 4));
    const promo = uci.length > 4 ? PIECE_CHARS.indexOf(uci[4].toLowerCase()) : 0;
    for (const m of this.legalMoves()) {
      if (moveFrom(m) === from && moveTo(m) === to && movePromo(m) === Math.max(0, promo)) return m;
    }
    return 0;
  }

  // Copies the board state only (no move history).
  clone() { return new Position(this.fen()); }
}

export function moveToUci(m) {
  const promo = movePromo(m);
  return sqName(moveFrom(m)) + sqName(moveTo(m)) + (promo ? PIECE_CHARS[promo] : '');
}

// Squares involved in a move, for animation: the rook hop of castling and the en passant victim.
export function moveDetails(m) {
  const from = moveFrom(m), to = moveTo(m), flags = moveFlags(m), piece = movePiece(m);
  const color = piece >> 3;
  const details = {from, to, piece, color, promo: movePromo(m), captured: moveCaptured(m),
    capture: (flags & FLAG_CAPTURE) !== 0, enPassant: (flags & FLAG_EP) !== 0, castle: null, captureSquare: -1};
  if (details.capture) details.captureSquare = details.enPassant ? to + (color === WHITE ? -16 : 16) : to;
  if (flags & FLAG_CASTLE) {
    details.castle = to > from ? {rookFrom: from + 3, rookTo: from + 1, side: 'king'} : {rookFrom: from - 4, rookTo: from - 1, side: 'queen'};
  }
  return details;
}

// Game record on top of Position: SAN history, undo, persistence.
export class Game {
  constructor(fen = START_FEN) {
    this.startFen = fen;
    this.position = new Position(fen);
    this.history = []; // {move, san, uci}
  }

  get side() { return this.position.side; }
  legalMoves() { return this.position.legalMoves(); }
  movesFrom(sq) { return this.legalMoves().filter(m => moveFrom(m) === sq); }

  play(m) {
    const legal = this.position.legalMoves();
    if (!legal.includes(m)) return null;
    const san = this.position.san(m, legal);
    this.position.make(m);
    const entry = {move: m, san, uci: moveToUci(m)};
    this.history.push(entry);
    return entry;
  }

  playUci(uci) {
    const m = this.position.moveFromUci(uci);
    return m ? this.play(m) : null;
  }

  undo() {
    if (!this.history.length) return null;
    this.position.unmake();
    return this.history.pop();
  }

  status() { return this.position.status(); }
  uciMoves() { return this.history.map(h => h.uci); }

  toJSON() { return {startFen: this.startFen, moves: this.uciMoves()}; }

  static fromJSON(data) {
    const game = new Game(data && data.startFen ? data.startFen : START_FEN);
    for (const uci of (data && data.moves) || []) {
      if (!game.playUci(uci)) throw new Error('Saved game contains an illegal move: ' + uci);
    }
    return game;
  }
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.generate([]);
  let nodes = 0;
  for (const m of moves) {
    if (!pos.make(m)) continue;
    nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake();
  }
  return nodes;
}
