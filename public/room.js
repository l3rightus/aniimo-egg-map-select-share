import * as fb from './firebase.js?v=dev';

const $ = (id) => document.getElementById(id);
const roomId = (new URLSearchParams(location.search).get('r') || '').toUpperCase();

const PING_MS = 4000;
const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 6;
const MARK_HIT_PX = 18;
const MARK_COLORS = ['#ff3b30', '#ffcc00', '#0a84ff', '#bf5af2'];
const USER_COLORS = ['#ff9f0a', '#30d158', '#64d2ff', '#ff375f', '#bf5af2', '#ffd60a', '#0a84ff', '#ac8e68'];

let maps = [];
let currentMapId;
let isHost = false;
let me = null; // uid ของเรา
let myName = '';
let room = null;
let members = [];
let membersLoaded = false;
let presence = null;
let mode = 'pan'; // pan | check | x | num
let markColor = MARK_COLORS[0];
let serverOffset = 0;

$('room-code').textContent = roomId || '------';
document.title = `ห้อง ${roomId} · Aniimo Egg Map`;

function userColor(uid) {
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

const serverNow = () => Date.now() + serverOffset;

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
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
const overlay = $('marks');
const view = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function apply() {
  img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  positionOverlay();
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

/** พิกัด 0..1 บนรูป → พิกัดจอ (เทียบกับ stage) */
function toScreen(p) {
  return [view.x + p.x * img.naturalWidth * view.scale, view.y + p.y * img.naturalHeight * view.scale];
}

/** พิกัดจอ → พิกัด 0..1 บนรูป (null ถ้าอยู่นอกรูป) */
function toImage(sx, sy) {
  if (img.hidden || !img.naturalWidth) return null;
  const x = (sx - view.x) / view.scale / img.naturalWidth;
  const y = (sy - view.y) / view.scale / img.naturalHeight;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

const center = () => [stage.clientWidth / 2, stage.clientHeight / 2];
$('zoom-in').addEventListener('click', () => zoomAt(1.3, ...center()));
$('zoom-out').addEventListener('click', () => zoomAt(1 / 1.3, ...center()));
$('zoom-fit').addEventListener('click', fit);
for (const el of document.querySelectorAll('.zoom-controls, .tools')) {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('dblclick', (e) => e.stopPropagation());
  el.addEventListener('contextmenu', (e) => e.stopPropagation());
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

stage.addEventListener('dblclick', (e) => {
  if (mode !== 'pan') return;
  const r = stage.getBoundingClientRect();
  zoomAt(2, e.clientX - r.left, e.clientY - r.top);
});

// ---------- pointer: ลาก / pinch / แตะ / แตะค้าง ----------
const pointers = new Map();
let pinchDist = 0;
let tap = null; // แตะครั้งเดียวที่ยังไม่ขยับเกิน TAP_SLOP_PX
let pressTimer = 0;
let lastPointerType = 'mouse';

const local = (e) => {
  const r = stage.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

stage.addEventListener('pointerdown', (e) => {
  lastPointerType = e.pointerType;
  if (e.button !== 0) return; // คลิกขวา → ใช้ contextmenu
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stage.classList.add('dragging');
  clearTimeout(pressTimer);
  if (pointers.size === 1) {
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const [sx, sy] = local(e);
    pressTimer = setTimeout(() => {
      if (!tap) return;
      tap = null; // แตะค้างแล้ว ไม่นับเป็นแตะ
      sendPing(sx, sy);
    }, LONG_PRESS_MS);
  } else {
    tap = null;
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

stage.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (tap && Math.hypot(cur.x - tap.x, cur.y - tap.y) > TAP_SLOP_PX) {
    tap = null;
    clearTimeout(pressTimer);
  }
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
  if (!pointers.has(e.pointerId)) return;
  clearTimeout(pressTimer);
  if (e.type === 'pointerup' && tap && tap.id === e.pointerId && pointers.size === 1) {
    handleTap(...local(e));
  }
  tap = null;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) stage.classList.remove('dragging');
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// คลิกขวาบนคอม = ping (บนมือถือใช้แตะค้าง ซึ่งจัดการด้านบนแล้ว)
stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (lastPointerType === 'mouse') sendPing(...local(e));
});

let lastSize = '';
new ResizeObserver(() => {
  const size = stage.clientWidth + 'x' + stage.clientHeight;
  if (size !== lastSize) { lastSize = size; fit(); }
}).observe(stage);

function onImageReady() {
  img.hidden = false;
  overlay.hidden = false;
  $('empty').hidden = true;
  fit();
  renderOverlay();
}
img.addEventListener('load', onImageReady);
img.addEventListener('error', () => {
  img.hidden = true;
  overlay.hidden = true;
  showMessage('โหลดรูปแมพไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง');
});

// ---------- เครื่องมือ ----------
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('.tool[data-mode]')) {
    b.classList.toggle('active', b.dataset.mode === m);
    b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  }
  stage.classList.toggle('marking', m !== 'pan');
}

for (const b of document.querySelectorAll('.tool[data-mode]')) {
  b.addEventListener('click', () => {
    setMode(b.dataset.mode);
    if (b.dataset.mode === 'check') toast('แตะจุดที่เก็บแล้วเพื่อติ๊ก ✓ แตะติ๊กของตัวเองอีกครั้งเพื่อลบ');
    else if (b.dataset.mode === 'x') toast('แตะแมพเพื่อวางกากบาท แตะมาร์กเดิมเพื่อลบ');
    else if (b.dataset.mode === 'num') toast('แตะแมพเพื่อวางเลขลำดับ 1, 2, 3…');
  });
}

for (const c of MARK_COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch' + (c === markColor ? ' active' : '');
  b.style.setProperty('--c', c);
  b.title = 'สีมาร์ก';
  b.setAttribute('aria-label', 'สีมาร์ก ' + c);
  b.addEventListener('click', () => {
    markColor = c;
    for (const s of document.querySelectorAll('.swatch')) s.classList.toggle('active', s === b);
    if (mode !== 'x' && mode !== 'num') setMode('x');
  });
  $('colors').appendChild(b);
}

$('mark-clear').addEventListener('click', () => {
  if (!Object.keys(currentMarks()).length) return;
  if (!confirm('ลบมาร์กและติ๊กทั้งหมดในแมพนี้?')) return;
  fb.clearMarks(roomId, currentMapId).catch(() => toast('ลบไม่สำเร็จ'));
});

$('reset-round').addEventListener('click', () => {
  if (!confirm('เริ่มรอบใหม่? มาร์กและติ๊กของทุกแมพจะถูกลบทั้งหมด')) return;
  fb.resetRound(roomId).then(() => toast('เริ่มรอบใหม่แล้ว')).catch(() => toast('รีเซ็ตไม่สำเร็จ'));
});

// ---------- มาร์ก / ติ๊ก / ping ----------
const currentMarks = () => room?.marks?.[currentMapId] || {};
const kindOf = (m) => m.kind || 'x'; // มาร์กจากเวอร์ชันก่อนไม่มี kind

function handleTap(sx, sy) {
  if (mode === 'pan' || !currentMapId) return;
  // แตะโดนมาร์กเดิม → ลบ (ถ้ามีสิทธิ์)
  let hit = null;
  let best = MARK_HIT_PX;
  for (const [id, m] of Object.entries(currentMarks())) {
    const [mx, my] = toScreen(m);
    const d = Math.hypot(mx - sx, my - sy);
    if (d <= best) { best = d; hit = [id, m]; }
  }
  if (hit) {
    const [id, m] = hit;
    const mine = kindOf(m) === 'check' && m.by === me;
    if (!isHost && !mine) return toast('ลบได้เฉพาะติ๊กของตัวเอง');
    fb.removeMark(roomId, currentMapId, id).catch(() => toast('ลบไม่สำเร็จ'));
    return;
  }

  const p = toImage(sx, sy);
  if (!p) return;
  let mark;
  if (mode === 'check') {
    mark = { ...p, kind: 'check', by: me, name: myName };
  } else if (isHost && mode === 'x') {
    mark = { ...p, kind: 'x', color: markColor, by: me };
  } else if (isHost && mode === 'num') {
    const used = Object.values(currentMarks()).filter((m) => m.kind === 'num').map((m) => m.n);
    mark = { ...p, kind: 'num', n: Math.min(999, Math.max(0, ...used) + 1), color: markColor, by: me };
  } else {
    return;
  }
  fb.addMark(roomId, currentMapId, mark).catch(() => toast('บันทึกไม่สำเร็จ'));
}

let lastPingAt = 0;
function sendPing(sx, sy) {
  const p = toImage(sx, sy);
  if (!p || !currentMapId) return;
  if (Date.now() - lastPingAt < 800) return;
  lastPingAt = Date.now();
  if (navigator.vibrate) navigator.vibrate(30);
  fb.addPing(roomId, { ...p, mapId: currentMapId, by: me, name: myName }, PING_MS).catch(() => toast('ping ไม่สำเร็จ'));
}

// ---------- วาดมาร์กบนแมพ (อัปเดตเฉพาะที่เปลี่ยน เพื่อไม่ให้แอนิเมชัน ping เริ่มใหม่) ----------
const overlayEls = new Map();
let pingTimer = 0;

const DOOR_COLORS = { blue: '#4da3ff', orange: '#ff9f1a' };

function buildEl(item) {
  const el = document.createElement('div');
  if (item.type === 'door') {
    el.className = 'door';
    el.style.setProperty('--c', DOOR_COLORS[item.color] || item.color);
    return el;
  }
  if (item.type === 'ping') {
    el.className = 'ping';
    el.style.setProperty('--c', userColor(item.by));
    el.innerHTML = '<span class="ring"></span><span class="ring r2"></span><span class="tag"></span>';
    el.querySelector('.tag').textContent = item.name || '';
    return el;
  }
  const kind = kindOf(item);
  el.className = 'mark mark-' + kind;
  if (kind === 'x') {
    el.style.setProperty('--c', item.color || MARK_COLORS[0]);
  } else if (kind === 'num') {
    el.style.setProperty('--c', item.color || MARK_COLORS[0]);
    el.textContent = item.n;
  } else {
    el.style.setProperty('--c', userColor(item.by));
    el.innerHTML = '<span class="tick">✓</span><span class="tag"></span>';
    el.querySelector('.tag').textContent = item.name || '';
  }
  return el;
}

function renderOverlay() {
  const items = new Map();
  // กรอบห้องประตู (ข้อมูลคงที่จาก maps.json) วาดก่อนเพื่อให้อยู่ใต้มาร์ก
  const doors = maps.find((m) => m.id === currentMapId)?.doors || [];
  doors.forEach((d, i) => items.set(`d:${currentMapId}:${i}`, { ...d, type: 'door' }));
  for (const [id, m] of Object.entries(currentMarks())) items.set(`m:${currentMapId}:${id}`, m);

  const now = serverNow();
  let nextExpiry = Infinity;
  for (const [id, p] of Object.entries(room?.pings || {})) {
    const left = PING_MS - (now - p.at);
    if (p.mapId !== currentMapId || left <= 0) continue;
    items.set(`p:${id}`, { ...p, type: 'ping' });
    nextExpiry = Math.min(nextExpiry, left);
  }

  for (const [key, el] of overlayEls) {
    if (!items.has(key)) { el.remove(); overlayEls.delete(key); }
  }
  for (const [key, item] of items) {
    let el = overlayEls.get(key);
    if (!el) {
      el = buildEl(item);
      overlayEls.set(key, el);
      if (item.type === 'door') overlay.prepend(el);
      else overlay.appendChild(el);
    }
    el._pos = item;
  }
  positionOverlay();

  $('mark-clear').disabled = Object.keys(currentMarks()).length === 0;

  clearTimeout(pingTimer);
  if (nextExpiry !== Infinity) pingTimer = setTimeout(renderOverlay, nextExpiry + 50);
}

function positionOverlay() {
  if (!img.naturalWidth) return;
  for (const el of overlayEls.values()) {
    const [sx, sy] = toScreen(el._pos);
    el.style.transform = `translate(${sx}px, ${sy}px)`;
    if (el._pos.type === 'door') {
      el.style.width = el._pos.w * img.naturalWidth * view.scale + 'px';
      el.style.height = el._pos.h * img.naturalHeight * view.scale + 'px';
    }
  }
}

// ---------- แมพ / หัวหน้า ----------
function showMap(mapId) {
  if (mapId === currentMapId) return;
  currentMapId = mapId;
  overlay.hidden = true; // ซ่อนไว้จนกว่ารูปแมพใหม่จะโหลดเสร็จ
  renderOverlay();
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
  // ถ้ารูปอยู่ใน cache แล้ว (เช่นสลับแมพไปมาเร็ว ๆ) เบราว์เซอร์อาจไม่ยิง load ซ้ำ
  if (img.complete && img.naturalWidth) onImageReady();
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
  const changed = host !== isHost;
  isHost = host;
  $('role').textContent = host ? 'หัวหน้าห้อง' : 'ผู้ชม';
  $('role').classList.toggle('host', host);
  $('picker').hidden = !host;
  $('viewer-note').hidden = host;
  for (const el of document.querySelectorAll('.host-only')) el.hidden = !host;
  if (!host && (mode === 'x' || mode === 'num')) setMode('pan');
  if (changed && $('role').dataset.ready) toast(host ? 'คุณเป็นหัวหน้าห้องแล้ว 👑' : 'คุณไม่ได้เป็นหัวหน้าห้องแล้ว');
  $('role').dataset.ready = '1';
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
  $('tools').hidden = true;
  $('claim-bar').hidden = true;
  overlay.hidden = true;
  showMessage('ไม่พบห้องนี้<br><br><a class="btn primary" href="./">สร้างห้องใหม่</a>');
}

// ---------- คนในห้อง ----------
function renderMembers() {
  $('viewers').textContent = '👥 ' + members.length;
  const list = $('members-list');
  list.replaceChildren();
  const sorted = [...members].sort((a, b) => (b.uid === room?.host) - (a.uid === room?.host) || a.name.localeCompare(b.name));
  for (const m of sorted) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dot-c"></span><span class="m-name"></span><span class="m-extra"></span>';
    li.querySelector('.dot-c').style.background = userColor(m.uid);
    li.querySelector('.m-name').textContent = m.name || 'ไม่มีชื่อ';
    const extra = li.querySelector('.m-extra');
    if (m.uid === room?.host) extra.append('👑 ');
    if (m.uid === me) extra.append('(คุณ)');
    if (isHost && m.uid !== me) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = 'ให้เป็นหัวหน้า';
      b.addEventListener('click', async () => {
        if (!confirm(`ให้ ${m.name} เป็นหัวหน้าห้อง? คุณจะเปลี่ยนแมพและวางมาร์กไม่ได้อีก`)) return;
        try {
          await fb.transferHost(roomId, m.uid);
        } catch {
          toast('โอนไม่สำเร็จ (คนนั้นอาจออกจากห้องไปแล้ว)');
        }
      });
      li.appendChild(b);
    }
    list.appendChild(li);
  }
  updateClaimBar();
}

function updateClaimBar() {
  const hostOnline = members.some((m) => m.uid === room?.host);
  const imIn = members.some((m) => m.uid === me);
  $('claim-bar').hidden = !(room && membersLoaded && !isHost && !hostOnline && imIn);
}

$('viewers').addEventListener('click', () => { renderMembers(); $('members-dialog').showModal(); });

$('claim-host').addEventListener('click', async () => {
  try {
    await fb.claimHost(roomId, me);
  } catch {
    toast('รับตำแหน่งไม่สำเร็จ (หัวหน้าอาจกลับมาแล้ว)');
  }
});

// ---------- ชื่อเล่น ----------
function loadName() {
  try { return localStorage.getItem('nickname') || ''; } catch { return ''; }
}
function saveName(n) {
  try { localStorage.setItem('nickname', n); } catch {}
}

function askName(initial) {
  const dlg = $('name-dialog');
  const input = $('name-input');
  input.value = initial;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const v = input.value.trim().slice(0, 20);
      resolve(v || initial || 'ผู้เล่น ' + Math.floor(100 + Math.random() * 900));
    }, { once: true });
    dlg.showModal();
    input.select();
  });
}

$('rename').addEventListener('click', async () => {
  $('members-dialog').close();
  const n = await askName(myName);
  if (n === myName) return;
  myName = n;
  saveName(n);
  presence?.setName(n).catch(() => toast('เปลี่ยนชื่อไม่สำเร็จ'));
});

// ---------- เริ่มต้น ----------
async function init() {
  if (!fb.configured) return showMessage('ยังไม่ได้ตั้งค่า Firebase (แก้ไฟล์ firebase-config.js ตามขั้นตอนใน README)');
  if (!fb.ROOM_ID_RE.test(roomId)) return roomGone();

  const [loadedMaps, user] = await Promise.all([fb.loadMaps(), fb.ensureUser()]);
  maps = loadedMaps;
  me = user.uid;
  renderPicker();

  fb.watchServerOffset((o) => { serverOffset = o; });
  fb.watchConnection((online) => {
    $('status').classList.toggle('online', online);
    $('status-text').textContent = online ? 'เชื่อมต่อแล้ว' : 'กำลังเชื่อมต่อ…';
  });

  let joining = false;
  fb.watchRoom(roomId, async (data) => {
    if (!data) { room = null; return roomGone(); }
    room = data;
    setHost(room.host === me);
    showMap(room.mapId);
    renderOverlay();
    renderMembers();
    if (!joining) {
      joining = true;
      myName = loadName() || await askName('');
      saveName(myName);
      presence = fb.joinPresence(roomId, me, myName, (list) => {
        members = list;
        membersLoaded = true;
        renderMembers();
      }, (e) => {
        console.error(e);
        toast('ลงชื่อในห้องไม่สำเร็จ — Firebase Rules อาจยังเป็นเวอร์ชันเก่า');
      });
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
