// Cue sports physics. Units: metres, seconds, radians. No dependencies, so it runs in the
// browser and in node (for testing the computer player).
//
// Table frame: x runs along the length (0 = baulk / head cushion), y across (0 = right-hand
// cushion when looking from baulk), z up. Cushion noses are the lines x=0, x=L, y=0, y=W.

export const G = 9.81;

// Real-world sizes. Pocket "mouth" is the gap between the cushion points.
export const SPECS = {
  snooker: {
    name: "Snooker", L: 3.569, W: 1.778, R: 0.02625, cw: 0.05,
    corner: { mouth: 0.096, taper: 0.06, jaw: 0.45, shelf: 0.15, knuckle: 0.013 },
    middle: { mouth: 0.108, spread: 0.05, jaw: 0.50, shelf: 0.0, knuckle: 0.016 },
    mu: { slide: 0.2, roll: 0.023, spin: 11, cushion: 0.35 },
    e: { ball: 0.94, cushion: 0.95 }, nose: 0.40, vmax: 7.0,
  },
  uk: {
    name: "UK 8-ball", L: 1.83, W: 0.915, R: 0.0254, cw: 0.042,
    corner: { mouth: 0.100, taper: 0.06, jaw: 0.45, shelf: 0.15, knuckle: 0.013 },
    middle: { mouth: 0.106, spread: 0.05, jaw: 0.50, shelf: 0.0, knuckle: 0.014 },
    mu: { slide: 0.2, roll: 0.027, spin: 11, cushion: 0.35 },
    e: { ball: 0.94, cushion: 0.92 }, nose: 0.30, vmax: 8.5,
  },
  us: {
    name: "US 8-ball", L: 2.24, W: 1.12, R: 0.028575, cw: 0.05,
    corner: { mouth: 0.126, taper: 0.06, jaw: 0.45, shelf: 0.15, knuckle: 0.010 },
    middle: { mouth: 0.140, spread: 0.05, jaw: 0.50, shelf: 0.0, knuckle: 0.011 },
    mu: { slide: 0.2, roll: 0.025, spin: 11, cushion: 0.35 },
    e: { ball: 0.95, cushion: 0.92 }, nose: 0.27, vmax: 10.0,
  },
};

SPECS.nine = { ...SPECS.us, name: "9-ball" };

// Friction between two balls falls away as they rub faster (measured on phenolic balls):
// lots of "throw" on a soft shot, very little on a hard one.
export const ballMu = v => 0.01 + 0.108 * Math.exp(-1.088 * v);

// ---------------------------------------------------------------- small vector helpers
const hyp = Math.hypot;
const norm = (x, y) => { const l = hyp(x, y) || 1; return { x: x / l, y: y / l }; };

// Round the corner at V (between P->V and V->N) with radius r; returns the arc points.
function fillet(P, V, N, r, steps) {
  const d1 = norm(P.x - V.x, P.y - V.y), d2 = norm(N.x - V.x, N.y - V.y);
  const phi = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
  if (r <= 0 || phi > Math.PI - 1e-3) return [V];
  const t = r / Math.tan(phi / 2);
  const T1 = { x: V.x + d1.x * t, y: V.y + d1.y * t }, T2 = { x: V.x + d2.x * t, y: V.y + d2.y * t };
  const bis = norm(d1.x + d2.x, d1.y + d2.y), cd = r / Math.sin(phi / 2);
  const C = { x: V.x + bis.x * cd, y: V.y + bis.y * cd };
  let a1 = Math.atan2(T1.y - C.y, T1.x - C.x), a2 = Math.atan2(T2.y - C.y, T2.x - C.x);
  let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= steps; i++) { const a = a1 + da * i / steps; pts.push({ x: C.x + Math.cos(a) * r, y: C.y + Math.sin(a) * r }); }
  return pts;
}

// ---------------------------------------------------------------- table geometry
// Pockets in order round the table (anticlockwise from above): 0 baulk-right corner (0,0),
// 1 right middle, 2 top-right corner, 3 top-left corner, 4 left middle, 5 baulk-left corner.
//
// Every corner is the same design (and every middle), placed by a rotation, so all six match:
// two rounded cushion points, jaws running back from them into a round hole cut through the bed
// and the rail. Corners have a short shelf in front of the hole; middles drop at the mouth.
// The physics uses exactly this outline.
export function buildTable(gameId) {
  const S = SPECS[gameId], { L, W, R, cw } = S;
  const pockets = [];
  const _hc = (P, d, C, r) => { // where P + t*d first meets the circle
    const fx = P.x - C.x, fy = P.y - C.y, b = fx * d.x + fy * d.y, c = fx * fx + fy * fy - r * r, disc = b * b - c;
    if (disc <= 0) return null; const t = -b - Math.sqrt(disc); return t > 0 ? { x: P.x + d.x * t, y: P.y + d.y * t } : null;
  };
  // One shared design, in the pocket's own frame: M the middle of the mouth, o straight in,
  // q across (towards the exit point). Noses at +-h, jaws run back to depth jd with slope k
  // (k < 0 tapers in, k > 0 opens out), and the hole circle passes through both jaw ends with
  // its front edge a depth s behind the mouth.
  const pocket = (kind, M, o, q, P) => {
    const m = P.mouth, h = m / 2, s = P.shelf * m, jd = P.jaw * m, k = kind === "corner" ? -Math.tan(P.taper) : Math.tan(P.spread);
    const at = (u, w) => ({ x: M.x + q.x * u + o.x * w, y: M.y + q.y * u + o.y * w });
    const xJ = h + k * jd, r = (xJ * xJ + (jd - s) * (jd - s)) / (2 * (jd - s));
    const H = at(0, s + r);
    const jawExit = norm(q.x * k + o.x, q.y * k + o.y), jawEntry = norm(-q.x * k + o.x, -q.y * k + o.y);
    return { kind, M, o, mouth: m, fall: s + 0.3 * R, knuckle: P.knuckle,
      noseExit: at(h, 0), noseEntry: at(-h, 0), jawExit, jawEntry, cutExit: at(xJ, jd), cutEntry: at(-xJ, jd),
      drop: { x: H.x, y: H.y, r } };
  };
  const corner = (K, e, f) => { // e: the rail we leave on, f: the rail we arrive on (both pointing away from K)
    const c = S.corner.mouth / Math.SQRT2, d = norm(e.x + f.x, e.y + f.y);
    const M = { x: K.x + (e.x + f.x) * c / 2, y: K.y + (e.y + f.y) * c / 2 };
    return pocket("corner", M, { x: -d.x, y: -d.y }, norm(e.x - f.x, e.y - f.y), S.corner);
  };
  const middle = (K, t, o) => pocket("middle", { ...K }, o, t, S.middle); // t: towards the exit point
  pockets.push(corner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }));
  pockets.push(middle({ x: L / 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }));
  pockets.push(corner({ x: L, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }));
  pockets.push(corner({ x: L, y: W }, { x: -1, y: 0 }, { x: 0, y: -1 }));
  pockets.push(middle({ x: L / 2, y: W }, { x: -1, y: 0 }, { x: 0, y: 1 }));
  pockets.push(corner({ x: 0, y: W }, { x: 0, y: -1 }, { x: 1, y: 0 }));
  pockets.forEach((p, i) => {
    p.id = i;
    p.endEntry = p.cutEntry; p.endExit = p.cutExit;
    p.aim = { x: p.M.x + p.o.x * p.fall * 0.3, y: p.M.y + p.o.y * p.fall * 0.3 }; // aim just inside the mouth
  });

  const arc = (c, P, Q, far) => { // round the circle from P to Q (the long way if far)
    const a = Math.atan2(P.y - c.y, P.x - c.x); let b = Math.atan2(Q.y - c.y, Q.x - c.x) - a;
    while (b > Math.PI) b -= 2 * Math.PI; while (b < -Math.PI) b += 2 * Math.PI;
    if (far) b = b > 0 ? b - 2 * Math.PI : b + 2 * Math.PI;
    const out = [], n = Math.max(2, Math.ceil(Math.abs(b) / 0.1));
    for (let i = 1; i < n; i++) { const t = a + b * i / n; out.push({ x: c.x + Math.cos(t) * c.r, y: c.y + Math.sin(t) * c.r }); }
    return out;
  };
  // Physics outline of each cushion: from the hole, along the jaw, round the point, down the rail.
  const cushions = [];
  for (let i = 0; i < 6; i++) {
    const a = pockets[i], b = pockets[(i + 1) % 6];
    const pts = [a.cutExit];
    pts.push(...fillet(a.cutExit, a.noseExit, b.noseEntry, a.knuckle, 8));
    pts.push(...fillet(a.noseExit, b.noseEntry, b.cutEntry, b.knuckle, 8));
    pts.push(b.cutEntry);
    cushions.push(pts);
  }
  // Drawing outline: the same, closed off round the hole circle to the back of the cushion.
  const backLine = [["y", -cw], ["y", -cw], ["x", L + cw], ["y", W + cw], ["y", W + cw], ["x", -cw]];
  const meet = (c, [ax, v]) => {
    const d = ax === "y" ? v - c.y : v - c.x, q = c.r * c.r - d * d; if (q <= 0) return [];
    const s = Math.sqrt(q); return ax === "y" ? [{ x: c.x - s, y: v }, { x: c.x + s, y: v }] : [{ x: v, y: c.y - s }, { x: v, y: c.y + s }];
  };
  const near = (pts, J) => pts.sort((m, n) => Math.hypot(m.x - J.x, m.y - J.y) - Math.hypot(n.x - J.x, n.y - J.y))[0];
  // kept in parts too, so the drawing knows which stretch is the nose and which the ends
  const cushionParts = cushions.map((pts, i) => {
    const a = pockets[i], b = pockets[(i + 1) % 6], line = backLine[i];
    const Ka = near(meet(a.drop, line), a.cutExit), Kb = near(meet(b.drop, line), b.cutEntry);
    return { Ka, arcA: arc(a.drop, Ka, a.cutExit), pts, arcB: arc(b.drop, b.cutEntry, Kb), Kb };
  });
  const cushionShapes = cushionParts.map(c => [c.Ka, ...c.arcA, ...c.pts, ...c.arcB, c.Kb]);
  const segs = [];
  const addSeg = (p, q) => { const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy; if (l2 > 1e-12) segs.push({ ax: p.x, ay: p.y, dx, dy, l2 }); };
  cushions.forEach(pts => { for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i], pts[i + 1]); });
  // the wall of each hole (behind the jaws) keeps a ball in until it drops
  pockets.forEach(p => {
    const c = p.drop, wall = [p.cutEntry, ...arc(c, p.cutEntry, p.cutExit, true), p.cutExit];
    // go round the back (away from the table): pick whichever way passes further from the mouth
    const alt = [p.cutEntry, ...arc(c, p.cutEntry, p.cutExit, false), p.cutExit];
    const depth = pts => pts.reduce((s, q) => s + (q.x - p.M.x) * p.o.x + (q.y - p.M.y) * p.o.y, 0) / pts.length;
    const back = depth(wall) > depth(alt) ? wall : alt;
    p.wall = back;
    for (let i = 0; i < back.length - 1; i++) addSeg(back[i], back[i + 1]);
  });
  return { id: gameId, spec: S, L, W, R, cw, pockets, cushions, cushionShapes, cushionParts, segs };
}

// ---------------------------------------------------------------- simulation
export class World {
  constructor(table) {
    this.t = table; this.balls = []; this.events = []; this.time = 0; this.firstHit = null;
  }
  setBalls(list) { // list: [{id,x,y,on}]
    this.balls = list.map(b => ({ id: b.id, x: b.x, y: b.y, on: b.on !== false, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, pocket: -1 }));
    this.byId = new Map(this.balls.map(b => [b.id, b]));
    this.events = []; this.time = 0; this.order = null;
  }
  clone() {
    const w = new World(this.t);
    w.balls = this.balls.map(b => ({ ...b })); w.byId = new Map(w.balls.map(b => [b.id, b])); w.order = null;
    w.events = []; w.time = 0; return w;
  }
  ball(id) { return this.byId.get(id); }
  // Strike the cue ball. spinX: side (+ = right), spinY: top (+) / screw (-), both -1..1.
  strike(id, angle, speed, spinX = 0, spinY = 0) {
    const b = this.ball(id), R = this.t.R, ux = Math.cos(angle), uy = Math.sin(angle);
    b.vx = ux * speed; b.vy = uy * speed;
    const k = 5 * speed / (2 * R * R), a = spinX * 0.5 * R, c = spinY * 0.5 * R;
    b.wz = k * a; b.wx = k * c * -uy; b.wy = k * c * ux;
    this.events = []; this.time = 0;
  }
  moving() { for (const b of this.balls) if (b.on && (b.vx || b.vy)) return true; return false; }

  // Advance up to dt seconds. fast=true uses coarser steps (for the computer's planning).
  advance(dt, fast = false) {
    const R = this.t.R, lim = (fast ? 0.45 : 0.22) * R;
    let left = dt;
    while (left > 1e-9) {
      let vmax = 0;
      for (const b of this.balls) if (b.on) { const s = Math.abs(b.vx) + Math.abs(b.vy); if (s > vmax) vmax = s; }
      if (vmax === 0) { this.spinDown(left); this.time += left; return false; }
      const h = Math.min(left, fast ? 1 / 60 : 1 / 240, lim / vmax);
      this.step(h); left -= h; this.time += h;
    }
    return this.moving();
  }
  runToRest(maxT = 40, fast = true) {
    while (this.time < maxT) { if (!this.advance(0.05, fast)) break; }
    for (const b of this.balls) { b.vx = b.vy = 0; b.wx = b.wy = 0; }
  }
  spinDown(dt) {
    const d = this.t.spec.mu.spin * dt;
    for (const b of this.balls) if (b.wz) b.wz = Math.abs(b.wz) <= d ? 0 : b.wz - Math.sign(b.wz) * d;
  }

  step(h) {
    this.h = h;
    const T = this.t, S = T.spec, R = T.R, mu = S.mu;
    const aS = mu.slide * G, aR = mu.roll * G, dz = mu.spin * h;
    for (const b of this.balls) {
      if (!b.on) continue;
      if (b.vx === 0 && b.vy === 0) { if (b.wz) b.wz = Math.abs(b.wz) <= dz ? 0 : b.wz - Math.sign(b.wz) * dz; continue; }
      const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx, us = hyp(ux, uy);
      if (us > 1e-3) { // sliding on the cloth
        if (3.5 * aS * h >= us) {
          b.vx -= ux * 2 / 7; b.vy -= uy * 2 / 7; b.wx = -b.vy / R; b.wy = b.vx / R;
        } else {
          const ax = -aS * ux / us, ay = -aS * uy / us;
          b.vx += ax * h; b.vy += ay * h; b.wx += 2.5 / R * ay * h; b.wy -= 2.5 / R * ax * h;
        }
      } else { // rolling
        const sp = hyp(b.vx, b.vy), ns = sp - aR * h;
        if (ns <= 0.003) { b.vx = b.vy = 0; b.wx = b.wy = 0; }
        else { b.vx *= ns / sp; b.vy *= ns / sp; b.wx = -b.vy / R; b.wy = b.vx / R; }
      }
      if (b.wz) b.wz = Math.abs(b.wz) <= dz ? 0 : b.wz - Math.sign(b.wz) * dz;
      b.x += b.vx * h; b.y += b.vy * h;
    }
    // a tight pack passes energy through several balls in one step, so repeat until nothing is still closing
    for (let it = 0; it < 8; it++) if (!this.collideBalls()) break;
    this.collideCushions();
    this.checkPockets();
  }

  collideBalls() {
    let any = false;
    const R = this.t.R, D = 2 * R, D2 = D * D, S = this.t.spec, h = this.h || 0.004, hmax = h * 1.5;
    // work through the balls in a fresh random order each pass so a packed rack spreads evenly
    const bs = this.order || (this.order = this.balls.slice());
    for (let i = bs.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0, t = bs[i]; bs[i] = bs[j]; bs[j] = t; }
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]; if (!a.on) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j]; if (!b.on) continue;
        const rvx = a.vx - b.vx, rvy = a.vy - b.vy;
        const dx = b.x - a.x, mxr = D + Math.abs(rvx) * h; if (dx > mxr || dx < -mxr) continue;
        const dy = b.y - a.y, myr = D + Math.abs(rvy) * h; if (dy > myr || dy < -myr) continue;
        const d2 = dx * dx + dy * dy; if (d2 === 0) continue;
        // rewind both balls to the instant they touched, so the contact normal is exact.
        // This also catches thin contacts the step jumped straight over.
        const dr = dx * rvx + dy * rvy, rv2 = rvx * rvx + rvy * rvy;
        let tau = 0;
        if (d2 >= D2) { // apart now: did they pass through each other during this step?
          if (dr >= 0 || rv2 < 1e-12) continue;
          const disc = dr * dr - rv2 * (d2 - D2); if (disc <= 0) continue;
          tau = (-dr + Math.sqrt(disc)) / rv2; // first touch, measured back from now
          if (!(tau > 0 && tau <= h)) continue;
          a.x -= a.vx * tau; a.y -= a.vy * tau; b.x -= b.vx * tau; b.y -= b.vy * tau;
        } else if (dr > 0 && rv2 > 1e-12) {
          tau = (-dr + Math.sqrt(Math.max(0, dr * dr - rv2 * (d2 - D2)))) / rv2;
          if (!(tau > 0 && tau < hmax)) tau = 0;
          a.x -= a.vx * tau; a.y -= a.vy * tau; b.x -= b.vx * tau; b.y -= b.vy * tau;
        }
        const ex = b.x - a.x, ey = b.y - a.y, d = Math.hypot(ex, ey) || 1e-9, nx = ex / d, ny = ey / d;
        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vn > 0) {
          const jn = vn * (1 + S.e.ball) / 2;
          a.vx -= jn * nx; a.vy -= jn * ny; b.vx += jn * nx; b.vy += jn * ny;
          // Friction between the balls. The two surfaces rub past each other in 3D: sideways from the
          // cut and any side spin, up or down from follow and screw. The rubbing "throws" the object
          // ball off line, passes on a little spin, and shares one grip between both directions.
          const wzs = a.wz + b.wz, wxs = a.wx + b.wx, wys = a.wy + b.wy;
          const sx = (a.vx - b.vx) - R * wzs * ny, sy = (a.vy - b.vy) + R * wzs * nx, sz = R * (wxs * ny - wys * nx);
          const sn = sx * nx + sy * ny, tx = sx - sn * nx, ty = sy - sn * ny, ts = Math.hypot(tx, ty, sz);
          if (ts > 1e-6) {
            const jt = Math.min(ballMu(ts) * jn, ts / 7), ux = tx / ts, uy = ty / ts, uz = sz / ts;
            a.vx -= jt * ux; a.vy -= jt * uy; b.vx += jt * ux; b.vy += jt * uy;
            const k = -2.5 / R * jt; // both balls turn the same way: k * (n x u)
            const dwx = k * ny * uz, dwy = -k * nx * uz, dwz = k * (nx * uy - ny * ux);
            a.wx += dwx; a.wy += dwy; a.wz += dwz; b.wx += dwx; b.wy += dwy; b.wz += dwz;
          }
          if (vn > 0.002) this.events.push({ t: "hit", a: a.id, b: b.id, time: this.time, v: vn });
          any = true;
        }
        if (tau) { a.x += a.vx * tau; a.y += a.vy * tau; b.x += b.vx * tau; b.y += b.vy * tau; }
        const fx = b.x - a.x, fy = b.y - a.y, fd = Math.hypot(fx, fy);
        if (fd < D) { const ov = (D - fd) / 2 + 1e-7, qx = fx / (fd || 1), qy = fy / (fd || 1); a.x -= qx * ov; a.y -= qy * ov; b.x += qx * ov; b.y += qy * ov; }
      }
    }
    return any;
  }

  collideCushions() {
    const T = this.t, R = T.R, L = T.L, W = T.W, S = T.spec, R2 = R * R, m = R * 1.05, hmax = (this.h || 0.004) * 1.5;
    const sT = S.nose, cT = Math.sqrt(1 - sT * sT);
    for (const b of this.balls) {
      if (!b.on) continue;
      if (b.x > m && b.x < L - m && b.y > m && b.y < W - m) continue;
      for (const s of T.segs) {
        let t = ((b.x - s.ax) * s.dx + (b.y - s.ay) * s.dy) / s.l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = s.ax + s.dx * t, qy = s.ay + s.dy * t, dx = b.x - qx, dy = b.y - qy, d2 = dx * dx + dy * dy;
        if (d2 >= R2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        let nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) { b.x = qx + nx * R; b.y = qy + ny * R; continue; }
        // rewind to the moment of contact and take the normal there
        let tau = Math.min(hmax, (R - d) / -vn);
        b.x -= b.vx * tau; b.y -= b.vy * tau;
        let t2 = ((b.x - s.ax) * s.dx + (b.y - s.ay) * s.dy) / s.l2; t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
        const cx = s.ax + s.dx * t2, cy = s.ay + s.dy * t2, gx = b.x - cx, gy = b.y - cy, gd = Math.hypot(gx, gy) || 1e-9;
        if (b.vx * gx + b.vy * gy < 0) { nx = gx / gd; ny = gy / gd; vn = b.vx * nx + b.vy * ny; }
        else { b.x += b.vx * tau; b.y += b.vy * tau; tau = 0; }
        // The cushion nose meets the ball above its centre. Work the bounce out at that point in 3D:
        // the push back along the line to the nose, plus the grip of the cloth against whatever
        // the ball's surface is doing there (its roll, and any side). The bed stops it being driven down.
        const c1 = -cT * nx, c2 = -cT * ny;                       // from the centre to the nose (its upward part is sT)
        const vc = b.vx * c1 + b.vy * c2;                          // closing speed along that line
        const ux = b.vx + R * (b.wy * sT - b.wz * c2), uy = b.vy + R * (b.wz * c1 - b.wx * sT), uz = R * (b.wx * c2 - b.wy * c1);
        const sx = ux - vc * c1, sy = uy - vc * c2, sz = uz - vc * sT, sl = Math.hypot(sx, sy, sz);
        const pn = (1 + S.e.cushion) * vc;
        b.vx -= pn * c1; b.vy -= pn * c2;
        if (sl > 1e-9) {
          const pt = Math.min(S.mu.cushion * pn, sl / 3.5), tx = sx / sl, ty = sy / sl, tz = sz / sl;
          b.vx -= pt * tx; b.vy -= pt * ty;
          const k = -2.5 / R * pt;
          b.wx += k * (c2 * tz - sT * ty); b.wy += k * (sT * tx - c1 * tz); b.wz += k * (c1 * ty - c2 * tx);
        }
        if (tau) { b.x += b.vx * tau; b.y += b.vy * tau; }
        // keep it out of the cushion
        let t3 = ((b.x - s.ax) * s.dx + (b.y - s.ay) * s.dy) / s.l2; t3 = t3 < 0 ? 0 : t3 > 1 ? 1 : t3;
        const kx = b.x - (s.ax + s.dx * t3), ky = b.y - (s.ay + s.dy * t3), kd = Math.hypot(kx, ky);
        if (kd < R && kd > 0) { b.x += kx / kd * (R - kd); b.y += ky / kd * (R - kd); }
        this.events.push({ t: "cush", id: b.id, time: this.time, v: -vn });
      }
    }
  }

  checkPockets() {
    const T = this.t, R = T.R, L = T.L, W = T.W;
    for (const b of this.balls) {
      if (!b.on) continue;
      if (b.x > R && b.x < L - R && b.y > R && b.y < W - R) continue;
      for (const p of T.pockets) {
        const hx = b.x - p.drop.x, hy = b.y - p.drop.y;
        if (hx * hx + hy * hy >= p.drop.r * p.drop.r) continue; // not over the hole yet
        b.on = false; b.pocket = p.id;
        b.potV = { x: b.vx, y: b.vy };
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        this.events.push({ t: "pot", id: b.id, pocket: p.id, time: this.time });
        break;
      }
    }
  }
}

// Summarise a finished shot for the rules.
export function summarise(events, cueId = 0) {
  let first = null, firstTime = Infinity, cushAfter = false;
  const pots = [], potPockets = {};
  for (const e of events) {
    if (e.t === "hit" && first === null && (e.a === cueId || e.b === cueId)) { first = e.a === cueId ? e.b : e.a; firstTime = e.time; }
  }
  for (const e of events) {
    if (e.t === "cush" && e.time >= firstTime) cushAfter = true;
    if (e.t === "pot") { pots.push(e.id); potPockets[e.id] = e.pocket; }
  }
  return { first, pots, potPockets, cushionAfterHit: cushAfter };
}

// Where would the cue ball, sent along `angle`, first touch something?
export function castFirst(table, balls, cueId, angle) {
  const cue = balls.find(b => b.id === cueId), R = table.R, ux = Math.cos(angle), uy = Math.sin(angle);
  let best = { t: Infinity, ball: null };
  for (const b of balls) {
    if (!b.on || b.id === cueId) continue;
    const fx = b.x - cue.x, fy = b.y - cue.y, along = fx * ux + fy * uy;
    if (along <= 0) continue;
    const perp2 = fx * fx + fy * fy - along * along, D2 = 4 * R * R;
    if (perp2 >= D2) continue;
    const t = along - Math.sqrt(D2 - perp2);
    if (t < best.t) best = { t, ball: b };
  }
  // cushions: find where the ball centre comes within R of a cushion segment (march along the ray)
  let tc = Infinity;
  const L = table.L, W = table.W;
  const tx = ux > 0 ? (L - R - cue.x) / ux : ux < 0 ? (R - cue.x) / ux : Infinity;
  const ty = uy > 0 ? (W - R - cue.y) / uy : uy < 0 ? (R - cue.y) / uy : Infinity;
  tc = Math.max(0, Math.min(tx, ty));
  if (tc < best.t) {
    const px = cue.x + ux * tc, py = cue.y + uy * tc;
    return { t: tc, ball: null, x: px, y: py };
  }
  const gx = cue.x + ux * best.t, gy = cue.y + uy * best.t;
  return { t: best.t, ball: best.ball, x: gx, y: gy };
}
