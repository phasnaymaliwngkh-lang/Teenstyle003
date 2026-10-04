/**
 * ตรวจ responsive ของทุกหน้าด้วย Chrome จริง (STEP 31)
 *
 * ทำไมต้องใช้เบราว์เซอร์จริง: การอ่านคลาส Tailwind ในซอร์สบอกไม่ได้ว่า "ล้นจริงไหม"
 * เพราะการล้นเกิดจากผลรวมของ padding + gap + ความกว้างของเนื้อหาจริง (ชื่อสินค้า เลขออเดอร์
 * อีเมลลูกค้า) ที่ไม่มีอยู่ในซอร์ส · ตัวชี้ขาดคือ `documentElement.scrollWidth > clientWidth`
 * ซึ่งวัดได้ที่เบราว์เซอร์เท่านั้น
 *
 * ใช้ Chrome ที่ติดตั้งในเครื่องผ่าน CDP โดยตรง (ไม่มี puppeteer/playwright เป็น dependency)
 * เพราะ Node 24 มี `WebSocket` เป็น global อยู่แล้ว
 *
 * วิธีใช้ (ต้องเปิด `npm run dev` หรือ `npm start` ไว้ก่อน)
 *   node scripts/audit-responsive.mjs
 *   node scripts/audit-responsive.mjs --widths=360 --json=out.json
 *   node scripts/audit-responsive.mjs --only=/admin
 *
 * โค้ดออก: 0 = ไม่พบปัญหา · 1 = พบปัญหา · 2 = รันไม่สำเร็จ (เปิดเซิร์ฟเวอร์ไม่ได้ ฯลฯ)
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prepareRoutes } from './lib/app-routes.mjs';
import { launchChrome, log, sleep, waitForHttp } from './lib/chrome.mjs';

// ต้องโหลด .env ก่อน import @teenstyle/database เพราะ getPrisma() อ่าน DATABASE_URL ตอนสร้าง client
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '.env'));
} catch {
  /* ไม่มี .env ก็ปล่อยให้ error ของ database บอกเอง */
}

const { getPrisma } = await import('@teenstyle/database');

// ───────────────────────────── ค่าตั้งต้น ─────────────────────────────

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value = 'true'] = raw.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const WEB_BASE = args.get('web') ?? 'http://localhost:3000';
const API_BASE = args.get('api') ?? 'http://localhost:4000';
const WIDTHS = (args.get('widths') ?? '360,768,1280').split(',').map((n) => Number(n.trim()));
const ONLY = args.get('only') ?? '';
const JSON_OUT = args.get('json') ?? '';
const DEBUG_PORT = Number(args.get('port') ?? 9411);

/** เกณฑ์ขนาดปุ่มขั้นต่ำ — กฎข้อ 11 ของ CLAUDE.md */
const MIN_TOUCH = 44;

// ───────────────── สคริปต์ที่รันในหน้าเว็บเพื่อวัดของจริง ─────────────────

/**
 * ตรวจ 3 อย่างในหน้าเดียว แล้วคืนผลเป็น JSON
 *
 *   1. หน้าเลื่อนซ้ายขวาได้ไหม (`scrollWidth > clientWidth`) — ตัวชี้ขาดตามกฎข้อ 11
 *   2. อิลิเมนต์ไหนเป็นตัวที่ยื่นออกไป และมีบรรพบุรุษที่เลื่อนได้รับไว้หรือไม่
 *      (ตารางในกล่อง `overflow-x-auto` ยื่นได้ ไม่ถือว่าผิด · ยื่นทะลุหน้าถือว่าผิด)
 *   3. ปุ่ม/ลิงก์/ช่องกรอกที่พื้นที่กดเล็กกว่า 44px
 *
 * หมายเหตุ: ต้องเป็นสตริงเพราะถูกส่งเข้า `Runtime.evaluate` ของ CDP
 */
const AUDIT_EXPRESSION = String.raw`
(() => {
  const MIN_TOUCH = ${MIN_TOUCH};
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;

  const isDevOverlay = (el) => {
    for (let node = el; node; node = node.parentElement) {
      if (node.tagName === "NEXTJS-PORTAL") return true;
    }
    return false;
  };

  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const classes = typeof el.className === "string" ? el.className.trim().slice(0, 120) : "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes,
      text,
      left: Math.round(rect.left * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  };

  /** กล่องที่เลื่อน/ตัดแนวนอนที่ใกล้ที่สุด — บอกว่าใครรับส่วนที่ยื่นออกไป */
  const clippingAncestor = (el) => {
    for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") {
        return { node, overflowX };
      }
    }
    return null;
  };

  /**
   * "เป็นตัวควบคุมที่ต้องกดไหม" — ใช้แยกของที่ต้องมีพื้นที่กด 44px ออกจากลิงก์ข้อความในเนื้อหา
   *
   * ปุ่ม ช่องกรอก ตัวเลือก และ <a> ที่ถูกแต่งเป็นปุ่ม (มีเส้นขอบ พื้นหลัง หรือ padding)
   * ต้องได้ 44px · ส่วนลิงก์ข้อความที่ไหลอยู่ในประโยค ในเบรดครัมบ์ หรือในช่องตาราง
   * เข้าข้อยกเว้น "inline" ของ WCAG 2.5.5 — ขยายให้ 44px จะทำให้บรรทัดข้อความเสียรูป
   */
  const controlLike = (el, style) => {
    if (
      el.matches(
        "button, select, textarea, input, summary, [role='button'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio']",
      )
    ) {
      return true;
    }
    const borders = [
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
    ].some((key) => parseFloat(style[key]) > 0);
    const filled =
      style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
    const padded = parseFloat(style.paddingTop) >= 6 || parseFloat(style.paddingLeft) >= 10;
    const boxy = style.display === "grid" || style.display.endsWith("flex");
    return borders || filled || (padded && boxy);
  };

  const hidden = (el, style, rect) => {
    if (style.visibility === "hidden" || style.display === "none") return true;
    if (rect.width <= 1 && rect.height <= 1) return true; // sr-only / ตัวช่วย screen reader
    if (style.clipPath && style.clipPath !== "none" && rect.width <= 2) return true;
    if (el.closest("[aria-hidden='true']")) return true;
    return false;
  };

  const overflow = [];
  const clipped = [];
  const smallTargets = [];
  const inlineSmall = [];

  for (const el of document.querySelectorAll("body *")) {
    if (isDevOverlay(el)) continue;

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (hidden(el, style, rect)) continue;

    // ── 1) ยื่นออกนอกจอ
    if (rect.right > viewportWidth + 1 || rect.left < -1) {
      const holder = clippingAncestor(el);
      const entry = describe(el);
      if (!holder) {
        overflow.push(entry);
      } else if (holder.overflowX === "hidden" || holder.overflowX === "clip") {
        // ไม่ทำให้หน้าเลื่อน แต่เนื้อหาถูกตัดหาย — ผู้ใช้อ่านไม่ครบ
        entry.clippedBy = holder.node.tagName.toLowerCase() +
          (typeof holder.node.className === "string" ? "." + holder.node.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
        clipped.push(entry);
      }
      // overflow-x: auto/scroll = เลื่อนดูได้ตามที่ออกแบบไว้ ไม่นับเป็นปัญหา
    }

    // ── 2) พื้นที่กด
    const interactive =
      el.matches("a[href], button, input, select, textarea, summary, [role='button'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio'], [tabindex]:not([tabindex='-1'])");
    if (!interactive) continue;
    if (el.matches("input[type='hidden']")) continue;

    /*
     * ป้าย label ที่ครอบช่องกรอกไว้ **คือ** พื้นที่กดจริง — กดที่ไหนในป้ายก็โฟกัสช่องนั้น
     * (แพตเทิร์นของโปรเจกต์นี้: ป้ายเป็นแคปซูลสูง 48px แล้วข้างในเป็น input โปร่งใส)
     * ถ้าวัดแค่ตัว input จะได้สูง ~20px แล้วรายงานผิดว่าเล็กเกินไปทั้งที่กดได้เต็มแคปซูล
     */
    let target = el;
    if (el.matches("input, select, textarea")) {
      const label = el.closest("label");
      if (label) target = label;
    }
    const targetRect = target.getBoundingClientRect();
    const tooSmall = targetRect.width < MIN_TOUCH - 0.5 || targetRect.height < MIN_TOUCH - 0.5;
    if (!tooSmall) continue;

    const entry = describe(target);
    if (controlLike(el, style)) smallTargets.push(entry);
    else inlineSmall.push(entry); // ลิงก์ข้อความในเนื้อหา = ข้อยกเว้นของ WCAG 2.5.5
  }

  /*
   * หน้าที่กำลังแสดง "สถานะผิดพลาด" ไม่ได้แสดงเลย์เอาต์จริงของตัวเอง
   * เจอจริงตอนตรวจ: ยิงทุกหน้าติด ๆ กันจาก IP เดียวทำให้ชน rate limit ของ API เอง (300 คำขอ/15 นาที)
   * แล้วหลายหน้ากลายเป็นแผง "โหลดข้อมูลส่วนนี้ไม่สำเร็จ" ซึ่งสั้นและไม่ล้น — **ผ่านการตรวจแบบหลอก ๆ**
   * จึงต้องรายงานไว้ว่าหน้าไหนน่าสงสัย ไม่ใช่นับว่าผ่าน
   */
  const pageText = document.body ? document.body.innerText || "" : "";
  const failureHints = [
    "ส่งคำขอถี่เกินไป",
    "โหลดข้อมูลส่วนนี้ไม่สำเร็จ",
    "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้",
    "เกิดข้อผิดพลาดภายในระบบ",
    "เกิดข้อผิดพลาดบางอย่าง",
  ].filter((hint) => pageText.includes(hint));

  return JSON.stringify({
    viewportWidth,
    scrollWidth: root.scrollWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    pageOverflows: root.scrollWidth > viewportWidth,
    failureHints,
    title: document.title,
    overflow,
    clipped,
    smallTargets,
    inlineSmall,
  });
})()
`;

async function main() {
  const prisma = getPrisma();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'teenstyle-audit-'));
  /** ส่งเข้าไปให้ prepareRoutes จดลงทันที — ลบใน finally ได้แม้มันโยน error กลางทาง */
  const createdSessions = [];
  let chrome;
  let cdp;

  try {
    log('รอเซิร์ฟเวอร์…');
    await waitForHttp(`${API_BASE}/health`, 'backend');
    await waitForHttp(WEB_BASE, 'frontend');

    const { routes, tokens } = await prepareRoutes({
      prisma,
      apiBase: API_BASE,
      only: ONLY,
      tokenPrefix: 'audit-responsive',
      createdSessions,
    });

    const launched = await launchChrome({
      chromePath: args.get('chrome'),
      debugPort: DEBUG_PORT,
      userDataDir,
    });

    chrome = launched.chrome;
    cdp = launched.cdp;
    log(`ใช้ ${launched.browser}`);

    const results = [];

    for (const width of WIDTHS) {
      log(`\n=== กว้าง ${width}px ===`);
      const mobile = width < 700;

      for (const route of routes) {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

        try {
          await cdp.send('Page.enable', {}, sessionId);
          await cdp.send('Runtime.enable', {}, sessionId);
          await cdp.send('Network.enable', {}, sessionId);
          await cdp.send(
            'Emulation.setDeviceMetricsOverride',
            {
              width,
              height: 900,
              deviceScaleFactor: 1,
              mobile,
              screenWidth: width,
              screenHeight: 900,
            },
            sessionId,
          );

          /*
           * ⚠️ cookie เป็นของโปรไฟล์เบราว์เซอร์ ไม่ใช่ของแท็บ — ทุกหน้าในรอบเดียวกันจึงใช้ร่วมกัน
           * เจอจริง: รอบแรกไล่หน้า guest ก่อนจึงสะอาด แต่รอบความกว้างถัดไป cookie ของ admin
           * ที่ค้างจากรอบก่อนทำให้หน้า "guest" ถูกตรวจในฐานะ admin (เห็นตะกร้าและ navbar คนละชุด)
           * → ล้าง cookie ก่อนทุกหน้า แล้วใส่เฉพาะของบทบาทที่ตั้งใจ
           */
          await cdp.send('Network.clearBrowserCookies', {}, sessionId);

          const token = tokens[route.as];
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

          const url = `${WEB_BASE}${encodeURI(route.url)}`;
          const loaded = cdp.once('Page.loadEventFired', sessionId, 60_000);
          const nav = await cdp.send('Page.navigate', { url }, sessionId);
          if (nav.errorText) throw new Error(`โหลด ${url} ไม่สำเร็จ: ${nav.errorText}`);
          await loaded;

          // รอฟอนต์และการจัดหน้าให้นิ่ง — ฟอนต์ไทยเปลี่ยนความกว้างของข้อความ
          await cdp.send(
            'Runtime.evaluate',
            { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true },
            sessionId,
          );
          await sleep(400);

          const evaluated = await cdp.send(
            'Runtime.evaluate',
            { expression: AUDIT_EXPRESSION, returnByValue: true },
            sessionId,
          );
          if (evaluated.exceptionDetails) {
            throw new Error(`สคริปต์ตรวจล้ม: ${evaluated.exceptionDetails.text}`);
          }

          const report = JSON.parse(evaluated.result.value);
          results.push({ width, route: route.url, as: route.as, ...report });

          const problems =
            (report.pageOverflows ? 1 : 0) + report.clipped.length + report.smallTargets.length;
          const mark = problems === 0 ? 'ok  ' : 'พบ  ';
          const detail = report.pageOverflows
            ? `หน้าเลื่อนแนวนอน ${report.scrollWidth} > ${report.viewportWidth}`
            : '';
          log(
            `  ${mark} ${route.url}` +
              (problems
                ? `  [ยื่น ${report.overflow.length} · ถูกตัด ${report.clipped.length} · ปุ่มเล็ก ${report.smallTargets.length}] ${detail}`
                : '') +
              (report.failureHints.length
                ? `  ⚠️ หน้าอยู่ในสถานะผิดพลาด: ${report.failureHints.join(', ')}`
                : ''),
          );
        } finally {
          await cdp.send('Target.closeTarget', { targetId });
        }
      }
    }

    // ───── สรุป ─────
    const suspect = results.filter((r) => r.failureHints.length > 0);
    const failing = results.filter(
      (r) => r.pageOverflows || r.clipped.length > 0 || r.smallTargets.length > 0,
    );

    log('\n──────── สรุป ────────');
    log(`ตรวจ ${results.length} หน้า-ความกว้าง · มีปัญหา ${failing.length}`);

    if (suspect.length) {
      log(
        `
⚠️ ${suspect.length} หน้า-ความกว้างแสดงสถานะผิดพลาดตอนตรวจ — ผลของหน้าเหล่านี้เชื่อไม่ได้` +
          ' (แผง error สั้นกว่าเนื้อหาจริงจึงไม่ล้น = ผ่านแบบหลอก ๆ)',
      );
      for (const r of suspect) log(`  [${r.width}px] ${r.route} → ${r.failureHints.join(', ')}`);
      log(
        '  สาเหตุที่พบบ่อยคือชน rate limit ของ API เอง (ค่าเริ่มต้น 300 คำขอ/15 นาที ต่อ IP)' +
          ' — เว้นระยะแล้วรันใหม่ หรือตั้ง RATE_LIMIT_MAX ให้สูงขึ้นใน .env ระหว่างตรวจ',
      );
    }
    for (const r of failing) {
      log(`\n[${r.width}px] ${r.route}`);
      if (r.pageOverflows)
        log(`  หน้าเลื่อนแนวนอนได้: scrollWidth ${r.scrollWidth} > ${r.viewportWidth}`);
      for (const item of r.overflow.slice(0, 6)) {
        log(
          `  ยื่นออกนอกจอ  <${item.tag} class="${item.classes}"> right=${item.right} w=${item.width} "${item.text}"`,
        );
      }
      for (const item of r.clipped.slice(0, 6)) {
        log(
          `  ถูกตัดหาย     <${item.tag} class="${item.classes}"> right=${item.right} โดย ${item.clippedBy} "${item.text}"`,
        );
      }
      for (const item of r.smallTargets.slice(0, 8)) {
        log(
          `  ปุ่มเล็กเกินไป <${item.tag} class="${item.classes}"> ${item.width}×${item.height} "${item.text}"`,
        );
      }
    }

    if (JSON_OUT) {
      writeFileSync(JSON_OUT, JSON.stringify(results, null, 2), 'utf8');
      log(`\nเขียนผลละเอียดไว้ที่ ${JSON_OUT}`);
    }

    process.exitCode = failing.length > 0 || suspect.length > 0 ? 1 : 0;
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
