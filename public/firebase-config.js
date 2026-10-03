// ใส่ค่าจาก Firebase Console → Project settings → General → Your apps → Web app (SDK setup and configuration)
// ค่าพวกนี้ไม่ใช่ความลับ ความปลอดภัยคุมด้วย database.rules.json
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  databaseURL: '',
  projectId: '',
  appId: '',
};

// ใช้ตอนทดสอบกับ Firebase Emulator เท่านั้น ปล่อยเป็น null ตอนใช้งานจริง
export const emulators = null;
