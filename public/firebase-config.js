// ใส่ค่าจาก Firebase Console → Project settings → General → Your apps → Web app (SDK setup and configuration)
// ค่าพวกนี้ไม่ใช่ความลับ ความปลอดภัยคุมด้วย database.rules.json
export const firebaseConfig = {
  apiKey: 'AIzaSyDoj3sdInPnKnRGpuIH99oYT_K35pCVLI0',
  authDomain: 'aniimo-egg-map-select-share.firebaseapp.com',
  databaseURL: 'https://aniimo-egg-map-select-share-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'aniimo-egg-map-select-share',
  appId: '1:442812047424:web:4e7945928711498f5affa5',
};

// ใช้ตอนทดสอบกับ Firebase Emulator เท่านั้น ปล่อยเป็น null ตอนใช้งานจริง
export const emulators = null;
