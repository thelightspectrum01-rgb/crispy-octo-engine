// Central tuning constants. Distances are in "desk units" (1 unit ≈ the length of the cart),
// times in seconds. Everything gameplay related lives here so the feel is easy to adjust.

export const PHYS = {
  G: 5.6, // gravity (u/s²) – deliberately low: it's a *miniature*, slow-motion physics
  DRAG: 0.0011, // quadratic air drag
  ROLL: 0.04, // constant rolling resistance

  // The cart has a small motor that keeps it from ever stalling.
  CRUISE_V: 5.2, // below this speed the motor pushes
  CRUISE_GAIN: 3.2,
  MOTOR_MAX: 5.0,

  BRAKE: 10, // brake deceleration

  // Boost
  BOOST_ACCEL: 8.0,
  BOOST_TOP: 15.5,
  BOOST_DRAIN: 34, // meter % per second while boosting
  BOOST_MAX: 100,
  BOOST_START: 40, // meter at the start of a race
  AIR_BOOST: 22, // meter % per second gained while airborne (negative vertical G)
  PICKUP_BOOST: 16, // meter % per battery cell

  // Launch strip (magnetic launch in the station)
  LAUNCH_V: 14.5,
  LAUNCH_ACCEL: 14,

  // Cornering. Lateral load is measured in g; the cart tolerates GRIP g, leaning adds LEAN g.
  GRIP: 0.55,
  LEAN: 0.35,
  LEAN_TAU: 0.12,
  SLIP_RATE: 3.2, // slip meter fill per second per unit of overload
  SLIP_DECAY: 1.6,
  SLIP_DECEL: 11, // extra deceleration while scrubbing
  DERAIL_SLIP: 1.0,

  // Riding the grip limit (|load| between EDGE_MIN and 1 of the budget) pays out boost: risk = reward
  EDGE_MIN: 0.8,
  EDGE_TIME: 0.4,
  EDGE_BOOST: 5,
  START_BOOST: 15, // reaction-start bonus

  AIR_THRESHOLD: 0.1, // vertical load (g) below which the cart is "airborne"
  STALL_TIME: 2.2,
  FINISH_BRAKE: 7.5,
};

export const GAME = {
  LAPS: 3,
  PHYS_DT: 1 / 120,
  DERAIL_PENALTY: 3.0,
  COUNTDOWN: 3,
  // medal thresholds are multiples of the reference (bot) time
  MEDALS: { gold: 1.04, silver: 1.1, bronze: 1.22 },
};

export const TRACK = {
  DS: 0.1, // arc-length spacing of the baked track samples
  GAUGE: 0.74, // distance between rail centres
  MAX_BANK: (58 * Math.PI) / 180,
};
