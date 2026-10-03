# Aniimo Egg Map — Select & Share

เว็บสำหรับสร้างห้อง ให้หัวหน้าห้องเลือกแมพ แล้วแชร์ลิ้งให้เพื่อน
ทุกคนที่เข้าลิ้งจะเห็นแมพเดียวกับที่หัวหน้าห้องเลือก และเปลี่ยนตามทันทีเมื่อหัวหน้าเปลี่ยนแมพ (real-time)

เว็บเป็น static site รันบน **GitHub Pages** และใช้ **Firebase Realtime Database** (ฟรี) เก็บข้อมูลห้อง

## วิธีใช้

1. เปิดหน้าแรก กด **สร้างห้องใหม่** → คุณจะเป็นหัวหน้าห้อง
2. เลือกแมพจากแถบด้านบน
3. กด **คัดลอกลิ้งแชร์** แล้วส่งให้เพื่อน (หรือให้เพื่อนกรอกรหัสห้อง 6 ตัวที่หน้าแรก)
4. เพื่อนจะเห็นแมพเดียวกัน และเปลี่ยนตามอัตโนมัติ ซูม/เลื่อนแมพได้เอง (ล้อเมาส์, ลาก, สองนิ้วบนมือถือ, ดับเบิลคลิก)

หัวหน้าห้องจำตามเบราว์เซอร์ที่ใช้สร้างห้อง (เปิดเบราว์เซอร์เดิมกลับมาก็ยังเป็นหัวหน้า) คนอื่นเปลี่ยนแมพไม่ได้ เพราะ security rules ของ Firebase บล็อกไว้

## ตั้งค่าครั้งแรก

### 1. สร้าง Firebase project (ฟรี)

1. ไปที่ <https://console.firebase.google.com> → **Add project** (ปิด Google Analytics ได้)
2. **Build → Authentication → Get started → Sign-in method** → เปิด **Anonymous**
3. **Build → Realtime Database → Create database** → เลือก location ไหนก็ได้ → เริ่มแบบ **locked mode**
4. ในหน้า Realtime Database แท็บ **Rules** → ลบของเดิม แล้ววางเนื้อหาไฟล์ [`database.rules.json`](database.rules.json) → **Publish**
5. **Project settings (ไอคอนเฟือง) → General → Your apps** → กดไอคอน **`</>`** (Web) → ตั้งชื่อ → **Register app**
   จะได้ค่า `firebaseConfig` มา ให้ก๊อปไปใส่ใน [`public/firebase-config.js`](public/firebase-config.js)
   (ต้องมี `databaseURL` ด้วย ถ้าไม่มีให้ก๊อป URL จากหน้า Realtime Database มาใส่เอง)
6. **Authentication → Settings → Authorized domains** → เพิ่ม `<ชื่อ-user>.github.io`

> ค่าใน `firebase-config.js` ไม่ใช่ความลับ commit ขึ้น GitHub ได้ ความปลอดภัยคุมด้วย rules ในข้อ 4

### 2. เปิด GitHub Pages

1. ใน repo บน GitHub → **Settings → Pages → Build and deployment → Source** เลือก **GitHub Actions**
2. merge โค้ดเข้า branch `main` (หรือกด **Actions → Deploy to GitHub Pages → Run workflow**)
3. เว็บจะอยู่ที่ `https://<ชื่อ-user>.github.io/aniimo-egg-map-select-share/`

## เพิ่ม/เปลี่ยนแมพ

วางไฟล์รูปไว้ใน `public/maps/` แล้วเพิ่มรายการใน [`public/maps/maps.json`](public/maps/maps.json)

```json
{ "id": "map-6", "name": "ชื่อแมพ", "file": "map-6.webp" }
```

`id` ห้ามซ้ำกัน และอย่าเปลี่ยน `id` ของแมพเดิม (ห้องที่เปิดอยู่อ้างถึงแมพด้วย `id`)

## รันในเครื่อง

```bash
npm start   # http://localhost:3000  (ยังต้องตั้งค่า firebase-config.js ก่อน)
```

## โครงสร้าง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `public/index.html` | หน้าแรก สร้างห้อง / เข้าห้องด้วยรหัส |
| `public/room.html`, `public/room.js` | หน้าห้อง ตัวเลือกแมพ (หัวหน้า) และตัวดูแมพ ซูม/เลื่อนได้ |
| `public/firebase.js` | เชื่อมต่อ Firebase (สร้างห้อง เปลี่ยนแมพ ติดตามการเปลี่ยนแปลง นับคนในห้อง) |
| `public/firebase-config.js` | ค่าตั้งค่า Firebase ของคุณ |
| `database.rules.json` | security rules (ให้เฉพาะหัวหน้าห้องเปลี่ยนแมพได้) |
| `.github/workflows/pages.yml` | deploy โฟลเดอร์ `public/` ขึ้น GitHub Pages อัตโนมัติ |
