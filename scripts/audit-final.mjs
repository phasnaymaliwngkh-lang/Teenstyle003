#!/usr/bin/env node
/**
 * ตรวจรอบสุดท้ายของ STEP 1–39 (STEP 40)
 *
 * ไม่ใช่การรันเครื่องมืออื่นซ้ำ — ตรวจสิ่งที่ **ยังไม่มีเครื่องมือไหนจับ** และเป็นหนี้
 * ที่โปรเจกต์นี้เจอซ้ำมาแล้วหลายครั้ง:
 *
 *   A. **คอลัมน์ที่ถูกอ่าน/แสดง แต่หาการเขียนค่าไม่เจอ** (ข้อสังเกต ไม่ใช่ข้อผิดพลาด)
 *      เจอมา 4 ครั้งแล้ว: `Product.totalStock` (STEP 15) · `User.totalSpent` (STEP 25)
 *      · `KnowledgeArticle.viewCount` (STEP 29) · `User.points`/`loyaltyTier` (STEP 40)
 *      ทุกครั้งอาการเหมือนกัน: หน้าเว็บโชว์ 0 หรือค่าเริ่มต้นเป็นความจริง ไม่มี error ให้เห็น
 *
 *      ⚠️ **ข้อนี้ไม่ทำให้สคริปต์ล้มเหลว เพราะ regex หาการเขียนให้แม่นไม่ได้**
 *         โปรเจกต์นี้เขียนค่าด้วยหลายรูปแบบ: `data: { field }` (shorthand) ·
 *         `const data = {…}` แล้วส่งต่อ · `data: cond ? {…} : {…}` · raw SQL
 *         การจะรู้แน่ต้องอ่าน AST ของ TypeScript ซึ่งเกินขอบเขตของสคริปต์นี้
 *         → รายงานเป็น "รายการให้คนยืนยัน" แล้วใส่ผลการยืนยันลง `WRITE_EXEMPT`
 *         (รอบแรกรายงานเป็นข้อผิดพลาด แล้วผิด 13 จาก 13 — ตัวตรวจที่เตือนผิดแย่กว่าไม่มี)
 *   B. ลิงก์ในเอกสารที่ชี้ไปไฟล์ที่ไม่มีอยู่
 *   C. งานที่ค้างไว้ในโค้ด (TODO/FIXME/HACK)
 *   D. **คอมเมนต์ที่สัญญาถึง STEP ที่ทำเสร็จไปแล้ว** — "จะแก้ตอน STEP 34" ที่ค้างอยู่
 *      ทั้งที่ STEP 34 เสร็จแล้ว คือคำสัญญาที่ไม่มีใครถือ
 *
 * ใช้: node scripts/audit-final.mjs
 * โค้ดออก: 0 = ไม่พบปัญหา · 1 = พบ · 2 = รันไม่สำเร็จ
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const problems = [];
const notes = [];
const passed = [];

const fail = (area, message) => problems.push({ area, message });
const note = (area, message) => notes.push({ area, message });
const ok = (area, message) => passed.push({ area, message });

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

function collectFiles(dir, extensions) {
  if (!existsSync(dir)) return [];

  const out = [];

  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === 'dist' ||
      entry === 'generated'
    ) {
      continue;
    }

    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) out.push(...collectFiles(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }

  return out;
}

const SOURCE_DIRS = [
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT, 'frontend', 'src'),
  path.join(ROOT, 'database', 'src'),
  path.join(ROOT, 'database', 'seed'),
];

const sourceFiles = SOURCE_DIRS.flatMap((dir) => collectFiles(dir, ['.ts', '.tsx'])).filter(
  (file) => !file.includes('.test.'),
);
const sources = sourceFiles.map((file) => ({ file, text: readFileSync(file, 'utf8') }));

/* ═════════════ A. คอลัมน์ที่อ่านแต่ไม่มีใครเขียน ═════════════ */

/**
 * เก็บชื่อฟิลด์ทุกตัวที่โค้ด "เขียนค่า" ให้
 *
 * Prisma เขียนผ่าน `data: { ... }` เท่านั้น (create/update/upsert/createMany)
 * จึงสแกนวงเล็บปีกกาที่สมดุลหลัง `data:` แล้วเก็บคีย์ข้างใน — แม่นกว่าการเดาจากค่า
 * (รอบแรกเดาจากค่าแล้วพลาดการเขียนแบบ `isDefault: true` กับ `sortOrder: index`
 *  จนรายงานผิด 13 คอลัมน์ — ตัวตรวจที่เตือนผิดแย่กว่าไม่มี)
 *
 * ⚠️ ข้อจำกัดที่ยอมรับ: การเขียนแบบ `data: input` (spread ทั้งก้อน) จับคีย์ไม่ได้
 *    ฟิลด์ที่เขียนด้วยวิธีนั้นเท่านั้นจะถูกรายงานผิด — ใส่ลง WRITE_EXEMPT พร้อมเหตุผล
 */
function collectWrittenFieldNames() {
  const names = new Set();

  for (const { text } of sources) {
    /**
     * ── Prisma: ทุกคีย์ในบล็อกหลัง `data:`
     *
     * ต้องรองรับสองแบบที่โปรเจกต์นี้ใช้จริง และรอบแรกพลาดทั้งคู่:
     *   1. `data: helpful ? { … } : { … }`  → มีนิพจน์คั่นก่อนปีกกา
     *   2. `data: { subtotal, shippingFee }` → object shorthand (ไม่มีเครื่องหมาย :)
     */
    for (const match of text.matchAll(/\bdata\s*:[^{;]{0,60}\{/g)) {
      let depth = 0;
      let index = match.index + match[0].length - 1;

      for (; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        else if (text[index] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }

      const block = text.slice(match.index, index + 1);

      for (const key of block.matchAll(/(\w+)\s*:/g)) names.add(key[1]);
      // shorthand: ชื่อตัวแปรที่อยู่บรรทัดเดียวโดด ๆ แล้วจบด้วย , หรือ }
      for (const key of block.matchAll(/^\s*(\w+)\s*,?\s*$/gm)) names.add(key[1]);
    }

    // ── raw SQL: UPDATE … SET "col" = …  /  INSERT INTO … ("col", …)
    for (const match of text.matchAll(/SET[\s\S]{0,400}?(?:WHERE|RETURNING|`)/gi)) {
      for (const col of match[0].matchAll(/"(\w+)"\s*=/g)) names.add(col[1]);
    }
    for (const match of text.matchAll(/INSERT INTO[\s\S]{0,400}?\)/gi)) {
      for (const col of match[0].matchAll(/"(\w+)"/g)) names.add(col[1]);
    }
  }

  return names;
}

const writtenFieldNames = collectWrittenFieldNames();

/**
 * คอลัมน์ที่ยอมให้ "ไม่มีใครเขียน" ได้ พร้อมเหตุผล — **ต้องแคบที่สุด**
 * ⚠️ เพิ่มชื่อที่นี่คือการปิดตาตัวตรวจ ต้องเขียนเหตุผลไว้ทุกครั้ง
 */
const WRITE_EXEMPT = {
  'User.points': 'ยังไม่เปิดใช้ระบบแต้ม (STEP 42) — หน้าเว็บบอกตรง ๆ ว่ายังไม่เปิดใช้',
  'User.loyaltyTier': 'ยังไม่เปิดใช้ระบบแต้ม (STEP 42) — ถอดออกจากหน้าเว็บแล้ว',
  'User.totalSpent': 'cache ที่ยังไม่มีใครเขียน — หลังบ้านนับจากตาราง Order จริงแทน (STEP 25)',
  'Review.isVerifiedPurchase':
    'ยืนยันแล้วว่าเขียนจริงที่ review.service.ts (`const data = {…}` แล้วส่งต่อ จึงหาด้วย regex ไม่เจอ)',
  'KnowledgeArticle.notHelpfulCount':
    'ยืนยันแล้วว่าเขียนจริงที่ knowledge-base.service.ts (`data: helpful ? {…} : { notHelpfulCount: { increment: 1 } }`)',
  'Look.isFeatured':
    'ตั้งค่าจาก seed เท่านั้น — ยังไม่มีหน้าจัดการลุคในหลังบ้าน (ลุคทั้งหมดมาจากข้อมูลตั้งต้น)',
};

/** ฟิลด์ที่ไม่ต้องตรวจเลย เพราะฐานข้อมูล/Prisma จัดการเอง */
function isManagedField(line) {
  return (
    /@id\b/.test(line) ||
    /@updatedAt\b/.test(line) ||
    /@default\(now\(\)\)/.test(line) ||
    /@default\(uuid|@default\(cuid|@default\(autoincrement/.test(line) ||
    /@relation\b/.test(line)
  );
}

function auditUnwrittenColumns() {
  const schema = read(path.join(ROOT, 'database', 'prisma', 'schema.prisma'));

  if (schema === null) {
    fail('A', 'ไม่พบ database/prisma/schema.prisma');
    return;
  }

  const modelNames = new Set(
    [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]),
  );
  const enumNames = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((match) => match[1]));

  let currentModel = null;
  let checked = 0;

  for (const rawLine of schema.split(/\r?\n/)) {
    const modelStart = /^model\s+(\w+)\s*\{/.exec(rawLine);

    if (modelStart) {
      currentModel = modelStart[1];
      continue;
    }
    if (/^\}/.test(rawLine)) {
      currentModel = null;
      continue;
    }
    if (currentModel === null) continue;

    const field = /^\s{2}(\w+)\s+(\w+)(\[\])?(\?)?/.exec(rawLine);

    if (field === null) continue;

    const [, name, type, isList] = field;

    // ความสัมพันธ์กับโมเดลอื่นไม่ใช่ "ค่า" ที่ต้องเขียน
    if (modelNames.has(type) || isList) continue;
    if (isManagedField(rawLine)) continue;
    // ไม่มี @default = ต้องส่งค่าตอนสร้างอยู่แล้ว ไม่ใช่ cache ที่ลืมอัปเดต
    if (!/@default\(/.test(rawLine)) continue;
    // ค่า default ที่เป็น enum ตัวแรกหรือ false มักเป็น "สถานะเริ่มต้น" ที่ตั้งใจให้คงที่ได้
    if (!enumNames.has(type) && !/@default\((0|false|\[\]|"")\)/.test(rawLine)) continue;

    checked += 1;

    const key = `${currentModel}.${name}`;
    const pattern = new RegExp(`\\b${name}\\b`);
    const mentions = sources.filter(({ text }) => pattern.test(text));

    if (mentions.length === 0) continue;
    // การเขียนทุกแบบของ Prisma ผ่าน `data:` · ส่วน raw SQL ผ่าน SET/INSERT
    if (writtenFieldNames.has(name)) continue;

    const shownIn = mentions.filter(({ file }) => file.includes(`frontend${path.sep}src`));
    const reason = WRITE_EXEMPT[key];

    if (reason !== undefined) {
      note('A', `${key}: ไม่มีใครเขียน — ยกเว้นไว้เพราะ ${reason}`);
      continue;
    }

    const where = shownIn.length > 0 ? ` · อ้างถึงในหน้าเว็บ ${shownIn.length} ไฟล์` : '';

    note(
      'A',
      `${key}: หาการเขียนค่าไม่เจอ — อ้างถึง ${mentions.length} ไฟล์${where} · **ต้องให้คนยืนยัน**`,
    );
  }

  ok(
    'A',
    `ตรวจคอลัมน์ที่เป็น cache/ตัวนับ ${checked} คอลัมน์ — รายการด้านล่างเป็น **ข้อสังเกตให้คนตรวจ** ไม่ใช่ข้อผิดพลาด`,
  );
}

/* ═════════════ B. ลิงก์ในเอกสาร ═════════════ */

function auditDocLinks() {
  const docs = [...collectFiles(path.join(ROOT, 'docs'), ['.md']), path.join(ROOT, 'CLAUDE.md')];
  let total = 0;

  for (const file of docs) {
    const text = read(file);

    if (text === null) continue;

    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];

      if (target === '' || /^(https?:|mailto:)/.test(target)) continue;
      total += 1;

      const resolved = path.resolve(path.dirname(file), target);

      if (!existsSync(resolved)) {
        fail('B', `${path.relative(ROOT, file)} → ${target} (ไม่มีไฟล์นี้)`);
      }
    }
  }

  ok('B', `ลิงก์ในเอกสาร ${total} ลิงก์ ชี้ไปไฟล์ที่มีอยู่จริง`);
}

/* ═════════════ C. งานที่ค้างในโค้ด ═════════════ */

function auditPendingMarkers() {
  let found = 0;

  for (const { file, text } of sources) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      // `XXXX` ในตัวอย่างข้อความไม่ใช่เครื่องหมายงานค้าง จึงต้องเป็นคำเต็มพร้อมเครื่องหมาย
      if (!/\b(TODO|FIXME|HACK)\b[:\s]/.test(line)) continue;
      found += 1;
      fail('C', `${path.relative(ROOT, file)}:${index + 1} — ${line.trim().slice(0, 120)}`);
    }
  }

  if (found === 0) ok('C', 'ไม่มี TODO/FIXME/HACK ค้างในซอร์ส');
}

/* ═════════════ D. คำสัญญาถึง STEP ที่ทำเสร็จแล้ว ═════════════ */

function auditKeptPromises() {
  const progress = read(path.join(ROOT, 'docs', '02-step-progress.md'));

  if (progress === null) {
    fail('D', 'ไม่พบ docs/02-step-progress.md');
    return;
  }

  /** STEP ที่ตารางบอกว่าเสร็จแล้ว (✅) */
  const done = new Set(
    [...progress.matchAll(/^\|\s*(\d+)\s*\|[^|]*\|\s*✅/gm)].map((match) => Number(match[1])),
  );

  if (done.size === 0) {
    fail('D', 'อ่านรายการ STEP ที่เสร็จแล้วจากตารางไม่ได้ — เทสต์ข้อนี้จะไม่มีความหมาย');
    return;
  }

  /**
   * ถ้อยคำที่เป็น **อนาคต** เท่านั้น
   *
   * ⚠️ ห้ามใส่ "แก้ตอน STEP n" / "ทำตอน STEP n" เพราะในภาษาไทยนั่นคือการ **บันทึกอดีต**
   *    ("แก้ตอน STEP 25" = ถูกแก้ไปแล้วตอน STEP 25) ซึ่งเป็นคอมเมนต์ที่ถูกต้องและมีประโยชน์
   *    รอบแรกใส่ไว้แล้วรายงานผิด 4 แห่ง
   *
   * `STEP 24/50` ถือเป็นการอ้างถึงหลายขั้น — ฟ้องเฉพาะเมื่อ **เสร็จหมดทุกขั้น**
   * (ถ้ายังมีขั้นที่ไม่เสร็จอยู่ คำสัญญานั้นยังเป็นจริง)
   */
  const promisePatterns = [
    /(?:เป็นงานของ|งานของ|จะทำใน|รอ|เปิดใช้พร้อม)\s*STEP\s*([\d/]+)/g,
    /STEP\s*([\d/]+)\s*(?:จะ|ต้องมาแก้|ต้องเพิ่ม|ค่อย)/g,
  ];

  let promises = 0;

  for (const { file, text } of sources) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const pattern of promisePatterns) {
        for (const match of line.matchAll(pattern)) {
          const steps = match[1]
            .split('/')
            .map(Number)
            .filter((step) => Number.isInteger(step) && step > 0);

          if (steps.length === 0) continue;
          promises += 1;
          if (!steps.every((step) => done.has(step))) continue;

          fail(
            'D',
            `${path.relative(ROOT, file)}:${index + 1} — สัญญาถึง STEP ${steps.join('/')} ` +
              `ที่เสร็จไปแล้ว: "${line.trim().slice(0, 110)}"`,
          );
        }
      }
    }
  }

  ok('D', `ตรวจคำสัญญาถึง STEP ในซอร์ส ${promises} แห่ง (STEP ที่เสร็จแล้ว ${done.size} ขั้น)`);
}

/* ═════════════ รายงาน ═════════════ */

console.log('\n🔎 ตรวจรอบสุดท้ายของ STEP 1–39 (STEP 40)\n');

auditUnwrittenColumns();
auditDocLinks();
auditPendingMarkers();
auditKeptPromises();

const AREA_LABEL = {
  A: 'คอลัมน์ที่อ่านแต่ไม่มีใครเขียน',
  B: 'ลิงก์ในเอกสาร',
  C: 'งานที่ค้างในโค้ด',
  D: 'คำสัญญาถึง STEP ที่ทำเสร็จแล้ว',
};

for (const area of Object.keys(AREA_LABEL)) {
  const areaProblems = problems.filter((item) => item.area === area);
  const areaNotes = notes.filter((item) => item.area === area);
  const areaPassed = passed.filter((item) => item.area === area);

  if (areaProblems.length + areaNotes.length + areaPassed.length === 0) continue;

  console.log(`\n${area}. ${AREA_LABEL[area]}`);
  for (const item of areaPassed) console.log(`   ✅ ${item.message}`);
  for (const item of areaNotes) console.log(`   ℹ️  ${item.message}`);
  for (const item of areaProblems) console.log(`   ❌ ${item.message}`);
}

console.log(
  `\n${'─'.repeat(78)}\nผิดพลาด ${problems.length} · ข้อสังเกต ${notes.length} · ผ่าน ${passed.length}\n`,
);

console.log(
  'ℹ️  ตัวนี้ตรวจเฉพาะสิ่งที่เครื่องมืออื่นจับไม่ได้ · เครื่องมืออื่นต้องรันแยก:\n' +
    '   npm test · npm run build · audit-responsive · audit-seo · audit-performance · audit-deploy · audit-chrome\n',
);

process.exit(problems.length > 0 ? 1 : 0);
