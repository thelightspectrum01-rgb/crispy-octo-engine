// Bakes every procedural material texture used by the scene.
import {TextureBaker} from './textures.js';

export function createTextures(renderer, quality) {
  const baker = new TextureBaker(renderer, quality.texture, quality.anisotropy);
  const floorSeed = 31.7, wallSeed = 12.3;
  const textures = {
    // Ivory statuary marble with grey veining.
    whiteMarble: baker.marble({uBase1: [0.7, 0.65, 0.56], uBase2: [0.86, 0.82, 0.74], uVein: [0.4, 0.39, 0.38], uSpeck: [0.5, 0.47, 0.42],
      uVeinAmount: 0.5, uVeinWidth: 0.05, uCloud: 0.1}, {seed: 3.1}),
    // Nero Marquina: near-black with sparse white veins.
    blackMarble: baker.marble({uBase1: [0.01, 0.01, 0.012], uBase2: [0.032, 0.03, 0.034], uVein: [0.5, 0.5, 0.48], uSpeck: [0.18, 0.18, 0.18],
      uVeinAmount: 0.7, uVeinWidth: 0.03, uCloud: 0.35, uSpeckAmount: 0.004}, {seed: 8.4}),
    boardLight: baker.marble({uBase1: [0.42, 0.32, 0.2], uBase2: [0.58, 0.47, 0.32], uVein: [0.3, 0.2, 0.1], uSpeck: [0.3, 0.22, 0.14],
      uVeinAmount: 0.45, uVeinWidth: 0.05, uVeinScale: 1.2}, {seed: 5.5}),
    // Verde Alpi serpentine.
    boardDark: baker.marble({uBase1: [0.006, 0.018, 0.014], uBase2: [0.018, 0.045, 0.034], uVein: [0.24, 0.36, 0.3], uSpeck: [0.1, 0.16, 0.12],
      uVeinAmount: 0.6, uVeinWidth: 0.04, uVeinScale: 1.8, uCloud: 0.3}, {seed: 9.9}),
    stoneNormal: baker.stoneNormal(2.0, 0.25, {seed: 1.2}),
    boardNormal: baker.stoneNormal(1.0, 0.05, {seed: 4.4}),
    floorAlbedo: baker.flagstones(0, {seed: floorSeed}),
    floorNormal: baker.flagstones(1, {seed: floorSeed}),
    floorORM: baker.flagstones(2, {seed: floorSeed}),
    wallAlbedo: baker.ashlar(0, {seed: wallSeed}),
    wallNormal: baker.ashlar(1, {seed: wallSeed}),
  };
  textures.daisAlbedo = textures.wallAlbedo;
  textures.daisNormal = textures.wallNormal;
  textures.baker = baker;
  return textures;
}
