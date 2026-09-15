/**
 * ตรวจว่า DATABASE_URL ใน .env ใช้เชื่อมต่อ PostgreSQL ได้จริงหรือไม่
 *
 * รันด้วย:  npm run db:check     (จาก root ของ repo)
 *
 * สคริปต์นี้ไม่แก้ไขข้อมูลใด ๆ อ่านอย่างเดียว และจะไม่พิมพ์รหัสผ่านออกมา
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '.env'), quiet: true });
loadEnv({ path: path.resolve(here, '..', '..', '.env'), quiet: true });

const url = process.env.DATABASE_URL;

/** ซ่อนรหัสผ่านก่อนพิมพ์ออกหน้าจอ */
function mask(connectionString) {
  return connectionString.replace(/:\/\/([^:/@]+):([^@]*)@/, '://$1:****@');
}

if (!url) {
  console.error('❌ ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env แล้วกรอกค่าก่อน');
  process.exit(1);
}

if (url.includes('__PUT_YOUR_PG18_PASSWORD_HERE__')) {
  console.error('❌ DATABASE_URL ยังเป็นค่า placeholder');
  console.error('   แก้ไฟล์ .env แล้วแทน __PUT_YOUR_PG18_PASSWORD_HERE__ ด้วยรหัสผ่านจริงของคุณ');
  process.exit(1);
}

console.log(`\n🔌 กำลังทดสอบ: ${mask(url)}\n`);

// ต่อเข้า database "postgres" ก่อน เพื่อให้ตรวจได้แม้ database ของโปรเจกต์ยังไม่ถูกสร้าง
const target = new URL(url);
const dbName = target.pathname.replace(/^\//, '') || 'postgres';
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const client = new pg.Client({
  connectionString: adminUrl.toString(),
  connectionTimeoutMillis: 8000,
});

try {
  await client.connect();

  const version = await client.query('SELECT version()');
  console.log('✅ เชื่อมต่อสำเร็จ');
  console.log(`   server   : ${version.rows[0].version.split(',')[0]}`);

  const who = await client.query('SELECT current_user, pg_is_in_recovery() AS replica');
  console.log(`   user     : ${who.rows[0].current_user}`);

  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount > 0) {
    console.log(`   database : "${dbName}" มีอยู่แล้ว`);
  } else {
    console.log(`   database : "${dbName}" ยังไม่มี — Prisma จะสร้างให้ตอน migrate`);
  }

  const canCreate = await client.query(
    'SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname = current_user',
  );
  const role = canCreate.rows[0] ?? {};
  const allowed = Boolean(role.rolsuper || role.rolcreatedb);
  console.log(`   สิทธิ์สร้าง database : ${allowed ? 'มี' : 'ไม่มี'}`);

  if (!allowed && exists.rowCount === 0) {
    console.log(
      `\n⚠️  ผู้ใช้นี้สร้าง database ไม่ได้ และยังไม่มี "${dbName}" — ให้สร้าง database ก่อน หรือใช้ผู้ใช้ที่มีสิทธิ์`,
    );
    process.exitCode = 1;
  } else {
    console.log('\n✅ พร้อมรัน:  npm run db:migrate  แล้วตามด้วย  npm run db:seed\n');
  }
} catch (error) {
  console.error('❌ เชื่อมต่อไม่สำเร็จ');
  console.error(`   code    : ${error.code ?? '-'}`);
  console.error(`   message : ${error.message}`);

  const hint = {
    '28P01': 'รหัสผ่านไม่ถูกต้อง — ตรวจ DATABASE_URL ใน .env (อักขระพิเศษต้อง percent-encode)',
    28000: 'ผู้ใช้นี้ไม่มีสิทธิ์เข้าถึง — ตรวจชื่อผู้ใช้และ pg_hba.conf',
    '3D000': 'ไม่พบ database ที่ระบุ',
    ECONNREFUSED: 'ต่อ server ไม่ได้ — PostgreSQL รันอยู่ไหม และ port ถูกต้องหรือไม่',
    ETIMEDOUT: 'หมดเวลาเชื่อมต่อ — ตรวจ host/port/firewall',
    ENOTFOUND: 'หา host ไม่เจอ — ตรวจชื่อ host ใน DATABASE_URL',
  }[error.code];

  if (hint) console.error(`   วิธีแก้  : ${hint}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
