/* =========================================================================
   Zero-Touch IT Simulator – 3D-Szene (three.js)
   Ein stilisiertes Bürogeschoss: Großraumbüro, Serverraum, Besprechungsraum
   „Alpen“, Service Desk. Ereignisse erscheinen als Marker, Techniker laufen zu
   Störungen, Automatisierung erscheint als Lichtsäule, KI-Agenten als Drohne.
   Schnittstelle: window.Scene3D
   ========================================================================= */
window.Scene3D = (function () {
  'use strict';
  const S = {};
  let renderer, scene, camera, canvas, clock;
  let sun, hemi, ambient;
  const desks = [];           // { group, screen, person, pos }
  const racks = [];
  const techs = [];           // { group, home, state, target, eventId, t }
  let drone, droneHome, droneTarget = null, droneTimer = 0;
  const markers = new Map();  // eventId -> Marker
  const beams = [];           // { mesh, ring, life }
  const bubbles = [];         // temporäre Sprites { sprite, life }
  const ticketCubes = [];
  let apMesh, gateway, serviceDeskPos, entrancePos, jonasFigure = null, claudiaDesk = null;
  let hall = null; const machines = [];   // OT-Werkhalle (zuschaltbar)
  const eventTargets = {};    // eventId -> { pos: Vector3, desks: number[], floor: Vector3 }
  const waiting = [];         // Ereignisse, die auf einen Techniker warten
  let follow = true;
  let focus = null, focusTimer = 0;
  const cam = { theta: 0.85, phi: 0.95, radius: 46, target: new THREE.Vector3(0, 0.5, 0), idle: 0, dragging: false, lx: 0, ly: 0 };
  let simMin = 7 * 60, running = false;

  const COL = {
    ground: 0x9db0a3, floor: 0xd8dde4, floorServer: 0xbfc8d6, floorMeet: 0xd8cfbd, floorIT: 0xc9d6ea, asphalt: 0x8b949c, tree: 0x4f8a5b, trunk: 0x7a5a3a,
    wall: 0xf7f8fa, wood: 0xd9c3a5, chair: 0x4b5563, person: 0x6b7a8c, tech: 0xd6541e, agent: 0x138f63,
    auto: 0x1f66c2, rack: 0x2b3440, screenOk: 0x5fd38d, screenBad: 0xff5a4a, screenOff: 0x1a2230, ticket: 0xf0b45a
  };

  /* ---------- Hilfen ---------- */
  function mat(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .85, metalness: .05 }, opts || {})); }
  function box(w, h, d, color, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function textSprite(text, opts) {
    opts = opts || {};
    const c = document.createElement('canvas'); const ctx = c.getContext('2d');
    const fs = opts.size || 42; ctx.font = '600 ' + fs + 'px "Sora", "Segoe UI", sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 48; c.width = w; c.height = fs + 36;
    ctx.font = '600 ' + fs + 'px "Sora", "Segoe UI", sans-serif';
    if (opts.bg) { ctx.fillStyle = opts.bg; roundRect(ctx, 0, 0, c.width, c.height, 18); ctx.fill(); }
    ctx.fillStyle = opts.color || '#2b3440'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const scale = opts.scale || 0.0085;
    sp.scale.set(c.width * scale, c.height * scale, 1);
    return sp;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function iconSprite(kind) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const ctx = c.getContext('2d');
    const colors = { alert: '#e0463a', work: '#e08a2e', done: '#1f66c2', prevented: '#138f63', wait: '#8a94a3', approve: '#e08a2e', user: '#5e6b7a' };
    ctx.fillStyle = colors[kind] || '#555';
    ctx.beginPath(); ctx.arc(64, 56, 46, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(40, 92); ctx.lineTo(88, 92); ctx.lineTo(64, 122); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.fillStyle = '#fff';
    if (kind === 'alert') { ctx.beginPath(); ctx.moveTo(64, 30); ctx.lineTo(64, 62); ctx.stroke(); ctx.beginPath(); ctx.arc(64, 78, 6, 0, 7); ctx.fill(); }
    else if (kind === 'done' || kind === 'approve') { ctx.beginPath(); ctx.moveTo(42, 58); ctx.lineTo(58, 74); ctx.lineTo(88, 40); ctx.stroke(); }
    else if (kind === 'prevented') { ctx.beginPath(); ctx.moveTo(64, 26); ctx.lineTo(92, 38); ctx.lineTo(88, 66); ctx.lineTo(64, 86); ctx.lineTo(40, 66); ctx.lineTo(36, 38); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(50, 56); ctx.lineTo(60, 66); ctx.lineTo(78, 46); ctx.stroke(); }
    else if (kind === 'work') { ctx.beginPath(); ctx.arc(64, 56, 20, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(64, 56); ctx.lineTo(64, 40); ctx.moveTo(64, 56); ctx.lineTo(76, 62); ctx.stroke(); }
    else if (kind === 'wait') { [44, 64, 84].forEach(x => { ctx.beginPath(); ctx.arc(x, 56, 6, 0, 7); ctx.fill(); }); }
    else if (kind === 'user') { ctx.beginPath(); ctx.arc(64, 44, 12, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(64, 84, 22, Math.PI, 0); ctx.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set(1.6, 1.6, 1); sp.renderOrder = 10;
    return sp;
  }

  /* ---------- Figuren & Möbel ---------- */
  function person(color, seated) {
    const g = new THREE.Group();
    const h = seated ? .55 : .8;
    const body = new THREE.Mesh(THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(.2, h - .4, 4, 8) : new THREE.CylinderGeometry(.2, .22, h, 10), mat(color));
    body.position.y = h / 2 + (seated ? .35 : 0); body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.17, 12, 10), mat(0xf1d2b6));
    head.position.y = h + .2 + (seated ? .35 : 0); head.castShadow = true;
    g.add(body, head);
    return g;
  }
  function makeDesk(x, z, rot) {
    const g = new THREE.Group();
    const top = box(1.5, .06, .75, COL.wood); top.position.y = .74; g.add(top);
    [[-.68, -.3], [.68, -.3], [-.68, .3], [.68, .3]].forEach(p => { const l = box(.06, .72, .06, 0x9aa3ad); l.position.set(p[0], .36, p[1]); g.add(l); });
    const stand = box(.08, .18, .08, 0x2b3440); stand.position.set(0, .86, -.2); g.add(stand);
    const frame = box(.6, .36, .04, 0x2b3440); frame.position.set(0, 1.06, -.2); g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(.54, .3), new THREE.MeshStandardMaterial({ color: 0x111820, emissive: COL.screenOk, emissiveIntensity: .9, roughness: .4 }));
    screen.position.set(0, 1.06, -.177); g.add(screen);
    const seat = box(.5, .08, .5, COL.chair); seat.position.set(0, .45, .75); g.add(seat);
    const back = box(.5, .5, .08, COL.chair); back.position.set(0, .75, .98); g.add(back);
    const p = person(COL.person, true); p.position.set(0, 0, .75); g.add(p);
    g.position.set(x, 0, z); g.rotation.y = rot || 0;
    scene.add(g);
    return { group: g, screen: screen.material, person: p, pos: new THREE.Vector3(x, 0, z), occupied: true };
  }
  function makeRack(x, z) {
    const g = new THREE.Group();
    const body = box(.75, 2.1, .9, COL.rack, { roughness: .5, metalness: .3 }); body.position.y = 1.05; g.add(body);
    const leds = [];
    for (let i = 0; i < 7; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .02), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: Math.random() > .3 ? 0x5fd38d : 0x3987e5, emissiveIntensity: 1 }));
      led.position.set(-.25 + (i % 2) * .5, .4 + Math.floor(i / 2) * .32, .46); g.add(led); leds.push(led);
    }
    g.position.set(x, 0, z); scene.add(g);
    return { group: g, leds, pos: new THREE.Vector3(x, 0, z) };
  }
  function slab(x, z, w, d, color) {
    const m = box(w, .06, d, color); m.position.set(x, .03, z); m.receiveShadow = true; m.castShadow = false; scene.add(m); return m;
  }
  function wall(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = box(len, .55, .12, COL.wall); m.position.set((x1 + x2) / 2, .33, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(m);
  }
  function label(text, x, z, y) { const sp = textSprite(text, { color: '#3b4654', bg: 'rgba(255,255,255,.82)', size: 40 }); sp.position.set(x, y || 2.6, z); scene.add(sp); }

  /* ---------- Aufbau ---------- */
  function build() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), mat(COL.ground, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    // Außengelände
    const road = box(90, .04, 6, COL.asphalt); road.position.set(0, .02, 21); road.receiveShadow = true; scene.add(road);
    for (let i = -8; i <= 8; i++) { const l = box(2.2, .01, .2, 0xe8e8e0); l.position.set(i * 5.2, .05, 21); scene.add(l); }
    const path = box(3, .04, 6, 0xc9cfd4); path.position.set(.5, .02, 15); scene.add(path);
    for (let i = 0; i < 6; i++) { const slot = box(2.4, .02, 4.6, 0x9aa3aa); slot.position.set(-12 + i * 2.7, .03, 15.5); scene.add(slot); }
    const treeAt = (x, z, h) => {
      const tr = box(.3, h * .5, .3, COL.trunk); tr.position.set(x, h * .25, z); scene.add(tr);
      const cr = new THREE.Mesh(new THREE.ConeGeometry(h * .45, h * .9, 7), mat(COL.tree)); cr.position.set(x, h * .5 + h * .45, z); cr.castShadow = true; scene.add(cr);
    };
    [[-22, -8, 4], [-23, 2, 3.4], [-21, 9, 4.4], [22, -7, 3.8], [23, 4, 4.2], [21, 12, 3.2], [-24, -18, 3.6], [24, -18, 4], [12, 15.5, 3.4], [16, 16, 2.8]].forEach(t => treeAt(t[0], t[1], t[2]));
    // Grundplatte des Gebäudes
    const plinth = box(35.5, .3, 23.5, 0xc8ced6); plinth.position.set(0, -.16, 0); scene.add(plinth);
    slab(0, 0, 34, 22, COL.floor);
    // Zonen
    slab(10.5, -5.5, 9, 7, COL.floorServer);
    slab(10.5, 5.5, 9, 7, COL.floorMeet);
    slab(1.5, -6.5, 7, 5, COL.floorIT);
    // Außenwände
    wall(-17, -11, 17, -11); wall(-17, 11, -2, 11); wall(3, 11, 17, 11); wall(-17, -11, -17, 11); wall(17, -11, 17, 11);
    // Innenwände
    wall(6, -11, 6, 11); wall(6, 1.5, 15, 1.5); wall(-2, -11, -2, -4); wall(-2, -4, 5, -4);
    label('Großraumbüro', -8, -9.5); label('Serverraum', 10.5, -9.8); label('Besprechungsraum „Alpen“', 10.5, 9.4); label('Service Desk', 1.5, -9.3);
    // Schreibtische 5 × 4
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      desks.push(makeDesk(-14.5 + c * 2.6, -6.5 + r * 4.2, 0));
    }
    // Serverraum
    for (let i = 0; i < 4; i++) racks.push(makeRack(7.6 + i * 1.6, -7.5));
    for (let i = 0; i < 3; i++) racks.push(makeRack(8.4 + i * 1.6, -3.6));
    // Besprechungsraum
    const table = box(4.2, .08, 1.6, COL.wood); table.position.set(10.5, .74, 5.5); scene.add(table);
    [[-1.4, -1.4], [0, -1.4], [1.4, -1.4], [-1.4, 1.4], [0, 1.4], [1.4, 1.4], [-2.6, 0], [2.6, 0]].forEach(p => {
      const ch = box(.5, .08, .5, COL.chair); ch.position.set(10.5 + p[0], .45, 5.5 + p[1]); scene.add(ch);
      const pr = person(COL.person, true); pr.position.set(10.5 + p[0], 0, 5.5 + p[1]); scene.add(pr);
    });
    const pole = box(.08, 3.4, .08, 0x9aa3ad); pole.position.set(13.8, 1.7, 8.6); scene.add(pole);
    apMesh = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .1, 24), mat(0xffffff)); apMesh.position.set(13.8, 3.45, 8.6); apMesh.castShadow = true; scene.add(apMesh);
    // Service Desk
    const sd = box(3.2, .06, .8, COL.wood); sd.position.set(1.5, .74, -7); scene.add(sd);
    serviceDeskPos = new THREE.Vector3(1.5, 0, -7);
    for (let i = 0; i < 2; i++) {
      const t = person(COL.tech, false); t.position.set(.6 + i * 1.8, 0, -8.2); scene.add(t);
      techs.push({ group: t, home: t.position.clone(), state: 'idle', target: null, eventId: null, t: 0 });
    }
    const sdLabel = textSprite('Techniker', { color: '#9a3a10', size: 30, bg: 'rgba(255,255,255,.8)' }); sdLabel.position.set(1.5, 1.9, -8.2); scene.add(sdLabel);
    // Sicherheits-Gateway (Identität & Zugriff)
    gateway = new THREE.Group();
    const gw = box(1.2, 1.6, .5, 0x3b4654, { metalness: .4, roughness: .4 }); gw.position.y = .8; gateway.add(gw);
    const gwLight = new THREE.Mesh(new THREE.BoxGeometry(.9, .12, .06), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x3987e5, emissiveIntensity: 1 })); gwLight.position.set(0, 1.3, .27); gateway.add(gwLight);
    gateway.position.set(4.2, 0, -6.2); scene.add(gateway);
    const gwl = textSprite('Identität & Zugriff', { color: '#3b4654', size: 28, bg: 'rgba(255,255,255,.8)' }); gwl.position.set(4.2, 2.3, -6.2); scene.add(gwl);
    // Eingang
    entrancePos = new THREE.Vector3(.5, 0, 13);
    const mat1 = box(3, .04, 2, 0x8a94a3); mat1.position.set(.5, .05, 12); scene.add(mat1);
    label('Eingang', .5, 13.6, 1.6);
    // Drohne (KI-Agent)
    drone = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(.32, 0), new THREE.MeshStandardMaterial({ color: COL.agent, emissive: COL.agent, emissiveIntensity: .7, roughness: .3 }));
    const ringG = new THREE.Mesh(new THREE.TorusGeometry(.55, .04, 8, 32), mat(0xffffff)); ringG.rotation.x = Math.PI / 2;
    drone.add(core, ringG);
    const dl = new THREE.PointLight(COL.agent, .8, 6); dl.position.y = -.3; drone.add(dl);
    droneHome = new THREE.Vector3(1.5, 3.4, -5.6); drone.position.copy(droneHome); scene.add(drone);
    const dlab = textSprite('KI-Agent', { color: '#0d6b49', size: 28, bg: 'rgba(255,255,255,.8)' }); dlab.position.set(0, .9, 0); drone.add(dlab);

    // Ziele der Ereignisse
    const deskPos = i => desks[i].pos.clone();
    const groupCenter = idx => { const v = new THREE.Vector3(); idx.forEach(i => v.add(desks[i].pos)); return v.multiplyScalar(1 / idx.length); };
    const t = (pos, deskIdx, h) => ({ pos: pos.clone().setY(h || 2.0), desks: deskIdx || [], floor: pos.clone().setY(0) });
    eventTargets.ssd = t(deskPos(2), [2]);
    eventTargets.onboarding = t(deskPos(7), [7]);
    eventTargets.license = t(deskPos(12), [12]);
    eventTargets.login = t(gateway.position, [5], 2.6);
    eventTargets.mfa = t(deskPos(16), [16]);
    eventTargets.offboarding = t(deskPos(9), [9]);
    eventTargets.erp = t(groupCenter([0, 1, 2, 3, 10, 11, 12, 13]), [0, 1, 2, 3, 10, 11, 12, 13], 2.4);
    eventTargets.cve = t(groupCenter([6, 7, 8, 11, 12, 13]), desks.map((d, i) => i), 2.8);
    eventTargets.teams = t(groupCenter([14, 15, 16, 17, 18, 19]), [14, 15, 16, 17, 18, 19], 2.4);
    eventTargets.storage = t(racks[1].pos, [], 2.9);
    eventTargets.wlan = t(apMesh.position, [], 4.3);
    eventTargets.wlan.floor = new THREE.Vector3(12.8, 0, 8.2);
    eventTargets.storage.floor = new THREE.Vector3(9.2, 0, -6.2);
    eventTargets.login.floor = new THREE.Vector3(4.2, 0, -5.2);
    // Jonas (neuer Mitarbeiter) steht zunächst am Eingang, sein Platz ist leer
    buildHall();
    desks[7].person.visible = false; desks[7].occupied = false; desks[7].screen.emissive.setHex(COL.screenOff);
    jonasFigure = person(0x8a94a3, false); jonasFigure.position.copy(entrancePos); jonasFigure.position.x -= 1; scene.add(jonasFigure);
    claudiaDesk = desks[9];
  }

  /* ---------- OT-Werkhalle ---------- */
  function buildHall() {
    hall = new THREE.Group();
    const add = o => { hall.add(o); return o; };
    const plinth = box(36, .3, 14, 0xb9c0c8); plinth.position.set(0, -.16, -21); add(plinth);
    const floor = box(34.5, .06, 12.5, 0xcfd3d8); floor.position.set(0, .03, -21); floor.castShadow = false; add(floor);
    [[-17, -27.5, 17, -27.5], [-17, -14.5, -2, -14.5], [3, -14.5, 17, -14.5], [-17, -27.5, -17, -14.5], [17, -27.5, 17, -14.5]].forEach(w => { const len = Math.hypot(w[2] - w[0], w[3] - w[1]); const m = box(len, .9, .15, 0xe9ebee); m.position.set((w[0] + w[2]) / 2, .5, (w[1] + w[3]) / 2); m.rotation.y = -Math.atan2(w[3] - w[1], w[2] - w[0]); add(m); });
    const lab = textSprite('Werkhalle · OT', { color: '#3b4654', bg: 'rgba(255,255,255,.82)', size: 40 }); lab.position.set(0, 3.2, -26.3); add(lab);
    // Drei Linien mit je drei Maschinen und Förderband
    for (let line = 0; line < 3; line++) {
      const z = -25 + line * 3.6;
      const belt = box(13, .25, .6, 0x4b5563); belt.position.set(-3.5, .4, z); add(belt);
      for (let k = 0; k < 3; k++) {
        const x = -9 + k * 5.5;
        const body = box(2.2, 1.6, 1.6, 0x6f8a7a, { roughness: .6, metalness: .2 }); body.position.set(x, .8, z - 1.3); add(body);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(.6, .4), new THREE.MeshStandardMaterial({ color: 0x111820, emissive: 0x5fd38d, emissiveIntensity: .9 })); panel.position.set(x + .9, 1.3, z - .48); add(panel);
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .25, 8), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x5fd38d, emissiveIntensity: .8 })); beacon.position.set(x - .8, 1.75, z - 1.3); add(beacon);
        machines.push({ line, pos: new THREE.Vector3(x, 0, z - 1.3), panel: panel.material, beacon: beacon.material });
      }
      const worker = person(0x3d5a80, false); worker.position.set(-9 + 2.7, 0, z + 1.1); add(worker);
      const lbl = textSprite('Linie ' + (line + 1), { color: '#3b4654', size: 26, bg: 'rgba(255,255,255,.8)' }); lbl.position.set(-13.5, 1.6, z); add(lbl);
    }
    // SPS-Schaltschrank und Zellen-Switch
    const cab = box(1.2, 2.1, .7, 0xd6d9de, { metalness: .3, roughness: .4 }); cab.position.set(12, 1.05, -25.5); add(cab);
    const stripe = box(1.2, .12, .02, 0xd6541e); stripe.position.set(12, 1.9, -25.14); add(stripe);
    const cabL = textSprite('SPS-Schrank', { color: '#3b4654', size: 26, bg: 'rgba(255,255,255,.8)' }); cabL.position.set(12, 2.8, -25.5); add(cabL);
    const sw = box(.9, 1.4, .6, 0x2b3440, { metalness: .3, roughness: .5 }); sw.position.set(12, .7, -20); add(sw);
    const swL = textSprite('Zellen-Switch', { color: '#3b4654', size: 26, bg: 'rgba(255,255,255,.8)' }); swL.position.set(12, 2.1, -20); add(swL);
    // Roboter
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.5, .6, .5, 16), mat(0xf0b45a)); base.position.set(12, .25, -16.5); add(base);
    const arm1 = box(.35, 1.6, .35, 0xf0b45a); arm1.position.set(12, 1.2, -16.5); arm1.rotation.z = .3; add(arm1);
    const arm2 = box(1.4, .3, .3, 0xf0b45a); arm2.position.set(12.8, 1.95, -16.5); arm2.rotation.z = -.2; add(arm2);
    hall.visible = false; scene.add(hall);
    const t = (pos, idx, h) => ({ pos: pos.clone().setY(h || 2.4), desks: [], machines: idx, floor: pos.clone().setY(0).add(new THREE.Vector3(0, 0, 1.6)) });
    const lineIdx = l => machines.map((m, i) => m.line === l ? i : -1).filter(i => i >= 0);
    const center = idx => { const v = new THREE.Vector3(); idx.forEach(i => v.add(machines[i].pos)); return v.multiplyScalar(1 / idx.length); };
    eventTargets.ot_plc = t(new THREE.Vector3(12, 0, -25.5), lineIdx(1), 3.2);
    eventTargets.ot_remote = t(machines[1].pos, [1], 2.6);
    eventTargets.ot_stop = t(center(lineIdx(0)), lineIdx(0), 2.8);
    eventTargets.ot_malware = t(center(lineIdx(2)), lineIdx(2), 2.8);
    eventTargets.ot_network = t(new THREE.Vector3(12, 0, -20), lineIdx(1), 2.6);
  }
  function setMachinesBlocked(idx, blocked) {
    (idx || []).forEach(i => { const m = machines[i]; if (!m) return; m.panel.emissive.setHex(blocked ? COL.screenBad : COL.screenOk); m.beacon.emissive.setHex(blocked ? COL.screenBad : COL.screenOk); });
  }

  /* ---------- Marker & Effekte ---------- */
  function setMarker(id, kind) {
    const tgt = eventTargets[id]; if (!tgt) return;
    let m = markers.get(id);
    if (!m) { m = { sprite: null, kind: null, life: Infinity, base: tgt.pos.clone() }; markers.set(id, m); }
    if (m.sprite) scene.remove(m.sprite);
    m.sprite = iconSprite(kind); m.kind = kind; m.sprite.position.copy(m.base); scene.add(m.sprite);
    m.life = (kind === 'done' || kind === 'prevented') ? 7 : Infinity;
  }
  function beam(pos, color) {
    const geo = new THREE.CylinderGeometry(.55, .55, 12, 24, 1, true);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(pos.x, 6, pos.z); scene.add(mesh);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.6, .8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, .1, pos.z); scene.add(ring);
    beams.push({ mesh, ring, life: 1.6, max: 1.6 });
  }
  function bubble(pos, kind, life) {
    const sp = iconSprite(kind); sp.scale.set(1.1, 1.1, 1); sp.position.copy(pos); scene.add(sp);
    bubbles.push({ sprite: sp, life: life || 2.5 });
  }

  function setDesksBlocked(idx, blocked) {
    idx.forEach(i => { const d = desks[i]; if (!d.occupied) return; d.screen.emissive.setHex(blocked ? COL.screenBad : COL.screenOk); d.blocked = blocked; });
  }

  /* ---------- Techniker ---------- */
  function dispatchTech(eventId) {
    if (techs.some(t => t.eventId === eventId)) return;
    const tgt = eventTargets[eventId]; if (!tgt) return;
    const free = techs.find(t => t.state === 'idle');
    if (!free) { if (!waiting.includes(eventId)) waiting.push(eventId); return; }
    free.state = 'walking'; free.eventId = eventId;
    free.target = tgt.floor.clone().add(new THREE.Vector3(0.6, 0, 0.9));
  }
  function releaseTech(eventId) {
    const i = waiting.indexOf(eventId); if (i >= 0) waiting.splice(i, 1);
    techs.filter(t => t.eventId === eventId).forEach(t => { t.state = 'returning'; t.eventId = null; t.target = t.home.clone(); });
  }
  function moveTowards(obj, target, speed, dt) {
    const d = new THREE.Vector3().subVectors(target, obj.position); const dist = d.length();
    if (dist < .05) { obj.position.copy(target); return true; }
    const step = Math.min(dist, speed * dt); obj.position.add(d.multiplyScalar(step / dist));
    obj.rotation.y = Math.atan2(d.x, d.z);
    return false;
  }

  /* ---------- Licht & Tageszeit ---------- */
  function updateDaylight() {
    const t = (simMin - 7 * 60) / (19.5 * 60 - 7 * 60);  // 0..1
    const ang = Math.PI * (0.12 + 0.76 * t);              // Osten → Westen
    const elev = Math.sin(Math.PI * t) * 0.9 + 0.15;
    sun.position.set(Math.cos(ang) * 40, elev * 45, Math.sin(ang) * 20 + 10);
    const warm = new THREE.Color(0xffd2a1), day = new THREE.Color(0xffffff);
    const w = Math.pow(Math.abs(t - .5) * 2, 3);
    sun.color.copy(day).lerp(warm, w); sun.intensity = 0.55 + 0.75 * Math.sin(Math.PI * t);
    const skyDay = new THREE.Color(0xcfe3f5), skyEve = new THREE.Color(0xf2c9a7);
    const sky = skyDay.clone().lerp(skyEve, w);
    scene.background = sky; scene.fog.color.copy(sky);
    hemi.intensity = 0.55 + 0.35 * Math.sin(Math.PI * t);
  }

  /* ---------- Schleife ---------- */
  function animate() {
    requestAnimationFrame(animate);
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    const now = clock.elapsedTime;
    // Kamera
    cam.idle += dt;
    if (!cam.dragging && cam.idle > 4 && !focus) cam.theta += dt * 0.06;
    const desired = focus ? focus : new THREE.Vector3(0, 0.5, 0);
    cam.target.lerp(desired, dt * 2.2);
    const desiredR = focus ? 20 : cam.radiusWanted;
    cam.radius += (desiredR - cam.radius) * dt * 2.2;
    if (focus) { focusTimer -= dt; if (focusTimer <= 0) focus = null; }
    camera.position.set(
      cam.target.x + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
      cam.target.y + cam.radius * Math.cos(cam.phi),
      cam.target.z + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(cam.target);
    // Marker
    markers.forEach((m, id) => {
      if (!m.sprite) return;
      m.sprite.position.y = m.base.y + Math.sin(now * 2.2 + m.base.x) * .12;
      if (m.kind === 'alert') { const s = 1.6 + Math.sin(now * 5) * .15; m.sprite.scale.set(s, s, 1); }
      if (m.life !== Infinity) { m.life -= dt; if (m.life < 1.5) m.sprite.material.opacity = Math.max(0, m.life / 1.5); if (m.life <= 0) { scene.remove(m.sprite); m.sprite = null; } }
    });
    // Lichtsäulen
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]; b.life -= dt; const k = b.life / b.max;
      b.mesh.material.opacity = .35 * k; b.mesh.scale.set(1 + (1 - k) * .4, 1, 1 + (1 - k) * .4);
      b.ring.scale.setScalar(1 + (1 - k) * 3); b.ring.material.opacity = .8 * k;
      if (b.life <= 0) { scene.remove(b.mesh); scene.remove(b.ring); beams.splice(i, 1); }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]; b.life -= dt; b.sprite.position.y += dt * .25; if (b.life < 1) b.sprite.material.opacity = Math.max(0, b.life);
      if (b.life <= 0) { scene.remove(b.sprite); bubbles.splice(i, 1); }
    }
    // Techniker
    techs.forEach(t => {
      if (t.state === 'walking' && moveTowards(t.group, t.target, 3.2, dt)) t.state = 'busy';
      else if (t.state === 'returning' && moveTowards(t.group, t.target, 3.2, dt)) {
        t.state = 'idle'; t.group.rotation.y = 0;
        if (waiting.length) dispatchTech(waiting.shift());
      }
      if (t.state === 'busy') t.group.position.y = Math.abs(Math.sin(now * 6)) * .06;
    });
    // Drohne
    const dTarget = droneTarget || droneHome;
    drone.position.lerp(dTarget, dt * 2.5);
    drone.position.y = dTarget.y + Math.sin(now * 2) * .15;
    drone.rotation.y += dt * 1.5;
    if (droneTarget) { droneTimer -= dt; if (droneTimer <= 0) droneTarget = null; }
    // Server-LEDs
    if (Math.random() < dt * 8) { const r = racks[Math.floor(Math.random() * racks.length)]; const led = r.leds[Math.floor(Math.random() * r.leds.length)]; led.material.emissiveIntensity = led.material.emissiveIntensity > .5 ? .1 : 1; }
    // Jonas
    if (jonasFigure && jonasFigure.userData.walk) {
      if (moveTowards(jonasFigure, jonasFigure.userData.walk, 2.4, dt)) { jonasFigure.visible = false; jonasFigure.userData.walk = null; desks[7].person.visible = true; desks[7].occupied = true; desks[7].screen.emissive.setHex(COL.screenOk); }
    }
    renderer.render(scene, camera);
  }

  /* ---------- Eingabe ---------- */
  function bindInput() {
    const onDown = (x, y) => { cam.dragging = true; cam.lx = x; cam.ly = y; cam.idle = 0; };
    const onMove = (x, y) => { if (!cam.dragging) return; cam.theta -= (x - cam.lx) * .006; cam.phi = Math.max(.35, Math.min(1.35, cam.phi - (y - cam.ly) * .004)); cam.lx = x; cam.ly = y; cam.idle = 0; };
    const onUp = () => { cam.dragging = false; };
    canvas.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', e => { if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    canvas.addEventListener('touchmove', e => { if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    canvas.addEventListener('touchend', onUp);
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.radiusWanted = Math.max(12, Math.min(60, cam.radiusWanted + e.deltaY * .03)); cam.idle = 0; }, { passive: false });
    window.addEventListener('resize', resize);
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  /* ---------- Öffentliche Schnittstelle ---------- */
  S.init = function (canvasEl) {
    canvas = canvasEl;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe3f5, 60, 120);
    camera = new THREE.PerspectiveCamera(42, 1, .1, 300);
    cam.radiusWanted = 46;
    hemi = new THREE.HemisphereLight(0xdfeaf5, 0x8c9a8c, .8); scene.add(hemi);
    ambient = new THREE.AmbientLight(0xffffff, .15); scene.add(ambient);
    sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45; sun.shadow.bias = -0.0008;
    scene.add(sun); scene.add(sun.target);
    clock = new THREE.Clock();
    build(); bindInput(); resize(); updateDaylight();
    running = true; animate();
  };
  S.setRunning = function (on) { running = on; if (on) { clock.getDelta(); resize(); } };
  S.setTime = function (min) { simMin = min; updateDaylight(); };
  S.setFollow = function (on) { follow = on; if (!on) focus = null; };
  S.focusEvent = function (id, seconds) { const t = eventTargets[id]; if (!t) return; focus = t.pos.clone().setY(1); focusTimer = seconds || 6; cam.idle = 0; };
  S.reset = function () {
    markers.forEach(m => { if (m.sprite) scene.remove(m.sprite); }); markers.clear();
    beams.forEach(b => { scene.remove(b.mesh); scene.remove(b.ring); }); beams.length = 0;
    bubbles.forEach(b => scene.remove(b.sprite)); bubbles.length = 0;
    waiting.length = 0;
    techs.forEach(t => { t.state = 'idle'; t.eventId = null; t.group.position.copy(t.home); t.group.rotation.y = 0; });
    droneTarget = null; drone.position.copy(droneHome);
    machines.forEach(m => { m.panel.emissive.setHex(COL.screenOk); m.beacon.emissive.setHex(COL.screenOk); });
    desks.forEach((d, i) => { d.blocked = false; d.person.visible = i !== 7; d.occupied = i !== 7; d.screen.emissive.setHex(i === 7 ? COL.screenOff : COL.screenOk); });
    if (jonasFigure) { jonasFigure.visible = true; jonasFigure.position.copy(entrancePos); jonasFigure.position.x -= 1; jonasFigure.userData.walk = null; }
    S.setTickets(0); focus = null;
  };
  S.setOt = function (on) { if (hall) hall.visible = !!on; cam.radiusWanted = on ? 54 : 46; };
  S.eventStart = function (id, blocked) {
    setMarker(id, blocked ? 'alert' : 'work');
    const t = eventTargets[id]; if (blocked && t) { setDesksBlocked(t.desks, true); setMachinesBlocked(t.machines, true); }
    if (follow) S.focusEvent(id, 5);
  };
  S.eventStep = function (id, actor, blocked) {
    const t = eventTargets[id]; if (!t) return;
    if (actor === 'sd' || actor === 'tech') { dispatchTech(id); setMarker(id, blocked ? 'alert' : 'work'); }
    else if (actor === 'sys') { beam(t.floor, COL.auto); if (!markers.get(id) || markers.get(id).kind !== 'alert') setMarker(id, 'work'); }
    else if (actor === 'ai') { droneTarget = t.pos.clone().add(new THREE.Vector3(0, 1.6, 0)); droneTimer = 3.5; }
    else if (actor === 'mgr') { bubble(serviceDeskPos.clone().setY(2.4), 'approve', 3); }
    else if (actor === 'ma') { bubble(t.pos.clone().add(new THREE.Vector3(.9, .6, 0)), 'user', 2.5); }
    if (id === 'onboarding' && actor === 'ma' && jonasFigure && jonasFigure.visible) jonasFigure.userData.walk = desks[7].pos.clone().add(new THREE.Vector3(0, 0, 1.4));
  };
  S.eventFinish = function (id, outcome) {
    const t = eventTargets[id]; if (!t) return;
    setMarker(id, outcome === 'prevented' ? 'prevented' : 'done');
    setDesksBlocked(t.desks, false); setMachinesBlocked(t.machines, false);
    releaseTech(id);
    if (id === 'onboarding' && jonasFigure && jonasFigure.visible && !jonasFigure.userData.walk) jonasFigure.userData.walk = desks[7].pos.clone().add(new THREE.Vector3(0, 0, 1.4));
    if (id === 'offboarding' && claudiaDesk) { claudiaDesk.person.visible = false; claudiaDesk.occupied = false; claudiaDesk.screen.emissive.setHex(COL.screenOff); }
  };
  S.setBlocked = function (id, blocked) {
    const t = eventTargets[id]; if (!t) return;
    setDesksBlocked(t.desks, blocked); setMachinesBlocked(t.machines, blocked);
    const m = markers.get(id);
    if (m && m.life === Infinity) { const want = blocked ? 'alert' : 'work'; if (m.kind !== want) setMarker(id, want); }
  };
  S.setTickets = function (n) {
    while (ticketCubes.length < n) {
      const i = ticketCubes.length;
      const c = box(.42, .22, .32, COL.ticket); c.position.set(3.6 + (i % 2) * .5, .15 + Math.floor(i / 2) * .26, -8.4); scene.add(c); ticketCubes.push(c);
    }
    while (ticketCubes.length > n) scene.remove(ticketCubes.pop());
  };
  S.setDayEnd = function () { /* Techniker gehen zurück, Marker bleiben */ techs.forEach(t => { if (t.state !== 'idle') { t.state = 'returning'; t.eventId = null; t.target = t.home.clone(); } }); waiting.length = 0; };
  return S;
})();
