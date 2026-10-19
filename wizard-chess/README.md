# Wizard Chess

A 3D chess game set in a Gothic cathedral. The pieces are robed and hooded stone statues with glowing eyes. Every capture is played out as a short melee duel: the attacker summons a stone weapon, strikes, and the defender shatters into physically simulated rubble. You play against a built-in AI at four strengths.

It runs offline in any browser with WebGL 2, and the same files are packaged as an Android app.

## Features

**Chess**
- Complete rules: castling, en passant, promotion with a piece picker, check, checkmate, stalemate, threefold repetition, the fifty-move rule and insufficient material.
- Move list in standard algebraic notation, captured pieces with material balance, take-back (your move and the reply), and hints.
- Games are saved on the device after every move and can be resumed later.

**Opponent**
- Iterative-deepening principal-variation alpha-beta search with a transposition table, quiescence search, null-move pruning, late-move reductions, killer and history move ordering, and PeSTO's tapered evaluation plus pawn-structure and endgame terms.
- Runs in a Web Worker so the cathedral keeps animating while it thinks.
- Four levels: **Novice** (shallow search with human-like noise), **Apprentice**, **Adept** (about depth 5) and **Archmage** (up to 2.2 s per move, typically depth 9–13 on a desktop).

**Cathedral and pieces**
- Clustered piers, pointed arcades, ribbed vaults, a clerestory, stained-glass lancets, two rose windows, an altar, banners, candelabras with flickering light, light shafts and drifting dust.
- Sunlight through the glass is a shadow-casting spotlight with a stained-glass cookie; the board itself stays in clear light so squares remain readable.
- Marble, flagstone and masonry textures are generated on the GPU at load time; nothing is downloaded.
- Each piece is a sculpted surface of revolution with carved cloth folds and baked crevice shading; the knight's head is carved from its side silhouette with a rounded rim, full cheeks and eye sockets. White pieces are ivory statuary marble with pale-blue eyes; black pieces are Nero Marquina marble with ember eyes.
- Glossy finish: on High and Ultra the statues are clear-coated polished marble, the board is mirror-polished and reflects the pieces standing on it (a planar reflection), and every polished surface reflects the real cathedral, captured into an environment map at load time. Shards show matte fresh-broken stone on their fracture faces.

**Captures, physics and sound**
- Six attack styles: the pawn thrusts a spear, the knight rears and strikes with its head, the bishop brings a crozier down overhead, the rook leaps and crushes, the queen sweeps a sword, and the king chops with a greatsword.
- Cinematic camera with letterbox, slow motion at the moment of impact, sparks, dust, a shockwave and camera shake. Tap or click to speed a duel up. Cinematics can be limited to non-pawn captures or turned off in Settings.
- The defender is broken into Voronoi fragments that tile its actual volume. The fragments are rigid bodies: they tumble, bounce off the board, the frame and the dais steps with friction, collide with each other and with standing pieces, get shoved aside by the victor walking in, settle, and crumble away.
- Promotions raise the new piece in a pillar of light. Checkmate ends with the fallen king breaking apart.
- All sound is synthesised with Web Audio: a cathedral reverb, an organ and choir drone, stone footsteps, sword whooshes, impacts, falling rubble that follows the physics, and church bells.

## Play in a browser

Serve the `web` folder with any static file server and open it in a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari). For example:

```sh
cd wizard-chess
npm run serve          # python3 -m http.server 8000 --directory web
# then open http://localhost:8000
```

Opening `index.html` straight from the file system does not work, because browsers block ES modules and workers on `file://` URLs.

### Controls

| Action | Touch / mouse | Keyboard |
|---|---|---|
| Move a piece | Tap the piece, then a glowing square | |
| Orbit the camera | Drag | |
| Zoom | Pinch or scroll | |
| Speed up a duel | Tap or click | Space or Enter |
| Take back | Curved arrow | U |
| Hint | Candle | H |
| Reset the view | Circular arrows | V |
| Sound on/off | Speaker | M |
| Frame-rate meter | Settings | F |
| Menu | Three lines | Esc |

## Graphics and frame rate

| Preset | Render resolution | Textures | Shadows | Glossy finish | Board mirror |
|---|---|---|---|---|---|
| Low | screen at 1× | 512 px | off | polished | off |
| Medium | up to 1.5× | 512 px | 1024 px | polished | 30% resolution |
| High | up to 2× | 1024 px | 2048 px | clear-coated | 50% resolution |
| **Ultra 4K** | 3840×2160, or the screen's native resolution if higher | 2048 px | 4096 px | clear-coated | 75% resolution |

**Auto** picks a preset from the device and GPU (Ultra for recent dedicated GPUs and Apple Pro/Max chips). Change it in Settings → Graphics; a restart applies it. On a screen smaller than 4K, Ultra still renders 3840×2160 and scales it down, which acts as supersampling.

The game runs at the display's refresh rate: a 120 Hz screen gets up to 120 fps, a 144 Hz screen up to 144. Set **Frame rate → 60 fps** to save battery. When the GPU cannot keep up, the game lowers its render resolution in steps (to no less than half) until frames stop dropping, then probes back up once there is headroom; turn this off in Settings to keep full resolution at any frame rate. Press **F**, or enable **Show frame rate**, to see the live frame rate, the detected display rate and the current render resolution.

Whether 4K and 120 fps hold at the same time depends on the GPU. Shadows and the board mirror are only re-rendered when something moves, and rubble physics steps at 240 Hz so it stays smooth on fast displays. To avoid stutters mid-duel, shaders are compiled and textures uploaded while the game loads, and each capture's fracture is computed as the duel begins, while the board is still. Safari on Mac and iPhone limits pages to 60 fps unless its ProMotion setting is enabled. The Android app asks the system for the panel's fastest refresh mode.

## Android app

`android/` is a small WebView host that packages `web/` unchanged as the app's assets and serves it through `WebViewAssetLoader`. The app requests no internet permission (only vibration for impact haptics), keeps the screen on during a game, pauses audio in the background, and maps the Back button to the in-game menus.

### Build with GitHub Actions

The `wizard-chess` workflow (`.github/workflows/wizard-chess.yml`) runs the tests and builds a debug APK whenever files under `wizard-chess/` change, and can also be started by hand from the Actions tab. Download the APK from the run's `wizard-chess-apk` artifact.

### Build locally

Requirements: JDK 17 or newer, Android SDK Platform 35 and Build-Tools 35.0.0, Gradle 8.11.1 or newer.

```sh
cd wizard-chess/android
gradle :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

| Setting | Value |
|---|---|
| Package | `com.wizardchess.cathedral` (debug: `.debug` suffix) |
| Minimum Android | 8.0 (API 26) |
| Compile / target SDK | 35 |
| Android Gradle Plugin | 8.9.2 |
| Graphics | OpenGL ES 3 (WebGL 2) |

A release build needs your own signing key.

## Project layout

| Path | Contents |
|---|---|
| `web/index.html`, `web/style.css` | Page, HUD and menus |
| `web/js/chess.js` | Rules engine (0x88 board, move generation, SAN, draw rules, save format) |
| `web/js/ai.js`, `ai-worker.js`, `engine.js` | Search and evaluation, the worker, and the main-thread client with an inline fallback |
| `web/js/stage.js` | Renderer, quality presets, bloom, render resolution, environment capture |
| `web/js/perf.js` | Refresh-rate detection, 60 fps cap and dynamic resolution |
| `web/js/reflection.js` | Planar mirror reflection for the board |
| `web/js/textures.js`, `assets.js` | GPU-baked stone textures and canvas decals |
| `web/js/cathedral.js`, `board.js` | Architecture, lighting, board, frame and move markers |
| `web/js/pieces.js`, `weapons.js` | Sculpted piece and weapon geometry |
| `web/js/director.js` | Move, capture, promotion, take-back and checkmate choreography |
| `web/js/shatter.js` | Voronoi fracture and rigid-body rubble physics |
| `web/js/fx.js`, `camera.js`, `audio.js` | Particles and trails, camera rig, procedural sound |
| `web/js/ui.js`, `main.js`, `platform.js` | DOM layer, game controller, Android bridge |
| `web/vendor/three/` | three.js r169 (MIT) and the few add-ons used |
| `android/` | Android WebView host (Gradle project) |
| `tests/` | Node tests |

## Tests

```sh
cd wizard-chess
npm test        # rules (perft), AI, fracture and physics, frame pacing, Android bridge
npm run verify  # static checks of modules, DOM ids, assets and the Android manifest
```

The rules engine is checked against the standard perft node counts for six reference positions, including castling, en passant and promotion edge cases. The AI tests cover mates in one, avoiding stalemate, material tactics and every difficulty level. The shatter tests check that the fragments tile each piece's volume and that rubble settles on the board and dissolves. The frame-pacing tests simulate 60–240 Hz displays and GPUs of different speeds to check refresh detection, the 60 fps cap and dynamic resolution.

## Credits

- [three.js](https://threejs.org) r169, MIT licence (`web/vendor/three/LICENSE`).
- Cinzel and EB Garamond fonts, SIL Open Font License (`web/fonts/`).
- All models, textures, animation and sound are generated by the code in this folder.
