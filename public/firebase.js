import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig, emulators } from './firebase-config.js';

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

/** callback(room | null) ทุกครั้งที่ข้อมูลห้องเปลี่ยน */
export function watchRoom(roomId, callback, onError) {
  return onValue(ref(db, `rooms/${roomId}`), (snap) => callback(snap.val()), onError);
}

/** ลงชื่อว่าอยู่ในห้อง (หายไปเองเมื่อปิดหน้า) และแจ้งจำนวนคนในห้อง */
export function joinPresence(roomId, uid, onCount) {
  const me = ref(db, `presence/${roomId}/${uid}`);
  const offConnected = onValue(ref(db, '.info/connected'), async (snap) => {
    if (snap.val() !== true) return;
    await onDisconnect(me).remove();
    await set(me, true);
  });
  const offCount = onValue(ref(db, `presence/${roomId}`), (snap) => onCount(snap.size));
  return () => { offConnected(); offCount(); };
}

export function watchConnection(callback) {
  return onValue(ref(db, '.info/connected'), (snap) => callback(snap.val() === true));
}

export async function loadMaps() {
  const res = await fetch('maps/maps.json');
  const list = await res.json();
  return list.map((m) => ({ ...m, url: 'maps/' + encodeURIComponent(m.file) }));
}
