# Desk Coaster — miniature time-trial racing in Three.js

A tiny motorised roller-coaster cart races around a toy track built on top of a cluttered desk
(cutting mat, notebook, mug, keyboard, lamp…). Hit the launch strip, ride the first hill, brake into the banked
horseshoe, survive the vertical loop, flick through the chicane and spiral down the helix – three laps against the
clock, your own ghost and a bot rival. Everything you see and hear is generated in code: no textures, models or
audio files.

**Play it:** open [`dist/desk-coaster.html`](dist/desk-coaster.html) in a browser — it is a single self-contained file
(Three.js and the game are inlined), no server and no network needed.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Lean into the corner | `A` `D` / `←` `→` | ◀ ▶ buttons | left stick / d-pad |
| Boost (uses the boost meter) | `Space` / `W` / `↑` | BOOST | RT / A / RB |
| Brake | `S` / `↓` / `Shift` | BRAKE | LT / B / LB |
| Camera (chase → onboard → desk) | `C` | – | Y |
| Pause / menu | `P` / `Esc` | ❚❚ | Start |
| Restart | `R` | – | X |
| Mute · ghost mode · brake hints | `M` · `G` · `H` | – | – |

## How the game works

* The cart is on rails and the physics is 1-D along the track (gravity, drag, motor, launch, brake, boost), but
  the track itself is real 3-D geometry, so **speed drives everything**:
  * **Lateral load** (`v²·curvature` against gravity and banking) must stay inside the grip budget. Lean into the
    turn to buy extra grip. Exceed it and the cart scrubs speed (sparks, screech); keep overdoing it and it
    **derails** (3 s penalty + a short trip back up the track).
  * **Airtime** over crests tops up the boost meter; **battery cells** on the rails refill it too.
  * The **launch strip** in the station fires the cart at the start of every lap, so a lap is a fresh energy budget.
* The HUD helps you learn the track: a white tick on the speedometer shows the speed you *should* have ahead,
  a red **BRAKE** prompt flashes when you are too fast for what is coming, the grip bar shows how close to the limit
  you are and the chevrons show which way to lean (hints can be switched off, `H`). Yellow signs beside the track
  show corner speeds.
* **Ghosts:** your personal-best run is saved (localStorage) and replays as a cyan ghost; with no record yet you race a
  bot **rival** (orange). The delta in the top centre is measured against the active ghost, plus a split at every gate.
* **Two circuits:** *Classic* and *Mirror* (the same track run clockwise – every habit has to be relearned). Records, medals and
  ghosts are stored per circuit and lap count.
* **Medals** are scored against a reference lap time computed by driving the track with a perfect autopilot
  (gold ≤ +4 %, silver ≤ +10 %, bronze ≤ +22 %).

## Run / build / test

```bash
npm install            # three + esbuild
npm run dev            # static dev server → http://localhost:5173 (ES modules + import map, no bundler)
npm run build          # → dist/desk-coaster.html (single file, ~0.7 MB)
npm test               # unit tests (track geometry, physics, bot, ghosts, race flow)
node scripts/sim.mjs 3 1                 # headless bot run: laps, slip, boost usage (laps, skill)
node scripts/strategies.mjs              # lazy vs optimal driving strategies (balance check)
node scripts/humans.mjs                  # human-like bots (jitter / binary lean) vs the medal targets
node scripts/inspect.mjs /tmp/track.svg  # track stats + plan / elevation / speed-profile plot (SVG)
```

URL flags (handy for testing): `?autostart` starts a race immediately, `?bot=1` lets the autopilot drive,
`?q=low|medium|high` is also available from the menu.

## Code map

```
src/
  config.js            all gameplay constants (gravity, grip, boost, medals …)
  track/
    plan.js            turtle plan builder (straights, eased arcs, loop module, exact closure) + height profile
    build.js           resampling, banking from design speed, frames (incl. loop), speed limits → baked Piece
    profile.js         best-case speed profile (forward/backward pass) used by bot, hints and medals
    layout.js          the circuit definition + Mirror variant (edit this to redesign the track)
    piece.js           baked samples + interpolation
  game/
    sim.js             cart physics: lateral grip, slip/derail, airtime, boost, launch, laps
    bot.js             autopilot (follows the speed profile) – demo cart, rival, reference times, tests
    race.js            lap/split timing, derail respawn, ghost recording, medals
    ghost.js           ghost recording / playback / compact (de)serialisation
    app.js             state machine, fixed-step loop, camera + effects, HUD feed, results
    input.js storage.js
  world/               Three.js scene: desk props, track meshes, cart + rider, particles, world assembly
  render/              post-processing (DOF → bloom → grade → tone-map), camera rig, procedural textures
  ui/ui.js             DOM HUD, menu, results
  audio/audio.js       Web Audio synthesis (rail rumble, clacks, boost jet, chimes, generative lo-fi music)
scripts/               dev server, bundler, headless sim / balance tools
tests/                 node:test suites
```

### Tweaking the feel

* `src/config.js` – `GRIP`/`LEAN` (how forgiving corners are), `BRAKE`, `BOOST_*`, `LAUNCH_V`, `DERAIL_PENALTY`, medal multipliers.
* `src/track/layout.js` – change primitive lengths / radii / heights; the two free straights (`'A'`, `'B'`) are solved so
  the circuit always closes. Banking, speed limits, braking hints and medal times all regenerate automatically.
* After any change run `npm test` and `node scripts/strategies.mjs` – a lap should be clean for the bot while
  "never brake" runs must derail.

## Notes

* Rendering uses MSAA + depth-of-field (tilt-shift look), bloom and a colour grade; **Quality → Auto** lowers the
  resolution / effects on slow GPUs, Low renders straight to the canvas.
* Works on desktop and phones (landscape recommended) – touch controls appear automatically.
