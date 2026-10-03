import * as fb from './firebase.js';

const $ = (id) => document.getElementById(id);
const roomId = (new URLSearchParams(location.search).get('r') || '').toUpperCase();

let maps = [];
let currentMapId;
let isHost = false;

$('room-code').textContent = roomId || '------';
document.title = `ห้อง ${roomId} · Aniimo Egg Map`;

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

const shareUrl = new URL('room.html?r=' + roomId, location.href).href;
$('copy-link').addEventListener('click', async () => {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    navigator.share({ title: `ห้อง ${roomId}`, url: shareUrl }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    toast('คัดลอกลิ้งแชร์แล้ว');
  } catch {
    prompt('คัดลอกลิ้งนี้:', shareUrl);
  }
});

// ---------- map viewer (pan / zoom) ----------
const stage = $('stage');
const img = $('map-img');
const view = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function apply() {
  img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function fit() {
  if (!img.naturalWidth) return;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  view.scale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  view.x = (sw - img.naturalWidth * view.scale) / 2;
  view.y = (sh - img.naturalHeight * view.scale) / 2;
  apply();
}

function zoomAt(factor, cx, cy) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const f = next / view.scale;
  view.x = cx - (cx - view.x) * f;
  view.y = cy - (cy - view.y) * f;
  view.scale = next;
  apply();
}

const center = () => [stage.clientWidth / 2, stage.clientHeight / 2];
$('zoom-in').addEventListener('click', () => zoomAt(1.3, ...center()));
$('zoom-out').addEventListener('click', () => zoomAt(1 / 1.3, ...center()));
$('zoom-fit').addEventListener('click', fit);
for (const id of ['zoom-in', 'zoom-out', 'zoom-fit']) {
  $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

stage.addEventListener('dblclick', (e) => {
  const r = stage.getBoundingClientRect();
  zoomAt(2, e.clientX - r.left, e.clientY - r.top);
});

const pointers = new Map();
let pinchDist = 0;
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stage.classList.add('dragging');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
stage.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    view.x += cur.x - prev.x;
    view.y += cur.y - prev.y;
    apply();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const r = stage.getBoundingClientRect();
    if (pinchDist) zoomAt(dist / pinchDist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    pinchDist = dist;
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) stage.classList.remove('dragging');
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

let lastSize = '';
new ResizeObserver(() => {
  const size = stage.clientWidth + 'x' + stage.clientHeight;
  if (size !== lastSize) { lastSize = size; fit(); }
}).observe(stage);

img.addEventListener('load', () => {
  img.hidden = false;
  $('empty').hidden = true;
  fit();
});

// ---------- render ----------
function showMap(mapId) {
  if (mapId === currentMapId) return;
  currentMapId = mapId;
  const map = maps.find((m) => m.id === mapId);
  for (const el of document.querySelectorAll('.thumb')) {
    el.classList.toggle('active', el.dataset.id === mapId);
  }
  if (!map) {
    img.hidden = true;
    $('stage-title').hidden = true;
    showMessage(isHost ? 'เลือกแมพด้านบน' : 'รอหัวหน้าห้องเลือกแมพ…');
    return;
  }
  $('stage-title').textContent = map.name;
  $('stage-title').hidden = false;
  img.alt = map.name;
  img.src = map.url;
}

function showMessage(html) {
  $('empty').hidden = false;
  $('empty').innerHTML = html;
}

function renderPicker() {
  const picker = $('picker');
  picker.innerHTML = '';
  for (const m of maps) {
    const b = document.createElement('button');
    b.className = 'thumb' + (m.id === currentMapId ? ' active' : '');
    b.dataset.id = m.id;
    b.innerHTML = `<img alt="" loading="lazy"><span></span>`;
    b.querySelector('img').src = m.url;
    b.querySelector('span').textContent = m.name;
    b.addEventListener('click', () => selectMap(m.id));
    picker.appendChild(b);
  }
}

function setHost(host) {
  if (host === isHost && $('role').dataset.ready) return;
  $('role').dataset.ready = '1';
  isHost = host;
  $('role').textContent = host ? 'หัวหน้าห้อง' : 'ผู้ชม';
  $('role').classList.toggle('host', host);
  $('picker').hidden = !host;
  $('viewer-note').hidden = host;
}

async function selectMap(mapId) {
  if (!isHost || mapId === currentMapId) return;
  const prev = currentMapId;
  showMap(mapId); // optimistic
  try {
    await fb.setRoomMap(roomId, mapId);
  } catch (e) {
    console.error(e);
    toast('เปลี่ยนแมพไม่สำเร็จ');
    showMap(prev);
  }
}

function roomGone() {
  $('status-text').textContent = 'ไม่พบห้อง';
  img.hidden = true;
  $('stage-title').hidden = true;
  $('picker').hidden = true;
  $('viewer-note').hidden = true;
  showMessage('ไม่พบห้องนี้<br><br><a class="btn primary" href="./">สร้างห้องใหม่</a>');
}

// ---------- realtime ----------
async function init() {
  if (!fb.configured) return showMessage('ยังไม่ได้ตั้งค่า Firebase (แก้ไฟล์ firebase-config.js ตามขั้นตอนใน README)');
  if (!fb.ROOM_ID_RE.test(roomId)) return roomGone();

  const [loadedMaps, user] = await Promise.all([fb.loadMaps(), fb.ensureUser()]);
  maps = loadedMaps;
  renderPicker();

  fb.watchConnection((online) => {
    $('status').classList.toggle('online', online);
    $('status-text').textContent = online ? 'เชื่อมต่อแล้ว' : 'กำลังเชื่อมต่อ…';
  });

  let joined = false;
  fb.watchRoom(roomId, (room) => {
    if (!room) return roomGone();
    setHost(room.host === user.uid);
    showMap(room.mapId);
    if (!joined) {
      joined = true;
      fb.joinPresence(roomId, user.uid, (n) => { $('viewers').textContent = '👥 ' + n; });
    }
  }, (e) => {
    console.error(e);
    showMessage('โหลดห้องไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง');
  });
}

init().catch((e) => {
  console.error(e);
  showMessage('โหลดไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง');
});
