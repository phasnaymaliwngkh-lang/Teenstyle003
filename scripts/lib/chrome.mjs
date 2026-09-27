/**
 * ตัวช่วยคุม Chrome จริงผ่าน CDP — ใช้ร่วมกันระหว่างสคริปต์ตรวจ (แยกออกมาตอน STEP 39)
 *
 * ทำไมไม่ใช้ puppeteer/playwright: Node 24 มี `WebSocket` เป็น global อยู่แล้ว
 * และเราต้องการแค่ไม่กี่คำสั่งของ CDP — การเพิ่ม dependency ที่ดาวน์โหลด Chromium
 * ของตัวเองมาอีกชุดทำให้ผลตรวจไม่ใช่ "เบราว์เซอร์ที่ผู้ใช้ใช้จริง"
 *
 * ⚠️ ไฟล์นี้ถูกใช้โดย `audit-responsive.mjs` (STEP 31) และ `audit-chrome.mjs` (STEP 39)
 *    แก้แล้วต้องรันทั้งสองตัว
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export function log(...parts) {
  process.stdout.write(`${parts.join(' ')}\n`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findChrome(explicitPath) {
  if (explicitPath) return explicitPath;

  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      /* ข้าม */
    }
  }

  throw new Error('ไม่พบ Chrome ในเครื่อง — ระบุด้วย --chrome=<path>');
}

/**
 * รอให้เซิร์ฟเวอร์ขึ้น
 *
 * ⚠️ **ตอบอะไรกลับมาก็ถือว่าขึ้นแล้ว** ไม่ใช่เฉพาะ 2xx — เพราะการรอต่อไปเมื่อได้
 * 429 หรือ 500 คือการรออย่างไร้ความหมาย แล้วสุดท้ายรายงานว่า "ไม่ตอบ" ซึ่งไม่จริง
 * (เจอตอน STEP 39: รันตัวตรวจติด ๆ กันจนชน rate limit ของ API เอง → ได้ 429
 *  แล้วสคริปต์แจ้งว่า "backend ไม่ตอบภายใน 60s" ทำให้ไปหาสาเหตุผิดที่)
 * 429 ถูกเตือนแยกเพราะผลตรวจหลังจากนั้นจะเชื่อไม่ได้
 */
export async function waitForHttp(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const res = await fetch(url);

      if (res.status === 429) {
        log(
          `⚠️ ${label} ตอบ 429 (ชน rate limit ของ API เอง) — ผลตรวจจะเชื่อไม่ได้` +
            ' · ตั้ง RATE_LIMIT_MAX ให้สูงขึ้นใน .env แล้ว **รีสตาร์ต backend** ก่อนรันใหม่' +
            ' (แก้ .env เฉย ๆ ไม่มีผล เพราะ env ถูกอ่านตอนบูตครั้งเดียว)',
        );
      }

      return;
    } catch {
      /* ยังไม่ขึ้น */
    }
    if (Date.now() > deadline)
      throw new Error(`${label} ไม่ตอบภายใน ${timeoutMs / 1000}s (${url})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    /** ผู้ฟังแบบต่อเนื่อง: method → [{ sessionId, handler }] — ใช้เก็บ event ที่เกิดหลายครั้ง */
    this.listeners = new Map();

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);

      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);

        this.pending.delete(msg.id);
        if (msg.error)
          reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? null)})`));
        else resolve(msg.result);
        return;
      }

      for (const entry of this.listeners.get(msg.method) ?? []) {
        if (!entry.sessionId || entry.sessionId === msg.sessionId) entry.handler(msg.params, msg);
      }

      for (const waiter of [...this.waiters]) {
        if (
          waiter.method === msg.method &&
          (!waiter.sessionId || waiter.sessionId === msg.sessionId)
        ) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(msg.params);
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };

    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));

    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve };

      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);

        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(new Error(`ไม่ได้รับ event ${method} ภายใน ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);
    });
  }

  /** ฟัง event ทุกครั้งที่เกิด — คืนฟังก์ชันถอดผู้ฟัง */
  on(method, sessionId, handler) {
    const entry = { sessionId, handler };
    const list = this.listeners.get(method) ?? [];

    list.push(entry);
    this.listeners.set(method, list);

    return () => {
      const current = this.listeners.get(method) ?? [];
      const index = current.indexOf(entry);

      if (index >= 0) current.splice(index, 1);
    };
  }
}

/** เปิด Chrome แบบ headless แล้วต่อ CDP — คืนตัวที่ต้องเก็บไว้ปิดทีหลัง */
export async function launchChrome({ chromePath, debugPort, userDataDir, extraArgs = [] }) {
  const chrome = spawn(
    findChrome(chromePath),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${debugPort}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 'chrome', 30_000);

  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return { chrome, cdp: new Cdp(ws), browser: version.Browser };
}
