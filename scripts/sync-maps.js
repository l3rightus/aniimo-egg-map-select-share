// สร้าง/อัปเดต public/maps/maps.json จากไฟล์รูปในโฟลเดอร์ public/maps
// - แมพที่มีใน maps.json อยู่แล้ว: คงชื่อและลำดับเดิม
// - ไฟล์รูปใหม่: เพิ่มต่อท้าย ใช้ชื่อไฟล์ (ไม่รวมนามสกุล) เป็นชื่อแมพ
// - รายการที่ไม่มีไฟล์รูปแล้ว: ลบออก
// รัน: node scripts/sync-maps.js   (GitHub Actions รันให้อัตโนมัติก่อน deploy)
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'public', 'maps');
const manifestPath = path.join(dir, 'maps.json');
const IMAGE = /\.(webp|png|jpe?g|gif|avif)$/i;

let manifest = [];
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch {
  // ยังไม่มี maps.json หรืออ่านไม่ได้ → สร้างใหม่
}

const files = fs.readdirSync(dir)
  .filter((f) => IMAGE.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const kept = manifest.filter((m) => files.includes(m.file));
const known = new Set(kept.map((m) => m.file));
const usedIds = new Set(kept.map((m) => m.id));

const added = [];
for (const file of files) {
  if (known.has(file)) continue;
  const base = path.parse(file).name;
  // id ใช้ใน Firebase key: ห้ามมี . # $ [ ] / และยาวไม่เกิน 64
  let id = base.replace(/[.#$[\]/\s]+/g, '-').slice(0, 56) || 'map';
  for (let i = 2; usedIds.has(id); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
  usedIds.add(id);
  const name = base.replace(/[-_]+/g, ' ').trim().slice(0, 40);
  added.push({ id, name, file });
}

const removed = manifest.filter((m) => !files.includes(m.file));
const result = [...kept, ...added];
fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2) + '\n');

console.log(`maps.json: ${result.length} แมพ (เพิ่ม ${added.length}, ลบ ${removed.length})`);
for (const m of added) console.log(`  + ${m.file} → "${m.name}"`);
for (const m of removed) console.log(`  - ${m.file}`);
