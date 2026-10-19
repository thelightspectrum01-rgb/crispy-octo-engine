// The circuit. Counter-clockwise seen from above; the finish line sits at plan parameter p = 0 on the
// front straight (heading +x). 'A' / 'B' are straights whose lengths are solved so the circuit closes.
//
// Anchors are { id, d } = "d units along primitive id" ('end' = its end), or a raw plan parameter.

export const DESK_RAILS = {
  name: 'Desk Rails',
  startAt: { id: 'start', d: 8 }, // finish line: 8 u into the station straight
  plan: [
    { id: 'start', type: 'line', len: 23 },
    { id: 'climb', type: 'line', len: 23 },
    { id: 'horseshoe', type: 'arc', deg: 180, r: 10, ease: 3.5 },
    { id: 'bs1', type: 'line', len: 3 },
    { id: 'camel', type: 'line', len: 17 },
    { id: 'loopIn', type: 'line', len: 5 },
    { id: 'loop', type: 'loop', R: 2.9, lateral: 3.0 },
    { id: 'loopOut', type: 'line', len: 3 },
    { id: 'chA', type: 'arc', deg: -38, r: 6, ease: 2 },
    { id: 'chB', type: 'arc', deg: 38, r: 6, ease: 2 },
    { id: 'back', type: 'line', len: 'A' },
    { id: 'rise', type: 'line', len: 9 },
    { id: 'helix', type: 'arc', deg: 450, r: 4.4, ease: 2.6 },
    { id: 'left', type: 'line', len: 'B' },
    { id: 'final', type: 'arc', deg: 90, r: 8, ease: 2.6 },
  ],

  // [anchor, y, slope?]  slope m = dy/dp (0 for crests / valleys)
  heights: [
    [{ id: 'start', d: 0 }, 0.9, 0],
    [{ id: 'climb', d: 0 }, 0.9, 0],
    [{ id: 'climb', d: 21 }, 8.6, 0],
    [{ id: 'horseshoe', d: 9 }, 1.3, 0],
    [{ id: 'horseshoe', d: 'end' }, 1.2, 0],
    [{ id: 'camel', d: 8.5 }, 3.4, 0],
    [{ id: 'loopIn', d: 0 }, 1.0, 0],
    [{ id: 'loopOut', d: 'end' }, 1.0, 0],
    [{ id: 'chB', d: 'end' }, 1.0, 0],
    [{ id: 'rise', d: 0 }, 1.0, 0],
    [{ id: 'rise', d: 'end' }, 3.9, 0],
    [{ id: 'helix', d: 'end' }, 0.9, 0],
  ],

  zones: [{ type: 'launch', from: { id: 'start', d: 8.8 }, to: { id: 'start', d: 18.8 } }],

  pickups: [
    { id: 'start', d: 21 },
    { id: 'climb', d: 14 },
    { id: 'horseshoe', d: 24 },
    { id: 'camel', d: 4 },
    { id: 'loopOut', d: 2 },
    { id: 'rise', d: 5 },
    { id: 'helix', d: 22 },
    { id: 'final', d: 8 },
  ],

  checkpoints: [
    { id: 'horseshoe', d: 'end' },
    { id: 'chB', d: 'end' },
    { id: 'helix', d: 20 },
  ],

  anchors: {
    finish: { id: 'start', d: 8 },
    loop: { id: 'loop', d: 0 },
    helix: { id: 'helix', d: 0 },
  },
};

/**
 * Mirror image of a layout: every arc turns the other way and the loop shifts to the other side, so the circuit
 * runs clockwise. The physics, banking, speed profile and bot are symmetric, so everything regenerates unchanged.
 */
export function mirrorLayout(layout, name = `${layout.name} (Mirror)`) {
  return {
    ...layout,
    name,
    mirror: !layout.mirror,
    plan: layout.plan.map((p) => {
      if (p.type === 'arc') return { ...p, deg: -p.deg };
      if (p.type === 'loop') return { ...p, lateral: -p.lateral };
      return { ...p };
    }),
  };
}

export const TRACKS = [
  { id: 'classic', label: 'Classic', layout: DESK_RAILS },
  { id: 'mirror', label: 'Mirror', layout: mirrorLayout(DESK_RAILS) },
];
