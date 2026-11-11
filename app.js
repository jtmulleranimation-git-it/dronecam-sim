import * as THREE from '../vendor/three.module.min.js';
import { DroneCameraPawn } from './drone.js';
import { buildWorld, toThree } from './world.js';
import { Input, attachTouchSticks } from './input.js';
import { loadTuning, saveTuning, resetTuning, getPath, setPath, MODES, FPV_CAMERAS, PLUGIN_VERSION, APP_VERSION } from './tuning.js';

const $ = id => document.getElementById(id);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
const world = buildWorld(scene);

// ---------- drone ----------
let tuning = loadTuning();
const flashEl = $('flash'); let flashTimer = 0;
function flash(msg, color = 'yellow') {
  flashEl.textContent = msg; flashEl.className = `flash show ${color}`;
  clearTimeout(flashTimer); flashTimer = setTimeout(() => flashEl.classList.remove('show'), 2500);
}
let drone = new DroneCameraPawn(tuning, world, flash);
let saveTimer = 0;
const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveTuning(tuning), 400); };
drone.onTuningChanged = () => { scheduleSave(); renderSettings(); };

function applyFov() {
  const C = tuning.Camera, aspect = innerWidth / innerHeight;
  const hfov = 2 * Math.atan(C.SensorWidth / 2 / C.CurrentFocalLength);
  camera.fov = 2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180 / Math.PI;
  camera.aspect = aspect; camera.updateProjectionMatrix();
  return hfov * 180 / Math.PI;
}
applyFov();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); applyFov(); });

// ---------- input ----------
const input = new Input();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) attachTouchSticks($('touch'), input);

// ---------- settings panel ----------
const FIELDS = [
  ['Controls', [
    ['StickLayout', 'Stick layout', { options: [['Game', 'Game (left stick moves)'], ['Mode2', 'Drone Mode 2']] }],
    ['bInvertCameraTilt', 'Invert camera tilt'],
    ['StickDeadzone', 'Stick deadzone', [0, 0.3, 0.01]],
  ]],
  ['Camera', [
    ['Camera.CurrentFocalLength', 'Focal length (mm, 4/3 sensor)', [4, 35, 0.1]],
    ['CameraFeel.TurnSmoothing', 'Turn smoothing (s)', [0, 0.6, 0.01]],
    ['CameraFeel.TiltSmoothing', 'Tilt smoothing (s)', [0, 0.6, 0.01]],
    ['CameraFeel.FPVCameraSmoothing', 'FPV camera smoothing (s)', [0, 0.3, 0.01]],
  ]],
  ['FPV', [
    ['FPV.bSelfLevel', 'Self-level (Angle mode)'],
    ['FPV.CameraMode', 'FPV camera', { options: [['Stabilized', 'Stabilized'], ['HorizonLock', 'Horizon Lock'], ['Body', 'Body (classic FPV)']] }],
    ['FPV.bCameraDoesFlips', 'Camera rides flips'],
    ['FPV.CameraUptiltDeg', 'Camera uptilt (°)', [0, 60, 1]],
    ['FPV.CameraBankFollow', 'Camera bank follow', [0, 1, 0.05]],
    ['FPV.CameraPitchFollow', 'Camera pitch follow', [0, 1, 0.05]],
    ['FPV.MaxTiltDeg', 'Max tilt, self-level (°)', [10, 80, 1]],
    ['FPV.MaxRollPitchRate', 'Roll / pitch rate (°/s)', [100, 1200, 10]],
    ['FPV.MaxYawRate', 'Yaw rate (°/s)', [60, 800, 10]],
    ['FPV.RateExpo', 'Rate expo', [0, 1, 0.05]],
    ['FPV.ThrustToWeight', 'Thrust to weight', [1.2, 12, 0.1]],
    ['FPV.Drag', 'Drag (1/s)', [0.05, 1.5, 0.01]],
    ['FPV.DivePower', 'Dive power (g)', [0, 6, 0.1]],
    ['FPV.BankToTurn', 'Bank to turn', [0, 2, 0.05]],
    ['FPV.TurnBank', 'Turn bank', [0, 3, 0.05]],
    ['FPV.FlipDuration', 'Flip duration (s)', [0.15, 2, 0.05]],
  ]],
];
function renderSettings() {
  const box = $('fields'); if (!box) return; box.innerHTML = '';
  for (const [group, list] of FIELDS) {
    const h = document.createElement('h3'); h.textContent = group; box.appendChild(h);
    for (const [path, label, spec] of list) {
      const row = document.createElement('label'); row.className = 'row';
      const name = document.createElement('span'); name.textContent = label; row.appendChild(name);
      const val = getPath(tuning, path);
      let el;
      if (typeof val === 'boolean') {
        el = document.createElement('input'); el.type = 'checkbox'; el.checked = val;
        el.onchange = () => { setPath(tuning, path, el.checked); scheduleSave(); };
      } else if (spec && spec.options) {
        el = document.createElement('select');
        for (const [v, t] of spec.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; el.appendChild(o); }
        el.onchange = () => { setPath(tuning, path, el.value); scheduleSave(); };
      } else {
        const [mn, mx, st] = spec; el = document.createElement('span'); el.className = 'slider';
        const r = document.createElement('input'); r.type = 'range'; r.min = mn; r.max = mx; r.step = st; r.value = val;
        const out = document.createElement('output'); out.textContent = (+val).toFixed(st < 0.1 ? 2 : st < 1 ? 1 : 0);
        r.oninput = () => { setPath(tuning, path, +r.value); out.textContent = (+r.value).toFixed(st < 0.1 ? 2 : st < 1 ? 1 : 0); if (path.startsWith('Camera.')) applyFov(); scheduleSave(); };
        el.append(r, out);
      }
      row.appendChild(el); box.appendChild(row);
    }
  }
  const d = $('dials');
  if (d) d.innerHTML = ['CineLimits', 'NormalLimits', 'SportLimits', 'FPV'].map(k => {
    const o = tuning[k]; return `<tr><td>${k.replace('Limits', '')}</td><td>x${o.AccelMultiplier.toFixed(2)}</td><td>x${o.SpeedMultiplier.toFixed(2)}</td><td>x${o.TurnMultiplier.toFixed(2)}</td></tr>`;
  }).join('');
}
let paused = false;
function openPanel(id) { paused = true; for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id; $('overlay').hidden = false; if (id === 'settings') renderSettings(); }
function closePanels() { paused = false; $('overlay').hidden = true; }
$('btnSettings').onclick = () => openPanel('settings');
$('btnHelp').onclick = () => openPanel('help');
for (const b of document.querySelectorAll('[data-close]')) b.onclick = closePanels;
$('resetDials').onclick = () => { for (const k of ['CineLimits', 'NormalLimits', 'SportLimits', 'FPV']) Object.assign(tuning[k], { AccelMultiplier: 1, SpeedMultiplier: 1, TurnMultiplier: 1 }); scheduleSave(); renderSettings(); };
$('resetAll').onclick = () => {
  const mode = drone.FlightMode; const fresh = resetTuning();
  for (const k of Object.keys(fresh)) tuning[k] = fresh[k];
  drone.SetFlightMode(mode); applyFov(); renderSettings(); flash('Tuning reset to DroneCam plugin defaults', 'cyan');
};
$('copyTuning').onclick = async () => {
  const txt = JSON.stringify(tuning, null, 2);
  try { await navigator.clipboard.writeText(txt); flash('Tuning copied as JSON', 'cyan'); } catch (e) { $('tuningOut').value = txt; $('tuningOut').hidden = false; }
};
$('ver').textContent = `App ${APP_VERSION} · matches DroneCam plugin ${PLUGIN_VERSION}`;
addEventListener('keydown', e => { if (e.code === 'Escape') { $('overlay').hidden ? openPanel('settings') : closePanels(); } });
$('start').onclick = async () => {
  $('intro').hidden = true;
  try { await navigator.wakeLock?.request('screen'); } catch (e) { /* not available */ }
};

// ---------- HUD ----------
const hud = { l1: $('hud1'), l2: $('hud2'), l3: $('hud3'), trick: $('trick'), pad: $('pad'), fence: $('fence') };
function updateHud() {
  const h = drone.HudState();
  $('hudwrap').hidden = !drone.bShowHUD;
  hud.l1.textContent = `${h.mode}   H ${h.hSpeed.toFixed(1)} m/s   V ${h.vSpeed >= 0 ? '+' : ''}${h.vSpeed.toFixed(1)} m/s   ALT ${h.alt.toFixed(1)} m   DIST ${h.dist.toFixed(0)} m`;
  hud.l2.textContent = drone.isFPV
    ? `HDG ${String(Math.round(h.heading)).padStart(3, '0')}   SPEED ${h.speedKmh.toFixed(0)} km/h   cam: ${h.fpvCam === 'HorizonLock' ? 'Horizon Lock' : h.fpvCam}   sticks: ${h.layout === 'Game' ? 'Game' : 'Mode 2'}`
    : `HDG ${String(Math.round(h.heading)).padStart(3, '0')}   GIMBAL ${h.gimbal.toFixed(0)}°   sticks: ${h.layout === 'Game' ? 'Game' : 'Mode 2'}`;
  hud.l3.textContent = `ACCEL x${h.accel.toFixed(2)}   SPEED x${h.speedDial.toFixed(2)}   TURN x${h.turn.toFixed(2)}   DUTCH ${h.dutch >= 0 ? '+' : ''}${h.dutch.toFixed(0)}°`;
  hud.trick.textContent = h.trick;
  hud.fence.hidden = !h.nearFence;
  hud.pad.textContent = input.padConnected ? '🎮 Controller connected' : (isTouch ? '🎮 No controller: pair one in Settings › Bluetooth, then press any button' : '🎮 No controller: press any button on it (keyboard works too)');
  hud.pad.className = input.padConnected ? 'pad ok' : 'pad';
  document.body.classList.toggle('haspad', input.padConnected);
}

// ---------- loop ----------
let last = performance.now();
const tFwd = new THREE.Vector3(), tUp = new THREE.Vector3();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (window.__sim && window.__sim.manual) { renderView(); requestAnimationFrame(frame); return; } // automated tests step the sim themselves
  input.update();
  if (!paused && $('intro').hidden) drone.Tick(input, dt);
  else if (!$('intro').hidden && input.anyActivity() && input.padConnected) $('start').click();
  renderView();
  requestAnimationFrame(frame);
}
function renderView() {
  const c = drone.CameraTransform();
  camera.position.copy(toThree(c.loc.x, c.loc.y, c.loc.z));
  tFwd.copy(toThree(c.fwd.x, c.fwd.y, c.fwd.z)); tUp.copy(toThree(c.up.x, c.up.y, c.up.z));
  camera.up.copy(tUp); camera.lookAt(camera.position.clone().add(tFwd));
  renderer.render(scene, camera);
  updateHud();
}
requestAnimationFrame(frame);

// test hook (used by the automated checks)
window.__sim = {
  drone, input, tuning, world, manual: false,
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { input.update(); drone.Tick(input, dt); } renderView(); },
};

// ---------- offline ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
