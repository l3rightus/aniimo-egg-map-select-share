'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAPS_DIR = path.join(PUBLIC_DIR, 'maps');
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // ห้องที่ไม่มีคนอยู่เกิน 24 ชม. จะถูกลบ
const MAX_ROOMS = 5000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const IMAGE_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg']);

/** อ่านรายชื่อแมพจากโฟลเดอร์ public/maps (วางไฟล์รูปเพิ่มได้เลย) */
function loadMaps() {
  let files = [];
  try {
    files = fs.readdirSync(MAPS_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file, i) => ({
      id: path.parse(file).name,
      name: `แมพ ${i + 1}`,
      url: `/maps/${encodeURIComponent(file)}`,
    }));
}

const MAPS = loadMaps();
const MAP_IDS = new Set(MAPS.map((m) => m.id));

/** @type {Map<string, {id:string, hostToken:string, mapId:string|null, clients:Set<http.ServerResponse>, updatedAt:number, emptySince:number|null}>} */
const rooms = new Map();

function newRoomId() {
  // 6 ตัวอักษร อ่านง่าย ไม่มีตัวที่สับสน (0/O, 1/I/l)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  } while (rooms.has(id));
  return id;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function roomState(room) {
  return { roomId: room.id, mapId: room.mapId, viewers: room.clients.size, updatedAt: room.updatedAt };
}

function broadcast(room) {
  const payload = `data: ${JSON.stringify(roomState(room))}\n\n`;
  for (const res of room.clients) res.write(payload);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': IMAGE_EXT.has(ext) ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, parts) {
  // GET /api/maps
  if (parts[1] === 'maps' && parts.length === 2 && req.method === 'GET') {
    return sendJson(res, 200, { maps: MAPS });
  }

  if (parts[1] !== 'rooms') return sendJson(res, 404, { error: 'not found' });

  // POST /api/rooms  -> สร้างห้องใหม่
  if (parts.length === 2 && req.method === 'POST') {
    if (rooms.size >= MAX_ROOMS) return sendJson(res, 503, { error: 'ห้องเต็ม ลองใหม่ภายหลัง' });
    const room = {
      id: newRoomId(),
      hostToken: crypto.randomBytes(24).toString('base64url'),
      mapId: MAPS[0]?.id ?? null,
      clients: new Set(),
      updatedAt: Date.now(),
      emptySince: Date.now(),
    };
    rooms.set(room.id, room);
    return sendJson(res, 201, { roomId: room.id, hostToken: room.hostToken });
  }

  const room = rooms.get(String(parts[2] || '').toUpperCase());
  if (!room) return sendJson(res, 404, { error: 'ไม่พบห้องนี้ หรือห้องหมดอายุแล้ว' });

  // GET /api/rooms/:id
  if (parts.length === 3 && req.method === 'GET') {
    return sendJson(res, 200, roomState(room));
  }

  // GET /api/rooms/:id/events  -> Server-Sent Events
  if (parts[3] === 'events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    room.clients.add(res);
    room.emptySince = null;
    broadcast(room);
    req.on('close', () => {
      room.clients.delete(res);
      if (room.clients.size === 0) room.emptySince = Date.now();
      broadcast(room);
    });
    return;
  }

  if ((parts[3] === 'map' || parts[3] === 'auth') && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    const isHost = Boolean(body.hostToken) && safeEqual(body.hostToken, room.hostToken);

    // POST /api/rooms/:id/auth  { hostToken }  -> ตรวจว่าเป็นหัวหน้าห้องหรือไม่
    if (parts[3] === 'auth') return sendJson(res, 200, { host: isHost });

    // POST /api/rooms/:id/map  { hostToken, mapId }  -> หัวหน้าห้องเปลี่ยนแมพ
    if (!isHost) {
      return sendJson(res, 403, { error: 'เฉพาะหัวหน้าห้องเท่านั้นที่เปลี่ยนแมพได้' });
    }
    if (!MAP_IDS.has(body.mapId)) return sendJson(res, 400, { error: 'ไม่มีแมพนี้' });
    room.mapId = body.mapId;
    room.updatedAt = Date.now();
    broadcast(room);
    return sendJson(res, 200, roomState(room));
  }

  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const parts = pathname.split('/').filter(Boolean);

    if (parts[0] === 'api') return await handleApi(req, res, parts);

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });

    // /room/:id -> หน้าห้อง (ใช้ไฟล์เดียวกัน, JS อ่าน id จาก URL)
    if (parts[0] === 'room' && parts.length === 2) return serveStatic(req, res, '/room.html');

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
    else res.end();
  }
});

// keep-alive ให้ SSE ไม่โดน proxy ตัดการเชื่อมต่อ + ลบห้องที่ร้างนาน
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    for (const res of room.clients) res.write(': ping\n\n');
    if (room.clients.size === 0 && room.emptySince && now - room.emptySince > ROOM_TTL_MS) rooms.delete(id);
  }
}, 25_000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT} (${MAPS.length} maps)`);
  });
}

module.exports = { server, rooms, MAPS };
