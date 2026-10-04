import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  set,
  update,
  push,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig, emulators } from './firebase-config.js?v=dev';

export const configured = Boolean(firebaseConfig?.apiKey && firebaseConfig?.databaseURL);

let auth;
let db;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  if (emulators) {
    connectAuthEmulator(auth, emulators.auth, { disableWarnings: true });
    connectDatabaseEmulator(db, emulators.dbHost, emulators.dbPort);
  }
}

// 6 ตัวอักษร อ่านง่าย ไม่มีตัวที่สับสน (0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_ID_RE = /^[A-HJ-NP-Z2-9]{6}$/;

function newRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** ล็อกอินแบบไม่ระบุตัวตน (uid จำไว้ในเบราว์เซอร์ ใช้ระบุว่าใครเป็นหัวหน้าห้อง) */
export async function ensureUser() {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

export async function createRoom(mapId) {
  const user = await ensureUser();
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newRoomId();
    try {
      // rules อนุญาตให้สร้างได้เฉพาะเมื่อยังไม่มีห้องนี้ ถ้ารหัสชนจะโดนปฏิเสธแล้วสุ่มใหม่
      await set(ref(db, `rooms/${id}`), {
        host: user.uid,
        mapId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
}

export function setRoomMap(roomId, mapId) {
  return update(ref(db, `rooms/${roomId}`), { mapId, updatedAt: serverTimestamp() });
}

/** mark = { x, y, kind: 'x' | 'num' | 'check', color?, n?, by, name?, at } */
export function addMark(roomId, mapId, mark) {
  return push(ref(db, `rooms/${roomId}/marks/${mapId}`), { ...mark, at: serverTimestamp() });
}

export function removeMark(roomId, mapId, markId) {
  return remove(ref(db, `rooms/${roomId}/marks/${mapId}/${markId}`));
}

export function clearMarks(roomId, mapId) {
  return remove(ref(db, `rooms/${roomId}/marks/${mapId}`));
}

/** เริ่มรอบใหม่: ลบมาร์กทุกแมพ และ ping ที่ค้างอยู่ */
export function resetRound(roomId) {
  return update(ref(db, `rooms/${roomId}`), { marks: null, pings: null, updatedAt: serverTimestamp() });
}

/** ping จุดบนแมพชั่วคราว (ลบตัวเองหลัง ttl ms) */
export async function addPing(roomId, ping, ttl) {
  const r = push(ref(db, `rooms/${roomId}/pings`));
  await set(r, { ...ping, at: serverTimestamp() });
  setTimeout(() => remove(r).catch(() => {}), ttl);
}

export function transferHost(roomId, uid) {
  return update(ref(db, `rooms/${roomId}`), { host: uid, updatedAt: serverTimestamp() });
}

/** รับตำแหน่งหัวหน้าเมื่อหัวหน้าเดิมออฟไลน์ (rules ตรวจว่าหัวหน้าเดิมไม่อยู่ในห้องจริง) */
export function claimHost(roomId, uid) {
  return set(ref(db, `rooms/${roomId}/host`), uid);
}

/** callback(room | null) ทุกครั้งที่ข้อมูลห้องเปลี่ยน */
export function watchRoom(roomId, callback, onError) {
  return onValue(ref(db, `rooms/${roomId}`), (snap) => callback(snap.val()), onError);
}

/**
 * ลงชื่อว่าอยู่ในห้อง (หายไปเองเมื่อปิดหน้า) และแจ้งรายชื่อคนในห้อง
 * คืนค่า { setName, leave } — onError ถูกเรียกถ้าเขียนไม่ได้ (เช่น Firebase Rules ยังเป็นเวอร์ชันเก่า)
 */
export function joinPresence(roomId, uid, name, onMembers, onError) {
  const me = ref(db, `presence/${roomId}/${uid}`);
  let myName = name;
  const offConnected = onValue(ref(db, '.info/connected'), async (snap) => {
    if (snap.val() !== true) return;
    try {
      await onDisconnect(me).remove();
      await set(me, { name: myName });
    } catch (e) {
      onError?.(e);
    }
  });
  const offMembers = onValue(ref(db, `presence/${roomId}`), (snap) => {
    const list = [];
    snap.forEach((c) => { list.push({ uid: c.key, name: c.val()?.name || '' }); });
    onMembers(list);
  });
  return {
    setName(n) { myName = n; return set(me, { name: n }); },
    leave() { offConnected(); offMembers(); remove(me); },
  };
}

/** ส่วนต่างเวลาเครื่องเรากับเวลา server (ms) */
export function watchServerOffset(callback) {
  return onValue(ref(db, '.info/serverTimeOffset'), (snap) => callback(snap.val() || 0));
}

export function watchConnection(callback) {
  return onValue(ref(db, '.info/connected'), (snap) => callback(snap.val() === true));
}

export async function loadMaps() {
  const res = await fetch('maps/maps.json?v=dev');
  const list = await res.json();
  return list.map((m) => ({ ...m, url: 'maps/' + encodeURIComponent(m.file) }));
}
