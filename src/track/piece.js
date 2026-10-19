import { Vector3 } from 'three';

/**
 * A baked piece of track: uniformly spaced samples (arc length `ds`) of the spine curve together with
 * its orthonormal frame (tangent / up / right) and the pre-computed quantities the cart physics needs.
 *
 * Frame convention: right = tangent × up. Positive curvature along `right` = turning right.
 */
export class Piece {
  constructor(data) {
    Object.assign(this, data);
    this._i0 = 0;
    this._i1 = 0;
    this._f = 0;
  }

  wrap(s) {
    const L = this.length;
    if (this.closed) {
      s %= L;
      if (s < 0) s += L;
      return s;
    }
    return s < 0 ? 0 : s > L ? L : s;
  }

  locate(s) {
    s = this.wrap(s);
    const n = this.n;
    let f = s / this.ds;
    let i0 = Math.floor(f);
    f -= i0;
    let i1 = i0 + 1;
    if (this.closed) {
      if (i0 >= n) i0 -= n;
      if (i1 >= n) i1 -= n;
    } else {
      if (i0 > n - 1) i0 = n - 1;
      if (i1 > n - 1) i1 = n - 1;
    }
    this._i0 = i0;
    this._i1 = i1;
    this._f = f;
  }

  /** Interpolated spine position + frame at arc length s. */
  frame(s, out) {
    this.locate(s);
    const { _i0: a, _i1: b, _f: f } = this;
    const lerp3 = (arr, v) => {
      v.set(
        arr[3 * a] + (arr[3 * b] - arr[3 * a]) * f,
        arr[3 * a + 1] + (arr[3 * b + 1] - arr[3 * a + 1]) * f,
        arr[3 * a + 2] + (arr[3 * b + 2] - arr[3 * a + 2]) * f,
      );
      return v;
    };
    lerp3(this.pos, out.pos);
    lerp3(this.tan, out.tan).normalize();
    lerp3(this.up, out.up);
    out.up.addScaledVector(out.tan, -out.up.dot(out.tan)).normalize();
    out.right.crossVectors(out.tan, out.up);
    return out;
  }

  /** Interpolated physics scalars at arc length s. */
  params(s, out) {
    this.locate(s);
    const { _i0: a, _i1: b, _f: f } = this;
    out.slope = this.slope[a] + (this.slope[b] - this.slope[a]) * f;
    out.kSide = this.kSide[a] + (this.kSide[b] - this.kSide[a]) * f;
    out.kUp = this.kUp[a] + (this.kUp[b] - this.kUp[a]) * f;
    out.gSide = this.gSide[a] + (this.gSide[b] - this.gSide[a]) * f;
    out.gUp = this.gUp[a] + (this.gUp[b] - this.gUp[a]) * f;
    return out;
  }

  sample(arr, s) {
    this.locate(s);
    return arr[this._i0] + (arr[this._i1] - arr[this._i0]) * this._f;
  }
}

export function makeFrame() {
  return { pos: new Vector3(), tan: new Vector3(), up: new Vector3(), right: new Vector3() };
}
