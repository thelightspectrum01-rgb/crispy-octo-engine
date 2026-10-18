import test from 'node:test';
import assert from 'node:assert/strict';
import {Position, Game, perft, START_FEN, moveToUci, moveDetails, parseSquare, WHITE, BLACK} from '../web/js/chess.js';

// Reference node counts from the Chess Programming Wiki perft results.
const PERFT = [
  {name: 'start', fen: START_FEN, counts: [20, 400, 8902, 197281]},
  {name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862]},
  {name: 'position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238, 674624]},
  {name: 'position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467, 422333]},
  {name: 'position 4 mirrored', fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', counts: [6, 264, 9467, 422333]},
  {name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379]},
  {name: 'position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890]},
];

for (const {name, fen, counts} of PERFT) {
  test('perft ' + name, () => {
    const pos = new Position(fen);
    counts.forEach((expected, i) => assert.equal(perft(pos, i + 1), expected, `depth ${i + 1}`));
    assert.equal(pos.fen(), new Position(fen).fen(), 'make/unmake restores the position');
  });
}

test('hash is restored by unmake and matches a fresh computation', () => {
  const pos = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const {hashLo, hashHi} = pos;
  for (const m of pos.legalMoves()) {
    pos.make(m);
    const after = [pos.hashLo, pos.hashHi];
    pos.computeHash();
    assert.deepEqual([pos.hashLo, pos.hashHi], after, 'incremental hash for ' + moveToUci(m));
    pos.unmake();
    assert.deepEqual([pos.hashLo, pos.hashHi], [hashLo, hashHi]);
  }
});

test('FEN round trip', () => {
  for (const {fen} of PERFT) assert.equal(new Position(fen).fen(), fen);
});

test('SAN covers castling, disambiguation, promotion, check and mate', () => {
  const game = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const sans = game.legalMoves().map(m => game.position.san(m));
  assert.ok(sans.includes('O-O'));
  assert.ok(sans.includes('O-O-O'));
  assert.ok(sans.includes('Rxa8+'));

  const knights = new Game('4k3/8/8/8/8/8/8/N3K2N w - - 0 1');
  const knightSans = knights.legalMoves().map(m => knights.position.san(m));
  assert.ok(knightSans.includes('Ng3'));
  assert.ok(knightSans.includes('Nb3'));

  const doubled = new Game('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1');
  const rookSans = doubled.legalMoves().map(m => doubled.position.san(m));
  assert.ok(rookSans.includes('Rad1') && rookSans.includes('Rfd1'), rookSans.join(' '));

  const files = new Game('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
  const fileSans = files.legalMoves().map(m => files.position.san(m));
  assert.ok(fileSans.includes('R1a3') && fileSans.includes('R5a3'), fileSans.join(' '));

  const promo = new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(promo.playUci('a7a8q').san, 'a8=Q');

  const mate = new Game();
  for (const uci of ['f2f3', 'e7e5', 'g2g4']) mate.playUci(uci);
  assert.equal(mate.playUci('d8h4').san, 'Qh4#');
  assert.deepEqual(mate.status(), {over: true, result: 'checkmate', winner: BLACK});
});

test('en passant is only available immediately and the victim square is reported', () => {
  const game = new Game();
  for (const uci of ['e2e4', 'a7a6', 'e4e5', 'd7d5']) game.playUci(uci);
  const ep = game.position.moveFromUci('e5d6');
  assert.ok(ep, 'en passant capture is legal');
  const details = moveDetails(ep);
  assert.equal(details.enPassant, true);
  assert.equal(details.captureSquare, parseSquare('d5'));
  assert.equal(game.play(ep).san, 'exd6');
  game.undo();
  game.playUci('h2h3');
  game.playUci('h7h6');
  assert.equal(game.position.moveFromUci('e5d6'), 0, 'right expired');
});

test('en passant that exposes the king along the rank is illegal', () => {
  const pos = new Position('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1');
  assert.equal(pos.moveFromUci('e5d6'), 0);
});

test('castling is refused through check and after the rook moves', () => {
  const through = new Position('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
  const sans = through.legalMoves().map(m => through.san(m));
  assert.ok(!sans.includes('O-O'), 'f1 attacked');

  const game = new Game('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  game.playUci('h1h2'); game.playUci('e8d8'); game.playUci('h2h1'); game.playUci('d8e8');
  const after = game.legalMoves().map(m => game.position.san(m));
  assert.ok(!after.includes('O-O') && after.includes('O-O-O'));
  const castle = moveDetails(game.position.moveFromUci('e1c1'));
  assert.deepEqual(castle.castle, {rookFrom: parseSquare('a1'), rookTo: parseSquare('d1'), side: 'queen'});
});

test('draw rules: stalemate, repetition, fifty moves, insufficient material', () => {
  assert.equal(new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().result, 'stalemate');

  const game = new Game();
  for (let i = 0; i < 2; i++) for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) game.playUci(uci);
  assert.equal(game.status().result, 'repetition');

  assert.equal(new Position('4k3/8/8/8/8/8/8/R3K3 w - - 100 80').status().result, 'fifty');
  assert.equal(new Position('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1').status().result, 'insufficient');
  assert.equal(new Position('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1').status().result, 'insufficient');
  assert.equal(new Position('2b1k3/8/8/8/8/8/8/3BK3 w - - 0 1').status().result, 'insufficient', 'same-colour bishops');
  assert.equal(new Position('3bk3/8/8/8/8/8/8/3BK3 w - - 0 1').status().over, false, 'opposite-colour bishops');
  assert.equal(new Position('4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1').status().over, false);
});

test('game record survives JSON round trip and undo restores state', () => {
  const game = new Game();
  for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'e1g1']) assert.ok(game.playUci(uci), uci);
  const restored = Game.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
  assert.equal(restored.position.fen(), game.position.fen());
  assert.deepEqual(restored.history.map(h => h.san), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'O-O']);
  restored.undo();
  restored.undo();
  assert.equal(restored.position.fen(), 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
  assert.equal(restored.side, BLACK);
  assert.throws(() => Game.fromJSON({moves: ['e2e5']}), /illegal/);
  assert.equal(new Game().side, WHITE);
});
