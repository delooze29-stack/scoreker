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
function fibreNormal(rep) { // a fine woven normal map for the cloth
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4, n = Math.random() - 0.5, weave = Math.sin(x * 0.9) * 0.25 + Math.sin(y * 1.3) * 0.15;
    img.data[i] = 128 + (n * 50 + weave * 60); img.data[i + 1] = 128 + (Math.random() - 0.5) * 50 - weave * 40; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; return t;
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
// Final pass when post effects are on: ACES tone mapping, sRGB output and a light vignette.
const OutputShader = {
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float exposure; varying vec2 vUv;
    vec3 fit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c *= exposure / 0.6; return clamp(O * fit(I * c), 0.0, 1.0); }
    vec3 srgb(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    void main(){ vec3 c = aces(texture2D(tDiffuse, vUv).rgb); vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.32; gl_FragColor = vec4(srgb(c), 1.0); }`,
};

export class View {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    host.prepend(r.domElement);
    this.quality = "high"; this.exposure = 0.92;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090a);
    this.scene.fog = new THREE.Fog(0x07090a, 6, 15);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.cam = { pos: null, look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), mode: "" };
    this.ray = new THREE.Raycaster();
    this.buildEnv();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }
  // High: bloom on the highlights and lights, HDR tone mapping, sharper shadows. Standard: lighter on the phone.
  // Smoothness first: lower the drawing resolution a step when the phone can't keep up.
  scaleResolution(f) {
    const r = this.renderer, max = Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 2.5 : 1.5);
    const pr = Math.max(0.75, Math.min(max, r.getPixelRatio() * f));
    if (Math.abs(pr - r.getPixelRatio()) < 0.02) return;
    r.setPixelRatio(pr); this.resize();
  }
  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "high" ? 2.5 : 1.5));
    this.composer = null;
    if (q === "high" && THREE.EffectComposer && THREE.UnrealBloomPass) {
      try {
        const w = this.host.clientWidth || 400, h = this.host.clientHeight || 600, pr = r.getPixelRatio();
        const ext = r.extensions, hdr = r.capabilities.isWebGL2 && (ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float"));
        const opts = { format: THREE.RGBAFormat, type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType };
        const rt = r.capabilities.isWebGL2 ? new THREE.WebGLMultisampleRenderTarget(w * pr, h * pr, opts) : new THREE.WebGLRenderTarget(w * pr, h * pr, opts);
        const c = new THREE.EffectComposer(r, rt);
        c.addPass(new THREE.RenderPass(this.scene, this.camera));
        this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.45, 0.92);
        c.addPass(this.bloom);
        this.out = new THREE.ShaderPass(OutputShader); c.addPass(this.out);
        this.composer = c;
      } catch (e) { console.warn("post effects off", e); this.composer = null; }
    }
    r.toneMapping = this.composer ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    this.resize();
  }
  buildEnv(env = "arena") { // reflections for the lacquered balls
    const studio = env === "studio", pub = env === "pub";
    const es = new THREE.Scene(); es.background = new THREE.Color(studio ? 0x2a3348 : pub ? 0x1c140e : 0x0a0c0c);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshBasicMaterial({ color: 0xfff4e2 })); p.rotation.x = Math.PI / 2; p.position.y = 2.2; es.add(p);
    const bandCol = studio ? 0xf2b71f : pub ? 0x7a4a24 : 0xff2a2a;
    [[0, -6, 0], [0, 6, Math.PI], [-6, 0, Math.PI / 2], [6, 0, -Math.PI / 2]].forEach(([x, z, ry]) => {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(20, studio ? 1.6 : 0.2), new THREE.MeshBasicMaterial({ color: bandCol }));
      band.position.set(x, studio ? 0.6 : 0.1, z); band.rotation.y = ry; es.add(band);
    });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: studio ? 0x2c3c52 : 0x0f1d16 })); f.rotation.x = -Math.PI / 2; f.position.y = -1; es.add(f);
    const pm = new THREE.PMREMGenerator(this.renderer); const old = this.scene.environment;
    this.scene.environment = pm.fromScene(es, 0.03).texture; pm.dispose(); if (old) old.dispose();
  }

  // -------------------------------------------------------------- table
  build(table, game, style) {
    if (this.group) { this.scene.remove(this.group); this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const G = this.group = new THREE.Group(); this.scene.add(G);
    this.table = table; this.game = game;
    const { L, W, R, cw } = table, rw = style.railWidth, ch = R * 1.4, rh = ch + 0.006;
    this.rh = rh;
    const st = style, studio = st.env === "studio";
    this.buildEnv(st.env);
    const bg = studio ? 0x1b2333 : st.env === "pub" ? 0x120d09 : 0x07090a;
    this.scene.background = new THREE.Color(bg); this.scene.fog = new THREE.Fog(bg, studio ? 9 : 6, studio ? 24 : 15);
    this.exposure = studio ? 0.78 : 0.92; this.renderer.toneMappingExposure = this.exposure;

    // lights
    G.add(new THREE.HemisphereLight(0xfff3dd, studio ? 0x2a3040 : 0x0a0d0b, studio ? 0.55 : 0.22));
    const sun = new THREE.DirectionalLight(0xfff1d6, studio ? 0.8 : 0.6); sun.position.set(L / 2 + 0.2, 3, -W / 2 - 0.3); sun.target.position.set(L / 2, 0, -W / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(this.quality === "high" ? 4096 : 2048, this.quality === "high" ? 4096 : 2048); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.003; sun.shadow.radius = 3;
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
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(st.cloth, [L * 6, W * 6]), roughness: .92, envMapIntensity: .1, normalMap: fibreNormal([L * 9, W * 9]), normalScale: new THREE.Vector2(0.35, 0.35) });
    clothMat.shadowSide = THREE.DoubleSide; // the bed must block the light, or ball shadows show on the floor underneath
    // the bed runs just under the rails; holes are trimmed to it (a hole that crosses the edge of the shape breaks the triangulation and leaves cloth over the pocket)
    const bx = cw + 0.004, bi = cw + 0.002;
    const bed = new THREE.Shape(); bed.moveTo(-bx, -bx); bed.lineTo(L + bx, -bx); bed.lineTo(L + bx, W + bx); bed.lineTo(-bx, W + bx); bed.closePath();
    const trim = pts => { const o = []; pts.forEach(q => { const t = { x: Math.min(L + bi, Math.max(-bi, q.x)), y: Math.min(W + bi, Math.max(-bi, q.y)) }; const l = o[o.length - 1]; if (!l || Math.hypot(l.x - t.x, l.y - t.y) > 1e-5) o.push(t); }); return o; };
    // each hole runs from the pocket mouth (the cushion points) back between the jaws and round the drop
    const holeOutline = p => {
      const c = p.drop, cx = L / 2, cy = W / 2, pts = [p.noseEntry, p.cutEntry];
      const a = Math.atan2(p.cutEntry.y - c.y, p.cutEntry.x - c.x), b0 = Math.atan2(p.cutExit.y - c.y, p.cutExit.x - c.x);
      const b1 = b0 > a ? b0 : b0 + Math.PI * 2, b2 = b0 < a ? b0 : b0 - Math.PI * 2;
      const far = bb => { const m = (a + bb) / 2; return Math.hypot(c.x + Math.cos(m) * c.r - cx, c.y + Math.sin(m) * c.r - cy); };
      const b = far(b1) > far(b2) ? b1 : b2;
      for (let i = 1; i < 40; i++) { const t = a + (b - a) * i / 40; pts.push({ x: c.x + Math.cos(t) * c.r, y: c.y + Math.sin(t) * c.r }); }
      pts.push(p.cutExit, p.noseExit);
      return pts;
    };
    this.holeShapes = table.pockets.map(p => trim(holeOutline(p)));
    this.holeShapes.forEach(pts => { const h = new THREE.Path(); pts.forEach((q, i) => i ? h.lineTo(q.x, q.y) : h.moveTo(q.x, q.y)); h.closePath(); bed.holes.push(h); });
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(bed, 48), clothMat); cloth.rotation.x = -Math.PI / 2; cloth.receiveShadow = true; cloth.castShadow = true; G.add(cloth);
    // soft shading along the cushions and round the drops
    const ao = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(0,0,0,.7)"); gr.addColorStop(.6, "rgba(0,0,0,.5)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const aoMat = new THREE.MeshBasicMaterial({ map: ao, transparent: true, depthWrite: false });
    table.pockets.forEach(p => { const m = new THREE.Mesh(new THREE.PlaneGeometry((p.drop.r + 0.035) * 2, (p.drop.r + 0.035) * 2), aoMat); m.rotation.x = -Math.PI / 2; m.position.copy(V3(p.drop.x, 0.0012, p.drop.y)); G.add(m); });
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
    (table.cushionShapes || table.cushions).forEach(pts => {
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
    const apron = new THREE.Mesh(new THREE.BoxGeometry(L + 2 * ox - 0.01, 0.24, W + 2 * ox - 0.01), apronMat); apron.castShadow = true; apron.position.copy(V3(L / 2, -0.145, W / 2)); // kept well below the cloth so the two never flicker G.add(apron);
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
    const throatMat = new THREE.MeshBasicMaterial({ color: 0x040404 });
    this.holeShapes.forEach(pts => {
      const sh = new THREE.Shape(); pts.forEach((q, i) => i ? sh.lineTo(q.x, q.y) : sh.moveTo(q.x, q.y)); sh.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), throatMat); m.rotation.x = -Math.PI / 2; m.position.y = -0.012; G.add(m);
      // the cloth turns down over the lip of the hole
      const pos = [], n = pts.length;
      for (let i = 0; i < n; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % n];
        pos.push(p0.x, 0, -p0.y, p1.x, 0, -p1.y, p1.x, -0.013, -p1.y, p0.x, 0, -p0.y, p1.x, -0.013, -p1.y, p0.x, -0.013, -p0.y);
      }
      const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); wg.computeVertexNormals();
      G.add(new THREE.Mesh(wg, fallMat));
    });
    table.pockets.forEach(p => {
      const c = V3(p.drop.x, 0, p.drop.y), hr = p.drop.r;
      const fall = new THREE.Mesh(new THREE.CylinderGeometry(hr - 0.0012, hr * 0.74, 0.04, 40, 1, true), linerMat); fall.position.set(c.x, -0.02, c.z); G.add(fall);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(hr * 0.74, hr * 0.68, 0.2, 32, 1, true), netMat); tube.position.set(c.x, -0.14, c.z); G.add(tube);
      const bot = new THREE.Mesh(new THREE.CircleGeometry(hr * 0.68, 32), new THREE.MeshBasicMaterial({ color: 0x030303 })); bot.rotation.x = -Math.PI / 2; bot.position.set(c.x, -0.235, c.z); G.add(bot);
      // a leather liner round the back of the hole, from jaw to jaw, the same at every pocket
      const A = Math.atan2(p.cutEntry.y - p.drop.y, p.cutEntry.x - p.drop.x), B = Math.atan2(p.cutExit.y - p.drop.y, p.cutExit.x - p.drop.x);
      const mid = t => (p.drop.x + Math.cos(t) * hr - p.M.x) * p.o.x + (p.drop.y + Math.sin(t) * hr - p.M.y) * p.o.y;
      let a0 = A, span = B - A; while (span < 0) span += Math.PI * 2;      // anticlockwise from entry to exit...
      if (mid(a0 + span / 2) < mid(B + (Math.PI * 2 - span) / 2)) { a0 = B; span = Math.PI * 2 - span; } // ...unless that's the mouth side
      const th0 = Math.PI / 2 + a0; // CylinderGeometry measures from +z towards +x; physics angle a sits at (cos a, -sin a) in x,z
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(hr - 0.0012, hr - 0.0012, rh + 0.03, 56, 1, true, th0, span), linerMat);
      wall.position.set(c.x, rh / 2 - 0.015, c.z); G.add(wall);
      const plate = new THREE.Mesh(new THREE.TorusGeometry(hr + 0.004, 0.0075, 10, 56, span), plateMat);
      plate.rotation.set(-Math.PI / 2, 0, a0); plate.scale.z = 0.45; plate.position.set(c.x, rh + 0.0005, c.z); plate.castShadow = true; G.add(plate);
      // rounded ends where the liner meets the jaws
      [a0, a0 + span].forEach(t => { const k = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 12, 8), plateMat); k.scale.y = 0.45; k.position.copy(V3(p.drop.x + Math.cos(t) * (hr + 0.004), rh + 0.0005, p.drop.y + Math.sin(t) * (hr + 0.004))); G.add(k); });
    });

    if (studio) this.buildStudio(L, W, st); else this.buildArena(L, W, st);
    this.buildBalls(game);
    this.buildCue();
    this.buildGuides();
  }

  innerOutline(table) {
    const { L, W, cw } = table, H = table.pockets.map(p => ({ x: p.drop.x, y: p.drop.y, r: p.drop.r }));
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
        const dist = (sx ? bx : by) + 3.6 + r * 0.75, h = -0.55 + r * 0.42;
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

  // A bright TV studio: blue-grey floor, yellow walls with a navy sponsor band, a broadcast camera.
  buildStudio(L, W, st) {
    const G = this.group, mx = L / 2, my = W / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTex(0x3a4c63, [30, 30]), roughness: .95, envMapIntensity: .1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.copy(V3(mx, -0.84, my)); floor.receiveShadow = true; G.add(floor);
    const wallTex = len => {
      const t = canvasTex(2048, 512, (g, w, h) => {
        g.fillStyle = "#f2b71f"; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 256) { g.fillStyle = "rgba(0,0,0,.06)"; g.fillRect(x, h * .36, 3, h * .64); }
        const gr = g.createLinearGradient(0, 0, 0, h * .36); gr.addColorStop(0, "#0a1430"); gr.addColorStop(1, "#13224d");
        g.fillStyle = gr; g.fillRect(0, 0, w, h * .36);
        g.fillStyle = "#f2b71f"; g.fillRect(0, h * .36, w, 6);
        g.textBaseline = "middle"; g.textAlign = "center";
        [[w * .18, "SCOREKER"], [w * .5, "CUE CLUB"], [w * .82, "SCOREKER"]].forEach(([x, t], i) => {
          g.font = `bold ${i === 1 ? 92 : 84}px 'Bebas Neue', Impact, sans-serif`; g.fillStyle = i === 1 ? "#f2b71f" : "#ffffff"; g.fillText(t, x, h * .19);
        });
        const g2 = g.createLinearGradient(0, h * .8, 0, h); g2.addColorStop(0, "rgba(0,0,0,0)"); g2.addColorStop(1, "rgba(0,0,0,.25)"); g.fillStyle = g2; g.fillRect(0, h * .8, w, h * .2);
      });
      t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.max(1, Math.round(len / 4.5)), 1); return t;
    };
    const dx = L / 2 + 2.3, dy = W / 2 + 2.0, hgt = 2.4;
    [[mx, my - dy, 2 * dx, 0], [mx, my + dy, 2 * dx, Math.PI], [mx - dx, my, 2 * dy, -Math.PI / 2], [mx + dx, my, 2 * dy, Math.PI / 2]].forEach(([x, y, len, ry]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), new THREE.MeshStandardMaterial({ map: wallTex(len), roughness: .8, envMapIntensity: .2, emissive: 0xffffff, emissiveMap: wallTex(len), emissiveIntensity: .12 }));
      m.position.copy(V3(x, -0.84 + hgt / 2, y)); m.rotation.y = ry + Math.PI; G.add(m);
    });
    // broadcast camera on a tripod, off the baulk-left corner
    const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: .45, metalness: .6 });
    const cam = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 1.25, 8), metal);
      leg.position.set(Math.cos(a) * 0.22, 0.55, Math.sin(a) * 0.22); leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); cam.add(leg);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 10), metal); col.position.y = 1.25; cam.add(col);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.24), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: .5, metalness: .3 })); body.position.set(0.05, 1.5, 0); cam.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.38, 20), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: .3, metalness: .5 }));
    lens.rotation.z = Math.PI / 2; lens.position.set(0.48, 1.5, 0); cam.add(lens);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshStandardMaterial({ color: 0x223355, roughness: .05, metalness: .9 })); glass.rotation.y = Math.PI / 2; glass.position.set(0.672, 1.5, 0); cam.add(glass);
    const vf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), metal); vf.position.set(-0.2, 1.68, 0.05); cam.add(vf);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), metal); handle.rotation.z = Math.PI / 2 - 0.35; handle.position.set(-0.45, 1.38, 0.12); cam.add(handle);
    cam.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // cameras sit off the long sides, pointing at the table
    cam.position.copy(V3(L * 0.3, -0.84, W + 1.35)); cam.rotation.y = -Math.PI / 2 - 0.5; G.add(cam);
    const cam2 = cam.clone(); cam2.position.copy(V3(L * 0.72, -0.84, -1.35)); cam2.rotation.y = Math.PI / 2 - 0.5; G.add(cam2);
  }

  buildBalls(game) {
    this.balls = new Map();
    const R = this.table.R;
    this.blobGeo = new THREE.PlaneGeometry(R * 2.6, R * 2.6);
    this.blobMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(.45, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }) });
    const geo = new THREE.SphereGeometry(this.table.R, 64, 44);
    for (const d of def(game, 0) ? defsList(game) : []) {
      const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: ballTex(game, d), roughness: .1, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1 });
      const m = new THREE.Mesh(geo, mat); m.castShadow = true;
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.group.add(m);
      const sh = new THREE.Mesh(this.blobGeo, this.blobMat); sh.rotation.x = -Math.PI / 2; sh.renderOrder = 1; this.group.add(sh);
      this.balls.set(d.id, { mesh: m, pot: null, shadow: sh });
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
    // guide lines are flat strips of a fixed width on the cloth, so they stay visible on sharp phone screens
    const R = this.table.R;
    const mk = (color, op, width) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.userData.w = width; m.renderOrder = 3; return m; };
    this.guide = { aim: mk(0xffffff, .55, R * 0.12), obj: mk(0xffd66b, .9, R * 0.16), cue: mk(0xbfe3ff, .7, R * 0.12) };
    this.guide.ghost = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R * 1.02, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }));
    this.guide.ghost.renderOrder = 3;
    this.guide.ghost.rotation.x = -Math.PI / 2;
    const glowTex = canvasTex(64, 256, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const along = 1 - y / h, fade = Math.pow(along, 0.6) * (y < 6 ? y / 6 : 1);
        const gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(.35, `rgba(255,255,255,${.25 * fade})`); gr.addColorStop(.5, `rgba(255,255,255,${.7 * fade})`);
        gr.addColorStop(.65, `rgba(255,255,255,${.25 * fade})`); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, y, w, 1);
      }
    });
    glowTex.encoding = THREE.LinearEncoding;
    this.guide.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.guide.glow.renderOrder = 2;
    Object.values(this.guide).forEach(o => { o.visible = false; this.group.add(o); });
    this.zoneMesh = null;
  }

  // -------------------------------------------------------------- balls
  resetBalls(list) {
    for (const b of list) {
      const e = this.balls.get(b.id); if (!e) continue;
      e.pot = null; e.mesh.visible = b.on; e.mesh.scale.setScalar(1);
      e.mesh.position.copy(V3(b.x, this.table.R, b.y));
      e.shadow.visible = b.on; e.shadow.position.copy(V3(b.x, 0.0016, b.y));
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
        e.pot = null; e.shadow.visible = true; e.shadow.position.set(b.x, 0.0016, -b.y);
      } else if (b.pocket >= 0 && m.visible) {
        e.shadow.visible = false;
        const p = this.table.pockets[b.pocket];
        if (!e.pot) e.pot = { t: 0, x: m.position.x, y: -m.position.z };
        e.pot.t += dt;
        const k = Math.min(1, e.pot.t / 0.22), x = e.pot.x + (p.drop.x - e.pot.x) * k, y = e.pot.y + (p.drop.y - e.pot.y) * k;
        const fall = Math.max(0, e.pot.t - 0.12) * 1.6;
        m.position.set(x, R - fall, -y);
        if (fall > 0.2) m.visible = false;
      } else if (!b.on && b.pocket < 0) { m.visible = false; e.shadow.visible = false; }
    }
  }
  potAnimating() { for (const e of this.balls.values()) if (e.pot && e.mesh.visible) return true; return false; }

  // -------------------------------------------------------------- cue + guides
  setCue(show, cue, angle, spin, gap, elevIn) {
    this.cue.visible = !!show; if (!show) return;
    const R = this.table.R, ux = Math.cos(angle), uy = Math.sin(angle), rx = uy, ry = -ux;
    const depth = R * Math.sqrt(Math.max(0, 1 - (spin.x * spin.x + spin.y * spin.y) * 0.25));
    const tx = cue.x - ux * (depth + gap) + rx * spin.x * R * 0.5, ty = cue.y - uy * (depth + gap) + ry * spin.x * R * 0.5;
    const tipH = R + spin.y * R * 0.5;
    this.cue.position.copy(V3(tx, tipH, ty));
    this.cue.rotation.set(0, Math.atan2(-ux, uy), 0);
    // How far back along the cue until it crosses the cushion and then the rail? Raise the butt to clear both.
    const elev = elevIn == null ? 0.07 : elevIn;
    this.cueElev = this.cueElev == null ? elev : this.cueElev + (elev - this.cueElev) * 0.35;
    this.cueInner.rotation.x = -Math.PI / 2 - this.cueElev;
  }
  setGuides(g) {
    const G = this.guide, h = 0.004;
    const line = (o, a, b) => {
      o.visible = !!(a && b); if (!o.visible) return;
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); if (l < 1e-4) { o.visible = false; return; }
      o.position.copy(V3((a.x + b.x) / 2, h, (a.y + b.y) / 2));
      o.rotation.set(-Math.PI / 2, 0, Math.atan2(dy, dx));
      o.scale.set(l, o.userData.w, 1);
    };
    line(G.aim, g && g.from, g && g.to);
    line(G.obj, g && g.objFrom, g && g.objTo);
    line(G.cue, g && g.cueFrom, g && g.cueTo);
    G.ghost.visible = !!(g && g.ghost);
    if (G.ghost.visible) G.ghost.position.copy(V3(g.ghost.x, h, g.ghost.y));
    G.glow.visible = !!(g && g.from);
    if (G.glow.visible) { // a soft white beam from the cue ball along the aim, like TV snooker games
      const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y, len = Math.max(0.01, Math.hypot(dx, dy) - this.table.R);
      const ux = dx / (len + this.table.R), uy = dy / (len + this.table.R), sx = g.from.x + ux * (this.table.R + len / 2), sy = g.from.y + uy * (this.table.R + len / 2);
      G.glow.position.copy(V3(sx, h + 0.001, sy));
      G.glow.rotation.set(-Math.PI / 2, 0, Math.atan2(uy, ux) - Math.PI / 2);
      G.glow.scale.set(this.table.R * 1.8, len, 1);
      G.aim.material.opacity = 0.5;
    }
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
    this.canopy.forEach(m => m.visible = v.mode !== "top" && v.mode !== "tv" && v.mode !== "follow" && (v.pitch || 0) < 0.35);
    if (v.mode === "tv") { // high broadcast view from behind the baulk end
      const portrait = w < h; this.camera.fov = portrait ? 50 : 44; this.camera.clearViewOffset();
      const z = v.zoom || 1, back = (portrait ? 0.9 + L * 0.42 : 0.8 + L * 0.36) * z, hgt = (portrait ? 1.2 + L * 0.42 : 1.25 + L * 0.42) * z;
      this.camTo(V3(-back, hgt, W / 2), V3(L * (portrait ? 0.58 : 0.5), 0, W / 2), new THREE.Vector3(0, 1, 0), 3, dt, snap);
    } else if (v.mode === "top") {
      this.camera.fov = 40; this.camera.clearViewOffset();
      const aspect = w / h, vert = aspect < 1, tv = Math.tan(20 * Math.PI / 180);
      const l = L + 0.45, wd = W + 0.45, longS = vert ? l : wd, shortS = vert ? wd : l;
      const z = Math.min(1, v.zoom || 1), H = Math.max(longS / 2 / tv, shortS / 2 / (tv * aspect)) * z;
      // zoomed in, drift towards the cue ball so it stays in view
      const fx = L / 2 + (v.cue.x - L / 2) * (1 - z) * 1.6, fy = W / 2 + (v.cue.y - W / 2) * (1 - z) * 1.6;
      const cx = Math.max(L * z / 2, Math.min(L - L * z / 2, fx)), cy = Math.max(W * z / 2 - 0.1, Math.min(W - W * z / 2 + 0.1, fy));
      this.camTo(V3(cx, H, cy), V3(cx, 0, cy), vert ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1), 6, dt, snap);
    } else {
      this.camera.fov = w < h ? 46 : 40;
      const p = v.pitch, ux = Math.cos(v.angle), uy = Math.sin(v.angle);
      const z = v.zoom || 1, back = (0.34 + p * 1.1) * z, ahead = 1.05 - p * 0.55;
      let high = (0.12 + p * 1.15) * z;
      if (v.mode !== "follow" && this.cue.visible && this.cueElev > 0.09) high = Math.max(high, R + (back + 0.05) * Math.tan(this.cueElev) + 0.07);
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
  render() {
    if (this.composer) { this.out.uniforms.exposure.value = this.exposure; this.composer.render(); }
    else this.renderer.render(this.scene, this.camera);
  }
}

import { defs as defsList } from "./rules.js";
