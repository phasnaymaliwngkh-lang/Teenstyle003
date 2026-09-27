#!/usr/bin/env node
/**
 * ตรวจว่าเว็บ "ทำงานจริงในเบราว์เซอร์" ไม่ใช่แค่ตอบ 200 (STEP 39)
 *
 * ทำไมต้องมี: เครื่องมือที่มีอยู่ตรวจได้แค่บางชั้น
 *   - `curl` บอกได้แค่ status code · หน้าที่ JavaScript ถูก CSP บล็อกทั้งหมด **ยังตอบ 200**
 *   - `audit-responsive.mjs` (STEP 31) วัดเลย์เอาต์ ไม่ได้ดูว่ามี error ใน console
 *   - `audit-seo.mjs` (STEP 33) อ่าน HTML ชุดแรก ไม่ได้รอให้ hydrate
 *   - เทสต์คอมโพเนนต์ (STEP 37) รันใน jsdom ซึ่ง **ไม่มี CSP ไม่มี hydration จริง**
 *     และไม่โหลด chunk ของ Next เลย
 *
 * ของที่เห็นได้เฉพาะในเบราว์เซอร์จริงและตรวจที่นี่:
 *   1. exception ที่หลุดออกมา (`Runtime.exceptionThrown`)
 *   2. `console.error` / `console.warn` — รวม **hydration mismatch ของ React** ซึ่งไม่มีอะไรฟ้องที่อื่น
 *   3. **CSP บล็อกอะไรไปจริงไหม** — แทนการนับ nonce ในซอร์สแบบ STEP 28 ด้วยการอ่าน
 *      รายงานของเบราว์เซอร์เอง (`Log.entryAdded` source `security` + ข้อความ console)
 *   4. คำขอที่ล้มหรือได้ 4xx/5xx ระหว่างโหลดหน้า
 *   5. **JavaScript ทำงานจริงไหม** — กดปุ่มจริงแล้วดูว่า DOM เปลี่ยนตาม
 *   6. **API ล่มแล้วหน้าเว็บยังบอกผู้ใช้ไหม** (กฎ 4 สถานะของ STEP 5) — ปิดคำขอไป backend
 *      ด้วย `Network.setBlockedURLs` แล้วดูว่าได้แผง error ที่มี role="alert" ไม่ใช่หน้าขาว
 *
 * วิธีใช้ (ต้องเปิด `npm run dev` หรือ `npm start` ไว้ก่อน)
 *   node scripts/audit-chrome.mjs
 *   node scripts/audit-chrome.mjs --only=/admin
 *   node scripts/audit-chrome.mjs --width=360 --json=out.json
 *
 * โค้ดออก: 0 = ไม่พบปัญหา · 1 = พบปัญหา · 2 = รันไม่สำเร็จ
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prepareRoutes } from './lib/app-routes.mjs';
import { launchChrome, log, sleep, waitForHttp } from './lib/chrome.mjs';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '.env'));
} catch {
  /* ไม่มี .env ก็ปล่อยให้ error ของ database บอกเอง */
}

const { getPrisma } = await import('@teenstyle/database');

/* ───────────────────────────── ค่าตั้งต้น ───────────────────────────── */

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value = 'true'] = raw.replace(/^--/, '').split('=');

    return [key, value];
  }),
);

const WEB_BASE = args.get('web') ?? 'http://localhost:3000';
const API_BASE = args.get('api') ?? 'http://localhost:4000';
const WIDTH = Number(args.get('width') ?? 1280);
const ONLY = args.get('only') ?? '';
const JSON_OUT = args.get('json') ?? '';
const DEBUG_PORT = Number(args.get('port') ?? 9412);

/**
 * ข้อความ console ที่ยอมให้ผ่านได้ พร้อมเหตุผล — **ต้องแคบที่สุดเท่าที่ทำได้**
 *
 * ⚠️ ทุกครั้งที่เพิ่มบรรทัดที่นี่ คือการลดความสามารถของตัวตรวจลง
 *    ต้องเขียนเหตุผลไว้ด้วยว่าทำไมไม่ใช่บั๊กของเรา ไม่ใช่เพิ่มเพราะ "มันรำคาญ"
 */
const IGNORED_CONSOLE = [
  {
    match: /Download the React DevTools/i,
    why: 'คำแนะนำของ React เอง ไม่ใช่ปัญหาของหน้าเว็บ',
  },
  {
    match: /\[Fast Refresh\]|webpack-hmr|turbopack-hmr/i,
    why: 'ข้อความของเครื่องมือตอน dev เท่านั้น',
  },
];

const isIgnored = (text) => IGNORED_CONSOLE.some((rule) => rule.match.test(text));

/**
 * การกดจริงที่ต้องได้ผลจริง — พิสูจน์ว่า JavaScript ทำงานและ CSP ไม่ได้บล็อก chunk ของ Next
 *
 * เลือกเฉพาะอย่างที่ **พังเงียบ** ถ้า JS ไม่ทำงาน: หน้ายังแสดงครบ ปุ่มยังเห็น แต่กดแล้วไม่มีอะไรเกิด
 */
const INTERACTIONS = [
  {
    route: '/',
    width: 360,
    name: 'กดปุ่มเมนูบนจอเล็กแล้วต้องมีหน้าต่างเปิดขึ้น',
    /* eslint-disable no-undef -- โค้ดนี้ถูกส่งไปรันในเบราว์เซอร์ ไม่ใช่ใน Node */
    script: `(async () => {
      const open = [...document.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === 'เปิดเมนู');
      if (!open) return { ok: false, reason: 'ไม่พบปุ่มเปิดเมนู' };
      if (document.querySelector('[role="dialog"]')) return { ok: false, reason: 'มีหน้าต่างเปิดอยู่ก่อนกด' };
      open.click();
      await new Promise((r) => setTimeout(r, 400));
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { ok: false, reason: 'กดแล้วไม่มี [role=dialog] โผล่ — JavaScript ไม่ทำงาน' };
      const closed = document.body.style.overflow === 'hidden';
      return { ok: closed, reason: closed ? '' : 'หน้าต่างเปิดแต่ไม่ได้ล็อก scroll ของหน้าเบื้องหลัง' };
    })()`,
  },
  {
    route: '/product/{productSlug}',
    width: 1280,
    name: 'กดเพิ่มจำนวนแล้วเลขในช่องต้องเปลี่ยน',
    script: `(async () => {
      const box = document.querySelector('input[type="number"]');
      const plus = [...document.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === 'เพิ่มจำนวน');
      if (!box || !plus) return { ok: false, reason: 'ไม่พบช่องจำนวนหรือปุ่มเพิ่ม' };
      if (plus.disabled) return { ok: true, reason: 'ปุ่มถูกปิดเพราะของหมด — ข้าม' };
      const before = box.value;
      plus.click();
      await new Promise((r) => setTimeout(r, 300));
      const after = document.querySelector('input[type="number"]').value;
      return after !== before
        ? { ok: true, reason: '' }
        : { ok: false, reason: 'กดแล้วเลขไม่เปลี่ยน (' + before + ' → ' + after + ')' };
    })()`,
  },
  {
    route: '/faq',
    width: 1280,
    name: 'ค้นหาในคลังความรู้แล้วหน้าต้องตอบสนอง',
    /**
     * ช่องนี้กรองตอน **submit** ไม่ใช่พิมพ์แล้วกรองสด (ลดการยิง API ทุกตัวอักษร)
     * จึงต้องส่งฟอร์มจริง แล้วดูว่าแบนเนอร์ผลการค้นหาโผล่ — ซึ่งพิสูจน์ว่า
     * JS ทำงาน · ยิง API ได้ · และ re-render จริง
     */
    script: `(async () => {
      const input = document.getElementById('faq-search');
      if (!input) return { ok: false, reason: 'ไม่พบช่องค้นหา #faq-search' };
      const form = input.closest('form');
      if (!form) return { ok: false, reason: 'ช่องค้นหาไม่ได้อยู่ในฟอร์ม — กด Enter แล้วจะไม่เกิดอะไร' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'ค่าส่ง');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        if (document.body.innerText.includes('ผลการค้นหาสำหรับ')) return { ok: true, reason: '' };
      }
      return { ok: false, reason: 'ส่งคำค้นแล้วไม่มีแบนเนอร์ผลการค้นหาขึ้นเลย' };
    })()`,
  },
  /* eslint-enable no-undef */
];

/* ───────────────────────────── ตัวตรวจหนึ่งหน้า ───────────────────────────── */

async function inspectPage(
  cdp,
  { url, as, expectStatus = 200 },
  tokens,
  { blockApi = false } = {},
) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const consoleErrors = [];
  const exceptions = [];
  const cspViolations = [];
  const failedRequests = [];
  const offs = [];
  let documentStatus = null;

  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);

    offs.push(
      cdp.on('Runtime.consoleAPICalled', sessionId, (params) => {
        if (params.type !== 'error' && params.type !== 'warning') return;

        const text = (params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? '')
          .join(' ')
          .trim();

        if (text === '' || isIgnored(text)) return;
        if (/content security policy/i.test(text)) cspViolations.push(text);
        else consoleErrors.push({ level: params.type, text: text.slice(0, 300) });
      }),
      cdp.on('Runtime.exceptionThrown', sessionId, (params) => {
        const detail = params.exceptionDetails ?? {};
        const text = detail.exception?.description ?? detail.text ?? 'exception ที่ไม่มีรายละเอียด';

        if (!isIgnored(text)) exceptions.push(String(text).slice(0, 300));
      }),
      cdp.on('Log.entryAdded', sessionId, (params) => {
        const entry = params.entry ?? {};

        if (entry.level !== 'error' && entry.level !== 'warning') return;

        const text = String(entry.text ?? '');

        if (isIgnored(text)) return;
        if (entry.source === 'security' || /content security policy/i.test(text)) {
          cspViolations.push(text.slice(0, 300));
        }
      }),
      cdp.on('Network.loadingFailed', sessionId, (params) => {
        // คำขอที่เราสั่งบล็อกเองไม่ใช่ความผิดของหน้าเว็บ
        if (blockApi && params.blockedReason === 'inspector') return;
        failedRequests.push({
          reason: params.errorText ?? params.blockedReason,
          type: params.type,
        });
      }),
      cdp.on('Network.responseReceived', sessionId, (params) => {
        const { status, url: requestUrl } = params.response ?? {};

        /**
         * เอกสารหลักของหน้าถูกตรวจแยกด้วย `expectStatus` — หน้า 404 **ต้อง** ตอบ 404
         * จึงห้ามนับเป็น "คำขอล้ม" (ไม่งั้นการทำถูกกลายเป็นความผิด แล้วคนเลิกอ่านผลตรวจ)
         */
        if (params.type === 'Document') {
          documentStatus = status;
          return;
        }

        /**
         * 401/403 ของ endpoint ที่ต้องล็อกอินเป็นพฤติกรรมที่ถูกต้องเมื่อเปิดหน้าแบบ guest
         * แต่ 4xx/5xx อื่นระหว่างโหลดหน้าคือของที่ผู้ใช้เห็นเป็นหน้าพัง
         */
        if (status >= 400 && !(as === 'guest' && (status === 401 || status === 403))) {
          failedRequests.push({ status, url: String(requestUrl).slice(0, 160), type: params.type });
        }
      }),
    );

    await cdp.send('Network.clearBrowserCookies', {}, sessionId);

    const token = tokens[as];

    if (token) {
      await cdp.send(
        'Network.setCookie',
        {
          name: 'authjs.session-token',
          value: token,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
        },
        sessionId,
      );
    }

    if (blockApi) {
      // ตัดทางที่หน้าเว็บใช้คุยกับ backend ทั้งหมด เพื่อดูว่ามันบอกผู้ใช้ไหม
      await cdp.send('Network.setBlockedURLs', { urls: [`${API_BASE}/*`, '*/api/*'] }, sessionId);
    }

    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 700 },
      sessionId,
    );

    await cdp.send('Page.navigate', { url: `${WEB_BASE}${url}` }, sessionId);
    await cdp.once('Page.loadEventFired', sessionId, 60_000).catch(() => undefined);
    // ให้เวลา hydrate และให้ client component ยิงคำขอชุดแรกของตัวเอง
    await sleep(1200);

    const snapshot = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => ({
          hasAlert: document.querySelector('[role="alert"]') !== null,
          alertText: (document.querySelector('[role="alert"]')?.textContent ?? '').trim().slice(0, 160),
          bodyLength: document.body.innerText.trim().length,
          title: document.title,
        }))()`,
        returnByValue: true,
      },
      sessionId,
    );

    const statusMismatch =
      documentStatus !== null && documentStatus !== expectStatus
        ? `เอกสารตอบ ${documentStatus} แต่ต้องเป็น ${expectStatus}`
        : null;

    return {
      url,
      as,
      documentStatus,
      expectStatus,
      statusMismatch,
      consoleErrors,
      exceptions,
      cspViolations,
      failedRequests,
      ...(snapshot.result?.value ?? {}),
    };
  } finally {
    for (const off of offs) off();
    await cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
  }
}

/* ───────────────────────────── การกดจริง ───────────────────────────── */

async function runInteraction(cdp, interaction, resolvedUrl, tokens, as) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Network.clearBrowserCookies', {}, sessionId);

    if (tokens[as]) {
      await cdp.send(
        'Network.setCookie',
        {
          name: 'authjs.session-token',
          value: tokens[as],
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
        },
        sessionId,
      );
    }

    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: interaction.width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: interaction.width < 700,
      },
      sessionId,
    );

    await cdp.send('Page.navigate', { url: `${WEB_BASE}${resolvedUrl}` }, sessionId);
    await cdp.once('Page.loadEventFired', sessionId, 60_000).catch(() => undefined);
    await sleep(1500);

    const result = await cdp.send(
      'Runtime.evaluate',
      { expression: interaction.script, awaitPromise: true, returnByValue: true },
      sessionId,
    );

    if (result.exceptionDetails) {
      return { ok: false, reason: `สคริปต์ทดสอบล้ม: ${result.exceptionDetails.text}` };
    }

    return result.result?.value ?? { ok: false, reason: 'สคริปต์ไม่คืนค่า' };
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
  }
}

/* ───────────────────────────── main ───────────────────────────── */

async function main() {
  const prisma = getPrisma();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'teenstyle-chrome-'));
  let chrome;
  let cdp;
  let createdSessions = [];

  try {
    log('รอเซิร์ฟเวอร์…');
    await waitForHttp(`${API_BASE}/health`, 'backend');
    await waitForHttp(WEB_BASE, 'frontend');

    const prepared = await prepareRoutes({
      prisma,
      apiBase: API_BASE,
      only: ONLY,
      tokenPrefix: 'audit-chrome',
    });

    createdSessions = prepared.createdSessions;

    const launched = await launchChrome({
      chromePath: args.get('chrome'),
      debugPort: DEBUG_PORT,
      userDataDir,
    });

    chrome = launched.chrome;
    cdp = launched.cdp;
    log(`ใช้ ${launched.browser} · กว้าง ${WIDTH}px\n`);

    const results = [];

    log('=== เปิดทุกหน้าแล้วฟังสิ่งที่เบราว์เซอร์รายงาน ===');
    for (const route of prepared.routes) {
      const result = await inspectPage(cdp, route, prepared.tokens);
      const problems =
        result.exceptions.length +
        result.cspViolations.length +
        result.consoleErrors.length +
        result.failedRequests.length +
        (result.statusMismatch ? 1 : 0);

      results.push(result);
      log(`  ${problems === 0 ? 'ok  ' : 'พบ ' + problems} ${route.url}`);
    }

    log('\n=== กดจริงแล้วต้องเกิดผลจริง ===');
    const interactionResults = [];

    for (const interaction of INTERACTIONS) {
      const match = prepared.routes.find(
        (route) => route.path === interaction.route || route.url === interaction.route,
      );

      if (!match) {
        log(`  ข้าม ${interaction.name} (ไม่มีเส้นทาง ${interaction.route} ในรอบนี้)`);
        continue;
      }

      const outcome = await runInteraction(cdp, interaction, match.url, prepared.tokens, match.as);

      interactionResults.push({ ...interaction, ...outcome, url: match.url });
      log(
        `  ${outcome.ok ? 'ok  ' : 'ล้ม '} ${interaction.name}${outcome.reason ? ` — ${outcome.reason}` : ''}`,
      );
    }

    /**
     * กฎ STEP 5 ข้อ 1: ส่วนที่ดึงข้อมูลต้องจับ error ของตัวเอง แล้วบอกผู้ใช้
     * ตัดทาง backend แล้วหน้าต้องมี `role="alert"` ไม่ใช่หน้าว่างที่ดูเหมือนไม่มีข้อมูล
     *
     * ⚠️ ตรวจได้เฉพาะหน้าที่ **ดึงข้อมูลจากเบราว์เซอร์** (client component)
     *    การบล็อก URL ที่ชั้นเบราว์เซอร์ไม่มีผลกับ Server Component เลย เพราะคำขอนั้น
     *    ออกจาก process ของ Next ไม่ได้ออกจากเบราว์เซอร์ — เคยเข้าใจผิดตอนเขียนสคริปต์นี้
     *    แล้วได้ผลว่า `/admin` "ไม่มี alert" ทั้งที่หน้ายังโหลดข้อมูลได้ปกติ
     *    การทดสอบ error state ของหน้าที่เรนเดอร์ฝั่ง server ต้องปิด backend จริง ๆ
     *    (ทำใน production build ตอน STEP 30 แล้ว — ดู docs)
     */
    log('\n=== ปิดทาง backend แล้วหน้าที่ดึงข้อมูลจากเบราว์เซอร์ต้องบอกผู้ใช้ ===');
    const offlineChecks = [];
    const BROWSER_FETCHING_PAGES = ['/admin/knowledge', '/admin/support', '/customer-service'];
    const offlineTargets = prepared.routes.filter((route) =>
      BROWSER_FETCHING_PAGES.includes(route.url),
    );

    for (const route of offlineTargets) {
      const result = await inspectPage(cdp, route, prepared.tokens, { blockApi: true });
      const ok = result.hasAlert === true;

      offlineChecks.push({ url: route.url, ok, alertText: result.alertText, ...result });
      log(
        `  ${ok ? 'ok  ' : 'ล้ม '} ${route.url}${ok ? ` — "${result.alertText.slice(0, 60)}…"` : ' — ไม่มี role="alert" ให้ผู้ใช้เห็น'}`,
      );
    }

    /* ───── สรุป ───── */

    const pagesWithProblems = results.filter(
      (r) =>
        r.exceptions.length > 0 ||
        r.cspViolations.length > 0 ||
        r.consoleErrors.length > 0 ||
        r.failedRequests.length > 0 ||
        r.statusMismatch !== null,
    );
    const failedInteractions = interactionResults.filter((r) => !r.ok);
    const failedOffline = offlineChecks.filter((r) => !r.ok);

    log('\n──────── สรุป ────────');
    log(
      `เปิด ${results.length} หน้า · มีปัญหา ${pagesWithProblems.length} · ` +
        `กดจริง ${interactionResults.length} อย่าง ล้ม ${failedInteractions.length} · ` +
        `ตรวจตอน API ล่ม ${offlineChecks.length} หน้า ล้ม ${failedOffline.length}`,
    );

    if (prepared.missingRoles.length > 0) {
      log(
        `\n⚠️ ข้ามหน้าของบทบาท ${prepared.missingRoles.join(', ')} เพราะไม่มีบัญชีในฐานข้อมูล` +
          ' — ขอบเขตการตรวจรอบนี้แคบกว่าปกติ',
      );
    }

    for (const page of pagesWithProblems) {
      log(`\n[${page.as}] ${page.url}`);
      if (page.statusMismatch) log(`  status ไม่ตรง  ${page.statusMismatch}`);
      for (const item of page.cspViolations.slice(0, 4)) log(`  CSP บล็อก      ${item}`);
      for (const item of page.exceptions.slice(0, 4)) log(`  exception      ${item}`);
      for (const item of page.consoleErrors.slice(0, 6))
        log(`  console.${item.level.padEnd(7)} ${item.text}`);
      for (const item of page.failedRequests.slice(0, 6)) {
        log(`  คำขอล้ม        ${item.status ?? item.reason} ${item.url ?? item.type ?? ''}`);
      }
    }

    if (JSON_OUT) {
      /**
       * เขียนไฟล์ผลไม่สำเร็จ **ห้ามทำให้ผลตรวจกลายเป็นล้มเหลว** — มันเป็นเรื่องรอบข้าง
       * (เจอตอน STEP 39: path ที่ Git Bash ไม่ได้แปลงทำให้เขียนไม่ได้ แล้วสคริปต์ออก 2
       *  ทั้งที่ตรวจผ่านหมด 33 หน้า — เครื่องมือที่รายงานล้มเหลวผิดเรื่องคือเครื่องมือที่เชื่อไม่ได้)
       */
      try {
        writeFileSync(
          JSON_OUT,
          JSON.stringify({ results, interactionResults, offlineChecks }, null, 2),
          'utf8',
        );
        log(`\nเขียนผลละเอียดไว้ที่ ${JSON_OUT}`);
      } catch (error) {
        log(`\n⚠️ เขียนไฟล์ผลไม่สำเร็จ (${error.message}) — ผลตรวจด้านบนยังใช้ได้`);
      }
    }

    /**
     * ⚠️ ตรวจ 0 หน้าแล้วบอกว่า "ไม่พบปัญหา" คือการผ่านแบบหลอก ๆ
     *    (เกิดจริงตอนเขียนสคริปต์นี้: `--only=/faq` ถูก Git Bash แปลงเป็น path ของ Windows
     *     แล้วตัวกรองไม่ match อะไรเลย — ผลออกมาเป็น exit 0 ทั้งที่ไม่ได้ตรวจอะไร)
     */
    if (results.length === 0) {
      log('\n❌ ไม่ได้ตรวจหน้าใดเลย — ตัวกรองไม่ตรงกับเส้นทางไหน หรือเตรียมข้อมูลไม่สำเร็จ');
      process.exitCode = 2;
      return;
    }

    process.exitCode =
      pagesWithProblems.length + failedInteractions.length + failedOffline.length > 0 ? 1 : 0;
  } finally {
    if (createdSessions.length) {
      await prisma.session
        .deleteMany({ where: { sessionToken: { in: createdSessions } } })
        .catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
    if (cdp) {
      try {
        await cdp.send('Browser.close');
      } catch {
        /* ปิดไปแล้ว */
      }
    }
    if (chrome) chrome.kill();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ลบไม่ได้ก็ปล่อย */
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 2;
});
