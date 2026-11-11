// Unreal Engine math conventions, ported so the flight model matches DroneCameraPawn.cpp line for line.
// Left-handed: X forward (north), Y right (east), Z up. Angles in degrees. Positions in METERS here.
// FRotator(Pitch, Yaw, Roll): +Pitch = nose up, +Yaw = turn right (clockwise from above), +Roll = right side down.

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const SMALL = 1e-4; // KINDA_SMALL_NUMBER

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

// ---- vectors ----
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = a => Math.hypot(a.x, a.y, a.z);
export const size2D = a => Math.hypot(a.x, a.y);
export const safeNormal = a => { const l = len(a); return l < 1e-8 ? v3() : mul(a, 1 / l); };
export const clampSize = (a, m) => { const l = len(a); return l > m && l > 0 ? mul(a, m / l) : a; };

// ---- scalar helpers (FMath) ----
export function normalizeAxis(a) { a = a % 360; if (a < 0) a += 360; if (a > 180) a -= 360; return a; }
export function findDeltaAngleDegrees(a1, a2) { let d = a2 - a1; if (d > 180) d -= 360; else if (d < -180) d += 360; return d; }
export function fInterpConstantTo(cur, target, dt, speed) {
  const dist = target - cur;
  if (dist * dist < 1e-8) return target;
  const step = speed * dt;
  return cur + clamp(dist, -step, step);
}
export function vInterpConstantTo(cur, target, dt, speed) {
  const delta = sub(target, cur), m = len(delta), maxStep = speed * dt;
  if (m > maxStep) return maxStep > 0 ? add(cur, mul(delta, maxStep / m)) : cur;
  return target;
}
export const smoothStep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- quaternions (FQuat) ----
export const qIdent = () => ({ x: 0, y: 0, z: 0, w: 1 });

/** FRotator::Quaternion() */
export function qFromRot(pitch, yaw, roll) {
  const p = (pitch % 360) * D2R * 0.5, y = (yaw % 360) * D2R * 0.5, r = (roll % 360) * D2R * 0.5;
  const SP = Math.sin(p), CP = Math.cos(p), SY = Math.sin(y), CY = Math.cos(y), SR = Math.sin(r), CR = Math.cos(r);
  return {
    x: CR * SP * SY - SR * CP * CY,
    y: -CR * SP * CY - SR * CP * SY,
    z: CR * CP * SY - SR * SP * CY,
    w: CR * CP * CY + SR * SP * SY,
  };
}
/** FQuat operator*: A*B applies B first, then A. */
export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function qNorm(q) { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; }
export const qInv = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qRotate(q, v) {
  const Q = v3(q.x, q.y, q.z);
  const T = mul(cross(Q, v), 2);
  return add(add(v, mul(T, q.w)), cross(Q, T));
}
export const qUnrotate = (q, v) => qRotate(qInv(q), v);
export const qForward = q => qRotate(q, v3(1, 0, 0));
export const qRight = q => qRotate(q, v3(0, 1, 0));
export const qUp = q => qRotate(q, v3(0, 0, 1));
/** FQuat::Slerp (shortest path, normalized). */
export function qSlerp(a, b, t) {
  const raw = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const cosom = Math.abs(raw);
  let s0, s1;
  if (cosom < 0.9999) {
    const omega = Math.acos(cosom), inv = 1 / Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) * inv; s1 = Math.sin(t * omega) * inv;
  } else { s0 = 1 - t; s1 = t; }
  s1 = raw >= 0 ? s1 : -s1;
  return qNorm({ x: s0 * a.x + s1 * b.x, y: s0 * a.y + s1 * b.y, z: s0 * a.z + s1 * b.z, w: s0 * a.w + s1 * b.w });
}
/** FQuat::AngularDistance, radians. */
export function qAngularDistance(a, b) {
  const ip = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  return Math.acos(clamp(2 * ip * ip - 1, -1, 1));
}
/** FQuat::Rotator() -> {p, y, r} */
export function qToRot(q) {
  const { x: X, y: Y, z: Z, w: W } = q;
  const sing = Z * X - W * Y;
  const yawY = 2 * (W * Z + X * Y), yawX = 1 - 2 * (Y * Y + Z * Z);
  const T = 0.4999995;
  const yaw = Math.atan2(yawY, yawX) * R2D;
  if (sing < -T) return { p: -90, y: yaw, r: normalizeAxis(-yaw - 2 * Math.atan2(X, W) * R2D) };
  if (sing > T) return { p: 90, y: yaw, r: normalizeAxis(yaw - 2 * Math.atan2(X, W) * R2D) };
  return { p: Math.asin(clamp(2 * sing, -1, 1)) * R2D, y: yaw, r: Math.atan2(-2 * (W * X + Y * Z), 1 - 2 * (X * X + Y * Y)) * R2D };
}
export const rotQ = r => qFromRot(r.p, r.y, r.r);
/** FVector::Rotation() (roll 0). */
export const vecRotation = v => ({ p: Math.atan2(v.z, Math.hypot(v.x, v.y)) * R2D, y: Math.atan2(v.y, v.x) * R2D, r: 0 });
/** FRotator::Vector() */
export function rotVector(p, y) { const cp = Math.cos(p * D2R); return v3(cp * Math.cos(y * D2R), cp * Math.sin(y * D2R), Math.sin(p * D2R)); }

/** FQuat(FMatrix) for a matrix whose rows are the X, Y, Z axes. */
export function qFromAxes(X, Y, Z) {
  const M = [[X.x, X.y, X.z], [Y.x, Y.y, Y.z], [Z.x, Z.y, Z.z]];
  const tr = M[0][0] + M[1][1] + M[2][2];
  if (tr > 0) {
    const invS = 1 / Math.sqrt(tr + 1), s = 0.5 * invS;
    return qNorm({ w: 0.5 / invS, x: (M[1][2] - M[2][1]) * s, y: (M[2][0] - M[0][2]) * s, z: (M[0][1] - M[1][0]) * s });
  }
  let i = 0; if (M[1][1] > M[0][0]) i = 1; if (M[2][2] > M[i][i]) i = 2;
  const nxt = [1, 2, 0], j = nxt[i], k = nxt[j];
  const invS = 1 / Math.sqrt(M[i][i] - M[j][j] - M[k][k] + 1), s = 0.5 * invS;
  const qt = [0, 0, 0, 0];
  qt[i] = 0.5 / invS; qt[3] = (M[j][k] - M[k][j]) * s; qt[j] = (M[i][j] + M[j][i]) * s; qt[k] = (M[i][k] + M[k][i]) * s;
  return qNorm({ x: qt[0], y: qt[1], z: qt[2], w: qt[3] });
}
/** FRotationMatrix::MakeFromXZ(X, Z).ToQuat() */
export function qMakeFromXZ(xAxis, zAxis) {
  const X = safeNormal(xAxis);
  let N = safeNormal(zAxis);
  if (Math.abs(Math.abs(dot(X, N)) - 1) < 1e-8) N = Math.abs(X.z) < 1 - SMALL ? v3(0, 0, 1) : v3(1, 0, 0);
  const Y = safeNormal(cross(N, X));
  const Z = cross(X, Y);
  return qFromAxes(X, Y, Z);
}
