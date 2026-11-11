// The table itself, built from the same outline the physics uses.
// Physics (x, y) on the bed maps to three.js (x, height, -y).
import { marks } from "./rules.js";
import { C, canvasTex, clothTex, clothNormal, woodTex, radialTex } from "./tex.js";

const THREE = window.THREE;
const V3 = (x, h, y) => new THREE.Vector3(x, h, -y);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

function signedArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; }
function arcPts(c, r, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; o.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r }); } return o; }

// A mesh from stacked rings of points (each ring the same closed outline at a different height/offset)
// with a flat-ish cap over the last ring. Shared corners, so the shading rolls smoothly round the edges.
function ringMesh(rings, uvS, mat) {
  const N = rings[0].length, pos = [], uv = [], idx = [];
  rings.forEach(r => r.forEach(p => { pos.push(p.x, p.h, -p.y); uv.push(p.x * uvS, p.y * uvS); }));
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, a = k * N + i, b = k * N + j, c = (k + 1) * N + j, d = (k + 1) * N + i;
    idx.push(a, b, c, a, c, d);
  }
  const top = rings[rings.length - 1], base = (rings.length - 1) * N;
  const tris = THREE.ShapeUtils.triangulateShape(top.map(p => new THREE.Vector2(p.x, p.y)), []);
  tris.forEach(([a, b, c]) => {
    const A = top[a], B = top[b], C = top[c], ccw = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0;
    ccw ? idx.push(base + a, base + b, base + c) : idx.push(base + a, base + c, base + b);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// One cushion: the rubber nose stands proud above the ball's middle, undercut beneath, and the
// cloth runs up from the nose to meet the wooden rail.
function cushionMesh(part, R, nose, ch, rh, mat) {
  let out = [part.Ka, ...part.arcA, ...part.pts, ...part.arcB, part.Kb];
  const nA = 1 + part.arcA.length, nP = part.pts.length, N = out.length;
  const w = new Array(N).fill(0), top = new Array(N).fill(rh);
  const cum = [0]; for (let i = 1; i < nP; i++) cum[i] = cum[i - 1] + Math.hypot(part.pts[i].x - part.pts[i - 1].x, part.pts[i].y - part.pts[i - 1].y);
  const tot = cum[nP - 1], ramp = 0.03;
  for (let i = 0; i < nP; i++) { w[nA + i] = smooth(Math.min(cum[i], tot - cum[i]) / ramp); top[nA + i] = ch; }
  for (let i = 1; i < nA; i++) top[i] = lerp(rh, ch, i / nA);
  const nB = part.arcB.length; for (let k = 0; k < nB; k++) top[nA + nP + k] = lerp(ch, rh, (k + 1) / (nB + 1));
  let pts = out.map((p, i) => ({ x: p.x, y: p.y, w: w[i], top: top[i] }));
  if (signedArea(pts) < 0) pts.reverse();
  // inward direction at each corner
  const n = pts.map((p, i) => {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    let nx = -(b.y - a.y), ny = b.x - a.x; const l = Math.hypot(nx, ny) || 1; return { x: nx / l, y: ny / l };
  });
  const out0 = R * (1 - Math.sqrt(1 - nose * nose)); // the nose overhangs the line the ball's centre keeps to
  const ring = (off, h) => pts.map((p, i) => { const o = off(p); return { x: p.x + n[i].x * o, y: p.y + n[i].y * o, h: h(p) }; });
  const rings = [
    ring(p => ch * 0.55 * p.w, () => -0.002),
    ring(p => ch * 0.3 * p.w, p => p.top * 0.45),
    ring(p => -out0 * p.w, p => p.top - 0.0065),
    ring(p => -out0 * p.w + 0.0012, p => p.top - 0.0018),
    ring(p => -out0 * p.w + 0.0055, p => p.top),
  ];
  const m = ringMesh(rings, 14, mat); m.castShadow = m.receiveShadow = true; return m;
}

// The leather/plastic pocket liner: a rim on the rail that drops away into the hole, from the back
// of one cushion round to the other. Identical at every pocket of the same kind.
function linerGeo(p, cut, T, rh) {
  const { L, W, cw } = T, H = p.drop, r = H.r, a0 = Math.atan2(p.o.y, p.o.x);
  const tLine = (ex, ey) => { // how far out from the hole's centre, at least its radius, until we're under the rail
    const sx = H.x + ex * r, sy = H.y + ey * r;
    if (sx < -cw || sx > L + cw || sy < -cw || sy > W + cw) return r;
    let t = Infinity;
    if (ex < 0) t = Math.min(t, (-cw - sx) / ex); if (ex > 0) t = Math.min(t, (L + cw - sx) / ex);
    if (ey < 0) t = Math.min(t, (-cw - sy) / ey); if (ey > 0) t = Math.min(t, (W + cw - sy) / ey);
    return r + t;
  };
  const tCut = (ex, ey) => { const fx = H.x - cut.x, fy = H.y - cut.y, b = fx * ex + fy * ey, c = fx * fx + fy * fy - cut.r * cut.r; return -b + Math.sqrt(Math.max(0, b * b - c)); };
  const ok = a => { const ex = Math.cos(a), ey = Math.sin(a); return tCut(ex, ey) > tLine(ex, ey) + 0.0008; };
  let lo = 0, hi = 0; const step = Math.PI / 360;
  while (lo > -Math.PI && ok(a0 + lo - step)) lo -= step;
  while (hi < Math.PI && ok(a0 + hi + step)) hi += step;
  const nPhi = 84, rows = 8, pos = [], idx = [];
  for (let i = 0; i <= nPhi; i++) {
    const a = a0 + lo + (hi - lo) * i / nPhi, ex = Math.cos(a), ey = Math.sin(a);
    const tl = tLine(ex, ey), tc = tCut(ex, ey), flat = smooth((tl - r) / 0.004), ri = tl, hin = flat * rh;
    const wd = Math.max(0, tc - ri), lip = Math.min(1, wd / 0.012); // the rim thins out to nothing at its ends
    const prof = [
      [tc + 0.007 * lip, rh + 0.0003], [tc + 0.004 * lip, rh + 0.0042 * lip], [tc - 0.001 * lip, rh + 0.0052 * lip], [tc - 0.006 * lip, rh + 0.0025 * lip],
      [lerp(ri, tc, 0.5), lerp(hin, rh, 0.55) - 0.004 * lip], [ri + 0.0015, hin - 0.004 * (1 - flat)], [ri, hin - 0.03 * (1 - flat) - 0.001], [ri - 0.004 * (1 - flat), hin - 0.11 * (1 - flat) - 0.002],
    ];
    prof.forEach(([t, h]) => pos.push(H.x + ex * t, h, -(H.y + ey * t)));
  }
  for (let i = 0; i < nPhi; i++) for (let k = 0; k < rows - 1; k++) {
    const a = i * rows + k, b = (i + 1) * rows + k, c = (i + 1) * rows + k + 1, d = i * rows + k + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// One wooden rail, drawn lying along +x from corner pocket to corner pocket (the grain runs with it).
function railShape(len, T, cutC, cutM, ox, rr) {
  const { cw } = T, s = new THREE.Shape();
  const a = -cutC.x, rc = cutC.r; // corner cut: centre (-a, -a) at this end, (len + a, -a) at the far end
  const dC = Math.sqrt(Math.max(0, rc * rc - (cw - a) * (cw - a)));
  const P = [];
  // outer edge, rounded at both ends, mitred on the diagonal
  P.push(...arcPts({ x: -ox + rr, y: -ox + rr }, rr, -Math.PI * 0.75, -Math.PI / 2, 5));
  P.push(...arcPts({ x: len + ox - rr, y: -ox + rr }, rr, -Math.PI / 2, -Math.PI / 4, 5));
  // far corner pocket: from the diagonal round to the back of the cushion
  P.push(...arcPts({ x: len + a, y: -a }, rc, -Math.PI / 4, Math.atan2(-(cw - a), -dC), 14));
  if (cutM) { // middle pocket
    const dy = -cw - cutM.y, dM = Math.sqrt(Math.max(0, cutM.r * cutM.r - dy * dy));
    const aR = Math.atan2(dy, dM), aL = Math.atan2(dy, -dM);
    P.push(...arcPts({ x: len / 2, y: cutM.y }, cutM.r, aR, aL - (aL > aR ? 2 * Math.PI : 0), 22));
  }
  // near corner pocket
  P.push(...arcPts({ x: -a, y: -a }, rc, Math.atan2(-(cw - a), dC), -Math.PI * 0.75, 14));
  P.forEach((p, i) => i ? s.lineTo(p.x, p.y) : s.moveTo(p.x, p.y)); s.closePath();
  return s;
}

export function buildTable3D(G, table, game, st, quality) {
  const { L, W, R, cw } = table, nose = table.spec.nose, rw = st.railWidth, ox = cw + rw;
  const ch = R * (1 + nose) + 0.0065, rh = ch + 0.009;
  const P = table.pockets;

  // ---- cloth bed with the six drops cut out of the slate
  const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(st.cloth, [L * 2.2, W * 2.2]), roughness: 0.96, metalness: 0, envMapIntensity: 0.06, normalMap: clothNormal([L * 11, W * 11]), normalScale: new THREE.Vector2(0.22, 0.22) });
  const bx = cw + 0.004, bi = cw + 0.002;
  const bed = new THREE.Shape(); bed.moveTo(-bx, -bx); bed.lineTo(L + bx, -bx); bed.lineTo(L + bx, W + bx); bed.lineTo(-bx, W + bx); bed.closePath();
  const trim = pts => { const o = []; pts.forEach(q => { const t = { x: Math.min(L + bi, Math.max(-bi, q.x)), y: Math.min(W + bi, Math.max(-bi, q.y)) }; const l = o[o.length - 1]; if (!l || Math.hypot(l.x - t.x, l.y - t.y) > 1e-5) o.push(t); }); if (o.length > 1 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) < 1e-5) o.pop(); return o; };
  P.forEach(p => {
    const pts = trim(arcPts(p.drop, p.drop.r, 0, Math.PI * 2, 56).slice(0, -1)), h = new THREE.Path();
    pts.forEach((q, i) => i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y)); h.closePath(); bed.holes.push(h);
  });
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(bed, 8), clothMat); cloth.rotation.x = -Math.PI / 2; cloth.receiveShadow = true; G.add(cloth);

  // soft shading round each drop
  const ao = radialTex([[0, "rgba(0,0,0,.75)"], [0.62, "rgba(0,0,0,.55)"], [0.8, "rgba(0,0,0,.18)"], [1, "rgba(0,0,0,0)"]]);
  const aoMat = new THREE.MeshBasicMaterial({ map: ao, transparent: true, depthWrite: false });
  P.forEach(p => { const s = (p.drop.r + 0.03) * 2, m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), aoMat); m.rotation.x = -Math.PI / 2; m.position.copy(V3(p.drop.x, 0.0011, p.drop.y)); m.renderOrder = 1; G.add(m); });

  // ---- markings
  const markMat = new THREE.MeshBasicMaterial({ color: C(0xf2f2ea), transparent: true, opacity: 0.42, depthWrite: false });
  const mk = marks(game);
  const lineAt = x => { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.0022, W), markMat); l.rotation.x = -Math.PI / 2; l.position.copy(V3(x, 0.0014, W / 2)); l.renderOrder = 2; G.add(l); };
  const spot = (x, y, r = 0.0035, c = 0x10140f, op = 0.8) => { const s = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false })); s.rotation.x = -Math.PI / 2; s.position.copy(V3(x, 0.0015, y)); s.renderOrder = 2; G.add(s); };
  if (game === "snooker") {
    lineAt(mk.baulk);
    const d = new THREE.Mesh(new THREE.RingGeometry(mk.D.r - 0.0011, mk.D.r + 0.0011, 96, 1, Math.PI / 2, Math.PI), markMat);
    d.rotation.x = -Math.PI / 2; d.position.copy(V3(mk.D.x, 0.0014, mk.D.y)); d.renderOrder = 2; G.add(d);
    Object.values(mk.spots).forEach(p => spot(p.x, p.y));
  } else {
    if (game === "uk") lineAt(mk.baulk);
    spot(mk.foot.x, mk.foot.y, 0.006, 0xf2f2ea, 0.6); spot(L * 0.25, W / 2, 0.006, 0xf2f2ea, 0.6);
  }

  // ---- cushions
  const cushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(new THREE.Color(st.cloth).multiplyScalar(0.93).getHex(), [1, 1]), roughness: 0.95, envMapIntensity: 0.06 });
  table.cushionParts.forEach(part => G.add(cushionMesh(part, R, nose, ch, rh, cushMat)));

  // ---- pockets: where each rail is cut away, the liner, the fall of the slate and the bucket below
  const cornerCut = (() => { const p = P[0], d = 0.012, c = { x: p.drop.x + p.o.x * d, y: p.drop.y + p.o.y * d }; return { ...c, r: Math.max(p.drop.r + 0.014, Math.hypot(-cw - c.x, -cw - c.y) + 0.01) }; })();
  const middleCut = (() => { const p = P[1], d = 0.005; return { x: 0, y: p.drop.y + p.o.y * d, r: p.drop.r + 0.011 }; })(); // y relative to the rail's own back line
  const cutFor = p => {
    if (p.kind === "middle") return { x: p.drop.x + p.o.x * 0.005, y: p.drop.y + p.o.y * 0.005, r: middleCut.r };
    const d = Math.hypot(cornerCut.x - P[0].drop.x, cornerCut.y - P[0].drop.y); return { x: p.drop.x + p.o.x * d, y: p.drop.y + p.o.y * d, r: cornerCut.r };
  };
  const linerMat = new THREE.MeshStandardMaterial({ color: C(st.liner), roughness: st.linerRough, metalness: 0, envMapIntensity: 0.1, side: THREE.DoubleSide });
  const fallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(new THREE.Color(st.cloth).multiplyScalar(0.55).getHex(), [1, 1]), roughness: 1, envMapIntensity: 0, side: THREE.DoubleSide });
  const darkMat = new THREE.MeshBasicMaterial({ color: C(0x020202), side: THREE.DoubleSide });
  P.forEach(p => {
    const c = V3(p.drop.x, 0, p.drop.y), hr = p.drop.r;
    const lm = new THREE.Mesh(linerGeo(p, cutFor(p), table, rh), linerMat); lm.castShadow = true; lm.receiveShadow = true; G.add(lm);
    const fall = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr - 0.001, 0.022, 48, 1, true), fallMat); fall.position.set(c.x, -0.011, c.z); G.add(fall);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(hr - 0.001, hr * 0.8, 0.26, 32, 1, true), darkMat); tube.position.set(c.x, -0.152, c.z); G.add(tube);
    const bot = new THREE.Mesh(new THREE.CircleGeometry(hr * 0.8, 24), darkMat); bot.rotation.x = -Math.PI / 2; bot.position.set(c.x, -0.28, c.z); G.add(bot);
  });

  // ---- rails
  const grain = woodTex(st.wood, { figure: st.figure, rep: [1.15, 7] });
  const woodMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: grain, roughness: st.railRough, metalness: 0, clearcoat: st.lacquer, clearcoatRoughness: 0.3, envMapIntensity: 0.24 });
  const rr = 0.045, bev = 0.007;
  const rail = (ox0, oy0, ang, len, mid) => {
    const sh = railShape(len, table, cornerCut, mid ? { y: middleCut.y - 0, r: middleCut.r } : null, ox, rr);
    const g = new THREE.ExtrudeGeometry(sh, { depth: rh + 0.034 - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 4, curveSegments: 8 });
    const m = new THREE.Mesh(g, woodMat); m.rotation.x = -Math.PI / 2; m.position.y = bev - 0.034; m.castShadow = m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m); grp.position.copy(V3(ox0, 0, oy0)); grp.rotation.y = ang; G.add(grp);
  };
  rail(0, 0, 0, L, true); rail(L, 0, Math.PI / 2, W, false); rail(L, W, Math.PI, L, true); rail(0, W, Math.PI * 1.5, W, false);
  if (st.diamonds) { // sights inlaid in the rails
    const dm = new THREE.MeshStandardMaterial({ color: C(0xf1ede0), roughness: 0.25, metalness: 0.1, envMapIntensity: 0.8 });
    const put = (x, y) => { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0062, 20), dm); d.rotation.x = -Math.PI / 2; d.position.copy(V3(x, rh + 0.0003, y)); G.add(d); };
    for (let i = 1; i < 8; i++) if (i !== 4) { put(L * i / 8, -cw - rw * 0.5); put(L * i / 8, W + cw + rw * 0.5); }
    for (let i = 1; i < 4; i++) { put(-cw - rw * 0.5, W * i / 4); put(L + cw + rw * 0.5, W * i / 4); }
  }

  // ---- the frame and legs
  const bodyTex = woodTex(new THREE.Color(st.wood).multiplyScalar(0.8).getHex(), { figure: st.figure * 0.6, rep: [0.7, 1.1] });
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: bodyTex, roughness: Math.min(0.7, st.railRough + 0.12), clearcoat: st.lacquer * 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.4 });
  const floorY = -0.84, add = (geo, x, h, y, mat = bodyMat) => { const m = new THREE.Mesh(geo, mat); m.position.copy(V3(x, h, y)); m.castShadow = m.receiveShadow = true; G.add(m); return m; };
  const fw = L + 2 * ox, fd = W + 2 * ox;
  if (st.body === "cabinet") { // a pub table: one deep cabinet on four stubby feet
    add(new THREE.BoxGeometry(fw - 0.012, 0.28, fd - 0.012), L / 2, -0.17, W / 2);
    add(new THREE.BoxGeometry(fw - 0.1, 0.2, fd - 0.1), L / 2, -0.4, W / 2);
    const metal = new THREE.MeshStandardMaterial({ color: C(0x9a9da3), roughness: 0.35, metalness: 0.9, envMapIntensity: 0.9 });
    add(new THREE.BoxGeometry(0.2, 0.11, 0.012), L * 0.72, -0.16, -ox + 0.004, metal); // coin slot
    add(new THREE.BoxGeometry(0.34, 0.1, 0.012), L * 0.2, -0.2, -ox + 0.004, new THREE.MeshBasicMaterial({ color: C(0x050505) })); // ball return
    [[0.16, 0.14], [L - 0.16, 0.14], [0.16, W - 0.14], [L - 0.16, W - 0.14]].forEach(([x, y]) => add(new THREE.BoxGeometry(0.13, 0.36, 0.13), x, floorY + 0.18, y));
  } else {
    const deep = st.body === "snooker" ? 0.2 : 0.16;
    add(new THREE.BoxGeometry(fw - 0.014, deep, fd - 0.014), L / 2, -0.03 - deep / 2, W / 2);
    add(new THREE.BoxGeometry(fw - 0.09, 0.05, fd - 0.09), L / 2, -deep - 0.054, W / 2);
    if (st.body === "snooker") { // eight turned legs
      const prof = [[0.05, 0], [0.068, 0.015], [0.068, 0.05], [0.045, 0.075], [0.04, 0.14], [0.056, 0.22], [0.066, 0.34], [0.06, 0.44], [0.046, 0.5], [0.07, 0.53], [0.075, 0.6]];
      const hgt = -floorY - deep - 0.05, lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y / 0.6 * hgt)), 24);
      const xs = [0.14, L * 0.36, L * 0.64, L - 0.14];
      xs.forEach(x => [0.11, W - 0.11].forEach(y => add(lg, x, floorY, y)));
    } else { // two slab pedestals
      const hgt = -floorY - deep - 0.05;
      [L * 0.2, L * 0.8].forEach(x => { add(new THREE.BoxGeometry(0.34, hgt, W * 0.62), x, floorY + hgt / 2, W / 2); add(new THREE.BoxGeometry(0.44, 0.05, W * 0.74), x, floorY + 0.025, W / 2); });
    }
  }
  void quality;
  return { ch, rh };
}
