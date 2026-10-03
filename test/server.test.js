'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { server, MAPS } = require('../server');

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const post = (url, body) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('lists maps from public/maps', async () => {
  const { maps } = await (await fetch(base + '/api/maps')).json();
  assert.ok(maps.length >= 1);
  assert.deepStrictEqual(maps, MAPS);
});

test('host can change map, others cannot, and viewers get updates', async () => {
  const created = await (await post('/api/rooms')).json();
  assert.match(created.roomId, /^[A-Z0-9]{6}$/);

  assert.strictEqual((await (await post(`/api/rooms/${created.roomId}/auth`, { hostToken: created.hostToken })).json()).host, true);
  assert.strictEqual((await (await post(`/api/rooms/${created.roomId}/auth`, { hostToken: 'nope' })).json()).host, false);

  // viewer subscribes to SSE
  const ctrl = new AbortController();
  const sse = await fetch(`${base}/api/rooms/${created.roomId}/events`, { signal: ctrl.signal });
  const reader = sse.body.getReader();
  const target = MAPS[MAPS.length - 1].id;
  const received = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += Buffer.from(value).toString();
      for (const m of buf.matchAll(/^data: (.*)$/gm)) {
        const s = JSON.parse(m[1]);
        if (s.mapId === target) return s;
      }
    }
  })();

  const denied = await post(`/api/rooms/${created.roomId}/map`, { hostToken: 'wrong', mapId: target });
  assert.strictEqual(denied.status, 403);

  const bad = await post(`/api/rooms/${created.roomId}/map`, { hostToken: created.hostToken, mapId: '../x' });
  assert.strictEqual(bad.status, 400);

  const ok = await post(`/api/rooms/${created.roomId}/map`, { hostToken: created.hostToken, mapId: target });
  assert.strictEqual(ok.status, 200);

  const state = await received;
  assert.strictEqual(state.mapId, target);
  assert.strictEqual(state.viewers, 1);
  ctrl.abort();

  const room = await (await fetch(`${base}/api/rooms/${created.roomId}`)).json();
  assert.strictEqual(room.mapId, target);
});

test('unknown room returns 404, room page and static files are served', async () => {
  assert.strictEqual((await fetch(base + '/api/rooms/ZZZZZZ')).status, 404);
  assert.strictEqual((await fetch(base + '/room/ABCDEF')).status, 200);
  assert.strictEqual((await fetch(base + MAPS[0].url)).headers.get('content-type'), 'image/webp');
  assert.notStrictEqual((await fetch(base + '/%2e%2e/server.js')).status, 200);
});
