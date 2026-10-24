// 3D view. Physics (x, y) on the table maps to three.js (x, height, -y).
import { def } from "./rules.js";
import { marks } from "./rules.js";

const THREE = window.THREE;
const V3 = (x, h, y) => new THREE.Vector3(x, h, -y);

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, rep) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
const hex = c => "#" + new THREE.Color(c).getHexString();
function clothTex(color, rep) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - .5) * 9; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
    g.globalAlpha = .045; g.strokeStyle = "#fff";
    for (let y = 0; y < h; y += 2) { g.beginPath(); g.moveTo(0, y + Math.random()); g.lineTo(w, y + Math.random()); g.stroke(); }
  }, rep);
}
function woodTex(color) {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * h, a = .04 + Math.random() * .08, dark = Math.random() < .6;
      g.strokeStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,220,180,${a * .6})`; g.lineWidth = .5 + Math.random() * 2;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / 70 + i) * 2.5 + Math.sin(x / 19 + i * 3) * .8);
      g.stroke();
    }
  }, [3, 1]);
}
function ballTex(game, d) {
  return canvasTex(1024, 512, (g, w, h) => {
    const col = d.color;
    const stripe = d.kind === "stripe";
    g.fillStyle = stripe || d.kind === "cue" ? "#f7f4ea" : col; g.fillRect(0, 0, w, h);
    if (stripe) { g.fillStyle = col; g.fillRect(0, h * 0.27, w, h * 0.46); }
    if (d.kind === "cue") { // spots so you can see the spin
      g.fillStyle = "#c42a2a";
      const dot = (u, v, r) => { g.beginPath(); g.ellipse(u * w, v * h, r / Math.max(.3, Math.sin(v * Math.PI)), r, 0, 0, 7); g.fill(); };
      [0, .25, .5, .75].forEach(u => dot(u + .125, .5, 13));
      dot(.0, .16, 13); dot(.5, .84, 13);
    }
    if (d.num) {
      [.25, .75].forEach(u => {
        g.fillStyle = "#f7f4ea"; g.beginPath(); g.ellipse(u * w, h / 2, 58, 58, 0, 0, 7); g.fill();
        g.fillStyle = "#151515"; g.font = `bold ${d.num > 9 ? 56 : 66}px Arial, Helvetica, sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(d.num), u * w, h / 2 + 4);
        if (d.num === 6 || d.num === 9) { g.fillRect(u * w - 16, h / 2 + 36, 32, 5); }
      });
    }
  });
}

// ---------------------------------------------------------------- the view
export class View {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    host.prepend(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090a);
    this.scene.fog = new THREE.Fog(0x07090a, 6, 15);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.02, 40);
    this.cam = { pos: null, look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), mode: "" };
    this.ray = new THREE.Raycaster();
    this.buildEnv();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  buildEnv() { // reflections for the lacquered balls
    const es = new THREE.Scene(); es.background = new THREE.Color(0x0a0c0c);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshBasicMaterial({ color: 0xfff4e2 })); p.rotation.x = Math.PI / 2; p.position.y = 2.2; es.add(p);
    const red = new THREE.Mesh(new THREE.PlaneGeometry(20, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2a2a })); red.position.set(0, 0.1, -6); es.add(red);
    const red2 = red.clone(); red2.position.set(0, 0.1, 6); red2.rotation.y = Math.PI; es.add(red2);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x0f1d16 })); f.rotation.x = -Math.PI / 2; f.position.y = -1; es.add(f);
    const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromScene(es, 0.03).texture; pm.dispose();
  }

  // -------------------------------------------------------------- table
  build(table, game, style) {
    if (this.group) { this.scene.remove(this.group); this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const G = this.group = new THREE.Group(); this.scene.add(G);
    this.table = table; this.game = game;
    const { L, W, R, cw } = table, rw = style.railWidth, ch = R * 1.4, rh = ch + 0.006;
    this.rh = rh;
    const st = style;

    // lights
    G.add(new THREE.HemisphereLight(0xfff3dd, 0x0a0d0b, 0.22));
    const sun = new THREE.DirectionalLight(0xfff1d6, 0.6); sun.position.set(L / 2 + 0.2, 3, -W / 2 - 0.3); sun.target.position.set(L / 2, 0, -W / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.003; sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -L / 2 - 0.4, right: L / 2 + 0.4, top: W / 2 + 0.4, bottom: -W / 2 - 0.4, near: 1.5, far: 4.5 });
    G.add(sun, sun.target);
    const nSpots = L > 3 ? 4 : L > 2 ? 3 : 2;
    for (let i = 0; i < nSpots; i++) {
      const f = (i + 0.5) / nSpots, s = new THREE.SpotLight(0xfff0d2, 0.5, 5, Math.PI / 3, 0.75, 1.4);
      s.position.copy(V3(L * f, 1.05, W / 2)); s.target.position.copy(V3(L * f, 0, W / 2)); G.add(s, s.target);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 0.08, W * 0.62), new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: .4, metalness: .5 }));
    canopy.position.copy(V3(L / 2, 1.16, W / 2)); G.add(canopy);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.86, W * 0.56), new THREE.MeshBasicMaterial({ color: 0xfff3df }));
    glow.rotation.x = Math.PI / 2; glow.position.copy(V3(L / 2, 1.118, W / 2)); G.add(glow);
    this.canopy = [canopy, glow];

    // cloth with the pocket drops cut out
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(st.cloth, [L * 6, W * 6]), roughness: .92, envMapIntensity: .1 });
    const bed = new THREE.Shape(); bed.moveTo(-cw, -cw); bed.lineTo(L + cw, -cw); bed.lineTo(L + cw, W + cw); bed.lineTo(-cw, W + cw); bed.closePath();
    table.pockets.forEach(p => { const h = new THREE.Path(); h.absarc(p.drop.x, p.drop.y, p.drop.r, 0, Math.PI * 2, true); bed.holes.push(h); });
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(bed, 48), clothMat); cloth.rotation.x = -Math.PI / 2; cloth.receiveShadow = true; G.add(cloth);
    // soft shading along the cushions and round the drops
    const ao = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(0,0,0,.7)"); gr.addColorStop(.6, "rgba(0,0,0,.5)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const aoMat = new THREE.MeshBasicMaterial({ map: ao, transparent: true, depthWrite: false });
    table.pockets.forEach(p => { const m = new THREE.Mesh(new THREE.PlaneGeometry((p.drop.r + 0.035) * 2, (p.drop.r + 0.035) * 2), aoMat); m.rotation.x = -Math.PI / 2; m.position.copy(V3(p.drop.x, 0.0012, p.drop.y)); G.add(m); });
    const edge = canvasTex(4, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(0,0,0,.45)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const edgeMat = new THREE.MeshBasicMaterial({ map: edge, transparent: true, depthWrite: false });
    [[L / 2, 0, L, 0], [L / 2, W, L, Math.PI], [0, W / 2, W, -Math.PI / 2], [L, W / 2, W, Math.PI / 2]].forEach(([x, y, ln, rz]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ln, 0.035), edgeMat); m.rotation.set(-Math.PI / 2, 0, rz);
      const o = 0.0175; m.position.copy(V3(x + (rz === -Math.PI / 2 ? o : rz === Math.PI / 2 ? -o : 0), 0.001, y + (rz === 0 ? o : rz === Math.PI ? -o : 0)));
      G.add(m);
    });

    // markings
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5 });
    const m = marks(game);
    const lineAt = x => { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.0025, W), markMat); l.rotation.x = -Math.PI / 2; l.position.copy(V3(x, 0.0012, W / 2)); G.add(l); };
    const spot = (x, y, r = 0.004, c = 0x111111) => { const s = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({ color: c })); s.rotation.x = -Math.PI / 2; s.position.copy(V3(x, 0.0013, y)); G.add(s); };
    if (game === "snooker") {
      lineAt(m.baulk);
      const d = new THREE.Mesh(new THREE.RingGeometry(m.D.r - 0.00125, m.D.r + 0.00125, 72, 1, Math.PI / 2, Math.PI), markMat);
      d.rotation.x = -Math.PI / 2; d.position.copy(V3(m.D.x, 0.0012, m.D.y)); G.add(d);
      Object.values(m.spots).forEach(p => spot(p.x, p.y));
    } else {
      if (game === "uk") lineAt(m.baulk);
      spot(m.foot.x, m.foot.y, 0.007, 0xeeeeee); spot(L * 0.25, W / 2, 0.007, 0xeeeeee);
    }

    // cushions, built from the same outline the physics uses
    const cushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(new THREE.Color(st.cloth).multiplyScalar(.9).getHex(), [6, 6]), roughness: .9, envMapIntensity: .1 });
    table.cushions.forEach(pts => {
      const sh = new THREE.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p.x, p.y) : sh.moveTo(p.x, p.y)); sh.closePath();
      const bev = 0.006;
      const g = new THREE.ExtrudeGeometry(sh, { depth: ch - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 4, curveSegments: 24 });
      const mm = new THREE.Mesh(g, cushMat); mm.rotation.x = -Math.PI / 2; mm.position.y = bev; mm.castShadow = mm.receiveShadow = true; G.add(mm);
    });

    // wooden rails, cut round each pocket drop
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(st.wood), roughness: st.railRough, metalness: .05, envMapIntensity: .28 });
    const ox = cw + rw, rr = 0.06;
    const outer = new THREE.Shape();
    outer.moveTo(-ox + rr, -ox); outer.lineTo(L + ox - rr, -ox); outer.quadraticCurveTo(L + ox, -ox, L + ox, -ox + rr);
    outer.lineTo(L + ox, W + ox - rr); outer.quadraticCurveTo(L + ox, W + ox, L + ox - rr, W + ox);
    outer.lineTo(-ox + rr, W + ox); outer.quadraticCurveTo(-ox, W + ox, -ox, W + ox - rr); outer.lineTo(-ox, -ox + rr); outer.quadraticCurveTo(-ox, -ox, -ox + rr, -ox);
    outer.holes.push(this.innerOutline(table));
    const bevR = 0.008;
    const rg = new THREE.ExtrudeGeometry(outer, { depth: rh - bevR * 2, bevelEnabled: true, bevelThickness: bevR, bevelSize: bevR, bevelOffset: -bevR, bevelSegments: 4, curveSegments: 40 });
    const rail = new THREE.Mesh(rg, woodMat); rail.rotation.x = -Math.PI / 2; rail.position.y = bevR; rail.castShadow = rail.receiveShadow = true; G.add(rail);
    const apronMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(new THREE.Color(st.wood).multiplyScalar(.75).getHex()), roughness: .5 });
    const apron = new THREE.Mesh(new THREE.BoxGeometry(L + 2 * ox - 0.01, 0.24, W + 2 * ox - 0.01), apronMat); apron.position.copy(V3(L / 2, -0.122, W / 2)); G.add(apron);
    const legs = L > 3 ? [[0.2, 0.15], [L / 2, 0.15], [L - 0.2, 0.15], [0.2, W - 0.15], [L / 2, W - 0.15], [L - 0.2, W - 0.15]] : [[0.15, 0.12], [L - 0.15, 0.12], [0.15, W - 0.12], [L - 0.15, W - 0.12]];
    legs.forEach(([x, y]) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.6, 18), apronMat); g.position.copy(V3(x, -0.54, y)); G.add(g); });
    if (st.diamonds) {
      const dm = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: .25, metalness: .3 });
      const put = (x, y) => { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 4), dm); d.rotation.set(-Math.PI / 2, 0, Math.PI / 4); d.position.copy(V3(x, rh + 0.0002, y)); G.add(d); };
      for (let i = 1; i < 8; i++) if (i !== 4) { put(L * i / 8, -cw - rw * 0.5); put(L * i / 8, W + cw + rw * 0.5); }
      for (let i = 1; i < 4; i++) { put(-cw - rw * 0.5, W * i / 4); put(L + cw + rw * 0.5, W * i / 4); }
    }

    // pocket drops: a cloth fall, a dark liner, and the plate round the back
    const linerMat = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 1, envMapIntensity: 0, side: THREE.DoubleSide });
    const fallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(new THREE.Color(st.cloth).multiplyScalar(.5).getHex()), roughness: .95, envMapIntensity: 0, side: THREE.DoubleSide });
    const plateMat = new THREE.MeshStandardMaterial({ color: st.plate, roughness: st.plateRough, metalness: st.plateMetal, envMapIntensity: .7 });
    const netMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1, side: THREE.DoubleSide });
    table.pockets.forEach(p => {
      const c = V3(p.drop.x, 0, p.drop.y), hr = p.drop.r;
      const fall = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr * 0.74, 0.04, 40, 1, true), fallMat); fall.position.set(c.x, -0.02, c.z); G.add(fall);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(hr * 0.74, hr * 0.68, 0.2, 32, 1, true), netMat); tube.position.set(c.x, -0.14, c.z); G.add(tube);
      const bot = new THREE.Mesh(new THREE.CircleGeometry(hr * 0.68, 32), new THREE.MeshBasicMaterial({ color: 0x030303 })); bot.rotation.x = -Math.PI / 2; bot.position.set(c.x, -0.235, c.z); G.add(bot);
      // only the part of the rim that runs through the wooden rail (not across the mouth)
      const N = 360, out = [];
      for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, x = p.drop.x + Math.cos(a) * (hr + 0.004), y = p.drop.y + Math.sin(a) * (hr + 0.004); out.push(x < -cw || x > L + cw || y < -cw || y > W + cw); }
      let s0 = out.findIndex((o, i) => o && !out[(i + N - 1) % N]); if (s0 < 0) s0 = 0;
      let n = 0; while (n < N && out[(s0 + n) % N]) n++;
      const a0 = s0 / N * Math.PI * 2, span = n / N * Math.PI * 2;
      // CylinderGeometry measures its angle from +z towards +x; physics angle a sits at (cos a, -sin a) in x,z
      const th0 = Math.PI / 2 + a0;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, rh, 48, 1, true, th0, span), linerMat); wall.position.set(c.x, rh / 2, c.z); G.add(wall);
      const plate = new THREE.Mesh(new THREE.TorusGeometry(hr + 0.008, 0.011, 12, 48, span), plateMat);
      plate.rotation.set(-Math.PI / 2, 0, a0); plate.scale.z = 0.4; plate.position.set(c.x, rh + 0.001, c.z); plate.castShadow = true; G.add(plate);
    });

    this.buildArena(L, W, st);
    this.buildBalls(game);
    this.buildCue();
    this.buildGuides();
  }

  innerOutline(table) {
    const { L, W, cw } = table, H = table.pockets.map(p => ({ x: p.drop.x, y: p.drop.y, r: p.drop.r + 0.004 }));
    const cx = L / 2, cy = W / 2, path = new THREE.Path();
    const hit = (c, axis, val) => { const d = axis === "y" ? val - c.y : val - c.x, s = Math.sqrt(Math.max(0, c.r * c.r - d * d)); return axis === "y" ? [[c.x - s, val], [c.x + s, val]] : [[val, c.y - s], [val, c.y + s]]; };
    const around = (c, from, to) => {
      const a = Math.atan2(from[1] - c.y, from[0] - c.x), b0 = Math.atan2(to[1] - c.y, to[0] - c.x);
      const b1 = b0 > a ? b0 : b0 + Math.PI * 2, b2 = b0 < a ? b0 : b0 - Math.PI * 2;
      const far = bb => { const m = (a + bb) / 2; return Math.hypot(c.x + Math.cos(m) * c.r - cx, c.y + Math.sin(m) * c.r - cy); };
      const b = far(b1) > far(b2) ? b1 : b2;
      for (let i = 1; i <= 32; i++) { const t = a + (b - a) * i / 32; path.lineTo(c.x + Math.cos(t) * c.r, c.y + Math.sin(t) * c.r); }
    };
    const bot = -cw, rgt = L + cw, top = W + cw, lft = -cw;
    // pockets: 0 (0,0) 1 (L/2,0) 2 (L,0) 3 (L,W) 4 (L/2,W) 5 (0,W)
    const s = hit(H[0], "y", bot)[1]; path.moveTo(s[0], s[1]);
    let e = hit(H[1], "y", bot); path.lineTo(e[0][0], e[0][1]); around(H[1], e[0], e[1]);
    e = hit(H[2], "y", bot); path.lineTo(e[0][0], e[0][1]); let q = hit(H[2], "x", rgt); around(H[2], e[0], q[0]);
    e = hit(H[3], "x", rgt); path.lineTo(e[0][0], e[0][1]); q = hit(H[3], "y", top); around(H[3], e[0], q[1]);
    e = hit(H[4], "y", top); path.lineTo(e[1][0], e[1][1]); around(H[4], e[1], e[0]);
    e = hit(H[5], "y", top); path.lineTo(e[1][0], e[1][1]); q = hit(H[5], "x", lft); around(H[5], e[1], q[1]);
    e = hit(H[0], "x", lft); path.lineTo(e[1][0], e[1][1]); around(H[0], e[1], s);
    path.closePath();
    return path;
  }

  buildArena(L, W, st) {
    const G = this.group, mx = L / 2, my = W / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x120e0b, roughness: .55, metalness: .1, envMapIntensity: .3 }));
    floor.rotation.x = -Math.PI / 2; floor.position.copy(V3(mx, -0.84, my)); floor.receiveShadow = true; G.add(floor);
    // advertising boards with a red LED strip, like a tournament arena
    const bx = L / 2 + 1.7, by = W / 2 + 1.5;
    const boardTex = (len) => canvasTex(2048, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#5a0b0e"); gr.addColorStop(1, "#2a0507"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.font = "bold 64px 'Bebas Neue', Impact, sans-serif"; g.textBaseline = "middle"; g.fillStyle = "rgba(255,255,255,.85)";
      const words = ["SCOREKER", "#SCOREKER", "SCOREKER  CUE  SPORTS"]; let x = 40, i = 0;
      while (x < w) { const t = words[i++ % words.length]; g.fillText(t, x, h / 2 + 4); x += g.measureText(t).width + 140; }
    });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    const board = (cx, cy, len, ry) => {
      const t = boardTex(len); t.repeat.set(len / 6, 1); t.wrapS = THREE.RepeatWrapping;
      const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.06), [null, null, null, null, new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .35, roughness: .5 }), new THREE.MeshStandardMaterial({ color: 0x0c0c0c })].map(m => m || new THREE.MeshStandardMaterial({ color: 0x0c0c0c })));
      b.position.copy(V3(cx, -0.56, cy)); b.rotation.y = ry; G.add(b);
      const led = new THREE.Mesh(new THREE.BoxGeometry(len, 0.025, 0.07), ledMat); led.position.copy(V3(cx, -0.27, cy)); led.rotation.y = ry; G.add(led);
    };
    board(mx, my - by, 2 * bx, Math.PI); board(mx, my + by, 2 * bx, 0);
    board(mx - bx, my, 2 * by, Math.PI / 2); board(mx + bx, my, 2 * by, -Math.PI / 2);
    // dim lights out in the hall
    const bulb = new THREE.MeshBasicMaterial({ color: 0x6d5a45 });
    for (let i = -3; i <= 3; i++) for (const side of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bulb); s.position.copy(V3(mx + i * 1.6, 3.2, my + side * 4.5)); G.add(s);
      const s2 = s.clone(); s2.position.copy(V3(mx + side * 6, 3.2, my + i * 1.1)); G.add(s2);
    }
    // tiered seating with a dim crowd all round
    const seatCols = [0x10141c, 0x1a1114, 0x141619, 0x1d1712, 0x111a15, 0x202024, 0x0c0d10, 0x2a1416];
    const person = new THREE.CylinderGeometry(0.15, 0.19, 0.48, 8), headG = new THREE.SphereGeometry(0.1, 10, 8), crowd = [];
    const tier = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: .95, envMapIntensity: 0 });
    const sides = st.crowd ? [[0, -1, bx * 2 + 4.2], [0, 1, bx * 2 + 4.2], [-1, 0, by * 2 + 4.2], [1, 0, by * 2 + 4.2]] : [];
    sides.forEach(([sx, sy, len]) => {
      for (let r = 0; r < 7; r++) {
        const dist = (sx ? bx : by) + 2.6 + r * 0.75, h = -0.55 + r * 0.42;
        const step = new THREE.Mesh(new THREE.BoxGeometry(sx ? 0.75 : len + r * 1.5, 0.42, sx ? len + r * 1.5 : 0.75), tier);
        step.position.copy(V3(mx + sx * dist, h - 0.21 - 0.3, my + sy * dist)); G.add(step);
        for (let k = -len / 2 - r * 0.7; k < len / 2 + r * 0.7; k += 0.42 + Math.random() * 0.2) {
          if (Math.random() < 0.18) continue;
          crowd.push({ x: mx + sx * dist + (sx ? 0 : k), y: my + sy * dist + (sx ? k : 0), h: h + Math.random() * 0.06, c: seatCols[(Math.random() * seatCols.length) | 0], ry: Math.atan2(sx, sy) });
        }
      }
    });
    const im = new THREE.InstancedMesh(person, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, envMapIntensity: 0 }), crowd.length);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, envMapIntensity: 0 }), crowd.length);
    const skin = [0x3a2a22, 0x2c1e17, 0x4a372b, 0x22170f, 0x3d2e26];
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), one = new THREE.Vector3(1, 1, 1);
    crowd.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
      mtx.compose(V3(p.x, p.h, p.y), q, one); im.setMatrixAt(i, mtx); im.setColorAt(i, col.setHex(p.c));
      mtx.compose(V3(p.x, p.h + 0.34, p.y), q, one); heads.setMatrixAt(i, mtx); heads.setColorAt(i, col.setHex(skin[i % skin.length]));
    });
    G.add(im, heads);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 1, envMapIntensity: .05 });
    const wy = by + (st.crowd ? 8.5 : 3.5), wx = bx + (st.crowd ? 8.5 : 3.5);
    [[mx, my - wy, 0], [mx, my + wy, Math.PI], [mx - wx, my, Math.PI / 2], [mx + wx, my, -Math.PI / 2]].forEach(([x, y, ry]) => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(30, 9), wallMat); w.position.copy(V3(x, 2.5, y)); w.rotation.y = ry; G.add(w);
    });
    // a soft wash of light over the stands
    const wash = new THREE.PointLight(0x9fb4ff, 0.12, 12, 2); wash.position.copy(V3(mx, 3.5, my)); G.add(wash);
  }

  buildBalls(game) {
    this.balls = new Map();
    const geo = new THREE.SphereGeometry(this.table.R, 48, 32);
    for (const d of def(game, 0) ? defsList(game) : []) {
      const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: ballTex(game, d), roughness: .1, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1 });
      const m = new THREE.Mesh(geo, mat); m.castShadow = true;
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.group.add(m);
      this.balls.set(d.id, { mesh: m, pot: null });
    }
  }
  buildCue() {
    const g = new THREE.Group(), len = 1.47;
    const part = (r1, r2, l, y, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, l, 28), mat); m.position.y = y; m.castShadow = true; g.add(m); };
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x08090b, roughness: .35, metalness: .15, clearcoat: .8, clearcoatRoughness: .15, envMapIntensity: .35 });
    part(0.0049, 0.0049, 0.006, -0.003, new THREE.MeshStandardMaterial({ color: 0x23466a, roughness: .95 }));
    part(0.005, 0.0051, 0.016, -0.014, new THREE.MeshStandardMaterial({ color: 0xf3efe3, roughness: .3 }));
    part(0.0051, 0.0105, len * 0.55, -0.022 - len * 0.275, carbon);
    part(0.0106, 0.0108, 0.02, -0.022 - len * 0.55 - 0.01, new THREE.MeshStandardMaterial({ color: 0x2a6fe0, emissive: 0x1a4fb0, emissiveIntensity: .6, roughness: .3, metalness: .6 }));
    part(0.0108, 0.0146, len * 0.42, -0.042 - len * 0.55 - len * 0.21, carbon);
    part(0.0147, 0.0148, 0.012, -0.042 - len * 0.97 - 0.006, new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: .2, metalness: .9 }));
    const inner = new THREE.Group(); inner.add(g); g.rotation.x = -Math.PI / 2;
    this.cue = new THREE.Group(); this.cue.add(inner); this.cueInner = g; this.group.add(this.cue); this.cue.visible = false;
  }
  buildGuides() {
    const mk = (color, op) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: op }));
    this.guide = { aim: mk(0xffffff, .75), obj: mk(0xffd66b, .8), cue: mk(0xffffff, .45) };
    const R = this.table.R;
    this.guide.ghost = new THREE.Mesh(new THREE.RingGeometry(R - 0.0012, R + 0.0002, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .85, side: THREE.DoubleSide }));
    this.guide.ghost.rotation.x = -Math.PI / 2;
    Object.values(this.guide).forEach(o => { o.visible = false; this.group.add(o); });
    this.zoneMesh = null;
  }

  // -------------------------------------------------------------- balls
  resetBalls(list) {
    for (const b of list) {
      const e = this.balls.get(b.id); if (!e) continue;
      e.pot = null; e.mesh.visible = b.on; e.mesh.scale.setScalar(1);
      e.mesh.position.copy(V3(b.x, this.table.R, b.y));
    }
  }
  // Follow the physics; animate balls dropping into pockets.
  sync(world, dt) {
    const R = this.table.R;
    for (const b of world.balls) {
      const e = this.balls.get(b.id); if (!e) continue;
      const m = e.mesh;
      if (b.on) {
        m.visible = true; m.position.set(b.x, R, -b.y);
        const wx = b.wx, wy = b.wz, wz = -b.wy, w = Math.hypot(wx, wy, wz);
        if (w > 1e-3) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(wx / w, wy / w, wz / w), w * dt); m.quaternion.premultiply(q); }
        e.pot = null;
      } else if (b.pocket >= 0 && m.visible) {
        const p = this.table.pockets[b.pocket];
        if (!e.pot) e.pot = { t: 0, x: m.position.x, y: -m.position.z };
        e.pot.t += dt;
        const k = Math.min(1, e.pot.t / 0.22), x = e.pot.x + (p.drop.x - e.pot.x) * k, y = e.pot.y + (p.drop.y - e.pot.y) * k;
        const fall = Math.max(0, e.pot.t - 0.12) * 1.6;
        m.position.set(x, R - fall, -y);
        if (fall > 0.2) m.visible = false;
      } else if (!b.on && b.pocket < 0) m.visible = false;
    }
  }
  potAnimating() { for (const e of this.balls.values()) if (e.pot && e.mesh.visible) return true; return false; }

  // -------------------------------------------------------------- cue + guides
  setCue(show, cue, angle, spin, gap) {
    this.cue.visible = !!show; if (!show) return;
    const R = this.table.R, ux = Math.cos(angle), uy = Math.sin(angle), rx = uy, ry = -ux;
    const depth = R * Math.sqrt(Math.max(0, 1 - (spin.x * spin.x + spin.y * spin.y) * 0.25));
    const tx = cue.x - ux * (depth + gap) + rx * spin.x * R * 0.5, ty = cue.y - uy * (depth + gap) + ry * spin.x * R * 0.5;
    this.cue.position.copy(V3(tx, R + spin.y * R * 0.5, ty));
    this.cue.rotation.set(0, Math.atan2(-ux, uy), 0);
    this.cueInner.rotation.x = -Math.PI / 2 - 0.07;
  }
  setGuides(g) {
    const G = this.guide, h = 0.004;
    const line = (o, a, b) => { o.visible = !!a; if (a) o.geometry.setFromPoints([V3(a.x, h, a.y), V3(b.x, h, b.y)]); };
    line(G.aim, g && g.from, g && g.to);
    line(G.obj, g && g.objFrom, g && g.objTo);
    line(G.cue, g && g.cueFrom, g && g.cueTo);
    G.ghost.visible = !!(g && g.ghost);
    if (G.ghost.visible) G.ghost.position.copy(V3(g.ghost.x, h, g.ghost.y));
  }
  showZone(z) {
    if (this.zoneMesh) { this.group.remove(this.zoneMesh); this.zoneMesh = null; }
    if (!z) return;
    const { L, W, R } = this.table, mat = new THREE.MeshBasicMaterial({ color: 0x7fb8e6, transparent: true, opacity: .16, depthWrite: false });
    let geo;
    if (z.type === "D") geo = new THREE.CircleGeometry(z.r, 48, Math.PI / 2, Math.PI);
    else if (z.type === "baulk") geo = new THREE.PlaneGeometry(z.x, W);
    else geo = new THREE.PlaneGeometry(L, W);
    const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2;
    if (z.type === "D") m.position.copy(V3(z.x, 0.002, z.y));
    else if (z.type === "baulk") m.position.copy(V3(z.x / 2, 0.002, W / 2));
    else m.position.copy(V3(L / 2, 0.002, W / 2));
    this.zoneMesh = m; this.group.add(m);
  }

  // -------------------------------------------------------------- camera
  camTo(pos, look, up, rate, dt, snap) {
    const c = this.cam;
    if (!c.pos || snap) { c.pos = pos.clone(); c.look.copy(look); c.up.copy(up); }
    else { const k = 1 - Math.exp(-dt * rate); c.pos.lerp(pos, k); c.look.lerp(look, k); c.up.lerp(up, k).normalize(); }
    this.camera.position.copy(c.pos); this.camera.up.copy(c.up); this.camera.lookAt(c.look);
  }
  // mode: aim (behind the cue ball, pitch 0 low .. 1 high), top, follow
  updateCamera(v, dt) {
    const { L, W, R } = this.table, w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const snap = v.snap; v.snap = false;
    this.canopy.forEach(m => m.visible = v.mode !== "top");
    if (v.mode === "top") {
      this.camera.fov = 40; this.camera.clearViewOffset();
      const aspect = w / h, vert = aspect < 1, tv = Math.tan(20 * Math.PI / 180);
      const l = L + 0.45, wd = W + 0.45, longS = vert ? l : wd, shortS = vert ? wd : l;
      const H = Math.max(longS / 2 / tv, shortS / 2 / (tv * aspect));
      this.camTo(V3(L / 2, H, W / 2), V3(L / 2, 0, W / 2), vert ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1), 6, dt, snap);
    } else {
      this.camera.fov = w < h ? 46 : 40;
      const p = v.pitch, ux = Math.cos(v.angle), uy = Math.sin(v.angle);
      const back = 0.34 + p * 1.1, high = 0.12 + p * 1.15, ahead = 1.05 - p * 0.55;
      let eye = { x: v.cue.x - ux * back, y: v.cue.y - uy * back }, look = { x: v.cue.x + ux * ahead, y: v.cue.y + uy * ahead };
      if (v.mode === "follow" && v.track) { look = { x: v.track.x, y: v.track.y }; eye = v.eye || eye; }
      this.camTo(V3(eye.x, high, eye.y), V3(look.x, 0, look.y), new THREE.Vector3(0, 1, 0), v.mode === "follow" ? 4 : 18, dt, snap);
      this.camera.setViewOffset(w, h, 0, Math.round(h * (0.2 - p * 0.15)), w, h);
    }
    this.camera.updateProjectionMatrix();
  }
  pick(clientX, clientY, height) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera({ x: (clientX - r.left) / r.width * 2 - 1, y: -(clientY - r.top) / r.height * 2 + 1 }, this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(height ?? this.table.R)), p)) return null;
    return { x: p.x, y: -p.z };
  }
  render() { this.renderer.render(this.scene, this.camera); }
}

import { defs as defsList } from "./rules.js";
