import test from 'node:test';
import assert from 'node:assert/strict';
import {Position, START_FEN, moveToUci} from '../web/js/chess.js';
import {Searcher, LEVELS, evaluate, MATE} from '../web/js/ai.js';

const searcher = new Searcher(16);
const fast = {...LEVELS.archmage, time: 400};

function mirrorFen(fen) {
  const [board, side, castle, ep, half, full] = fen.split(' ');
  const swap = s => s.replace(/[a-z]/gi, c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  const rows = board.split('/').reverse().map(swap).join('/');
  const castling = castle === '-' ? '-' : swap(castle).split('').sort((a, b) => 'KQkq'.indexOf(a) - 'KQkq'.indexOf(b)).join('');
  const passant = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
  return [rows, side === 'w' ? 'b' : 'w', castling, passant, half, full].join(' ');
}

test('evaluation is colour symmetric', () => {
  for (const fen of [START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1']) {
    assert.equal(evaluate(new Position(fen)), evaluate(new Position(mirrorFen(fen))), fen);
  }
});

test('finds mate in one', () => {
  for (const [fen, expected] of [
    ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'd1d8'],
    ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7'],
  ]) {
    const result = searcher.think(new Position(fen), fast);
    assert.equal(moveToUci(result.move), expected);
    assert.ok(result.score > MATE - 100);
  }
});

test('mates instead of stalemating with king and queen', () => {
  const pos = new Position('k7/8/1K6/8/8/8/8/2Q5 w - - 0 1');
  const result = searcher.think(pos, fast);
  pos.make(result.move);
  assert.equal(pos.status().result, 'checkmate', moveToUci(result.move));
});

test('collects a hanging queen and avoids losing its own', () => {
  const win = searcher.think(new Position('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1'), {...LEVELS.adept, variety: 0});
  assert.equal(moveToUci(win.move), 'd1d5');
  const pos = new Position('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 3');
  const save = searcher.think(pos, {...LEVELS.adept, variety: 0});
  pos.make(save.move);
  const reply = searcher.think(pos, fast);
  assert.notEqual(moveToUci(reply.move), 'f3h4', 'queen escaped the knight');
});

test('every level returns a legal move, including forced and terminal positions', () => {
  for (const level of Object.values(LEVELS)) {
    const pos = new Position();
    for (let ply = 0; ply < 6; ply++) {
      const result = searcher.think(pos, {...level, time: Math.min(level.time, 150)});
      assert.ok(pos.legalMoves().includes(result.move), level.label);
      pos.make(result.move);
    }
  }
  const forced = new Position('7k/8/8/8/8/8/6q1/7K w - - 0 1');
  assert.equal(moveToUci(searcher.think(forced, fast).move), 'h1g2');
  assert.equal(searcher.think(new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), fast).move, 0);
});

test('search restores the position it was given', () => {
  const pos = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const before = pos.fen();
  searcher.think(pos, fast);
  assert.equal(pos.fen(), before);
});
