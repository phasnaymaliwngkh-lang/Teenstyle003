/**
 * ตรวจ SEO ของทุกหน้าที่เปิดสาธารณะ (STEP 33)
 *
 * ตรวจในมุมของบ็อตที่ยังไม่ได้ล็อกอิน — ซึ่งเป็นมุมเดียวที่ search engine เห็นจริง ๆ
 * (หน้าที่ต้องล็อกอินจะถูก redirect ไป /signin ซึ่งเป็นพฤติกรรมที่ถูกต้องแล้ว
 *  สคริปต์จึงตรวจแค่ว่าปลายทางนั้นไม่ถูกเก็บเข้าดัชนี)
 *
 * ใช้ fetch ธรรมดา ไม่ต้องใช้เบราว์เซอร์ เพราะ metadata ทุกอย่างเรนเดอร์มากับ HTML อยู่แล้ว
 * (ถ้าวันหนึ่งมีอะไรที่ต้องรอ JS ถึงจะเห็น แปลว่าอันนั้นมีปัญหาเรื่อง SEO อยู่แล้ว)
 *
 * วิธีใช้ (ต้องเปิด `npm run dev` หรือ `npm start` ไว้ก่อน)
 *   node scripts/audit-seo.mjs
 *   node scripts/audit-seo.mjs --web=http://localhost:3000 --json=out.json
 *
 * โค้ดออก: 0 = ผ่านหมด · 1 = พบปัญหา · 2 = รันไม่สำเร็จ
 */

import { writeFileSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value = 'true'] = raw.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const WEB = (args.get('web') ?? 'http://localhost:3000').replace(/\/+$/, '');
const JSON_OUT = args.get('json') ?? '';

/** ความยาวที่ Google มักตัดทิ้งใน SERP — เกินแล้วไม่ผิด แต่ผู้ใช้จะไม่เห็นท้ายข้อความ */
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

/**
 * หน้าสาธารณะที่ต้องขึ้นดัชนีได้ (ถ้าหน้าไหนกลายเป็น noindex = ผิด)
 * `{...}` ถูกแทนด้วย slug จริงจาก sitemap
 */
const INDEXABLE = ['/', '/shop', '/looks', '/faq', '/customer-service', '/ai-stylist', '/about'];

/** หน้าที่ **ต้อง** ไม่ขึ้นดัชนี (ตะกร้า ผลค้นหาภายใน หน้าเข้าสู่ระบบ หน้าส่วนตัว) */
const MUST_NOINDEX = [
  '/cart',
  '/checkout',
  '/search',
  '/signin',
  '/shop?q=เสื้อ',
  '/looks?q=สตรีท',
];

const problems = [];
const notes = [];

function fail(where, message) {
  problems.push(`${where} — ${message}`);
}

function note(where, message) {
  notes.push(`${where} — ${message}`);
}

/* ─────────────────────── ตัวอ่าน HTML แบบง่าย ─────────────────────── */

function tagContent(html, regex) {
  const match = regex.exec(html);
  return match?.[1]?.trim() ?? null;
}

function metaContent(html, name, attribute = 'name') {
  const regex = new RegExp(
    `<meta[^>]+${attribute}=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const direct = regex.exec(html);
  if (direct) return direct[1];

  // บางครั้ง content มาก่อน name
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*${attribute}=["']${name}["']`,
    'i',
  );
  return reversed.exec(html)?.[1] ?? null;
}

function decodeEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'");
}

function parsePage(html) {
  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((raw) => raw !== undefined);

  return {
    title: tagContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: metaContent(html, 'description'),
    robots: metaContent(html, 'robots'),
    canonical: tagContent(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    ogTitle: metaContent(html, 'og:title', 'property'),
    ogDescription: metaContent(html, 'og:description', 'property'),
    ogImage: metaContent(html, 'og:image', 'property'),
    ogType: metaContent(html, 'og:type', 'property'),
    twitterCard: metaContent(html, 'twitter:card', 'name'),
    lang: tagContent(html, /<html[^>]+lang=["']([^"']+)["']/i),
    h1Count: [...html.matchAll(/<h1[\s>]/gi)].length,
    jsonLd,
  };
}

async function loadPage(path) {
  const url = `${WEB}${encodeURI(path)}`;
  const response = await fetch(url, { redirect: 'follow' });
  const html = await response.text();

  return {
    path,
    url,
    status: response.status,
    finalUrl: response.url,
    redirected: response.redirected,
    ...parsePage(html),
  };
}

/* ─────────────────────────── การตรวจแต่ละข้อ ─────────────────────────── */

function checkCommon(page) {
  const where = page.path;

  if (page.status !== 200) fail(where, `HTTP ${page.status}`);
  if (page.lang !== 'th') fail(where, `<html lang> ควรเป็น "th" แต่ได้ ${page.lang}`);

  if (page.title === null || page.title === '') {
    fail(where, 'ไม่มี <title>');
  } else {
    const title = decodeEntities(page.title);
    if (title.length > TITLE_MAX) {
      note(where, `title ยาว ${title.length} ตัวอักษร (เกิน ${TITLE_MAX} — SERP จะตัดท้ายทิ้ง)`);
    }
    // แบรนด์ควรโผล่ครั้งเดียว — เคยเจอ "… | TEENSTYLE AI | TeenStyle ✧"
    const brandHits = (title.match(/teenstyle/gi) ?? []).length;
    if (brandHits > 1) fail(where, `ชื่อแบรนด์ซ้ำ ${brandHits} ครั้งใน title: "${title}"`);
  }

  if (page.jsonLd.length > 0) {
    page.jsonLd.forEach((raw, index) => {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          fail(where, `JSON-LD ก้อนที่ ${index + 1} ไม่ใช่ object`);
          return;
        }
        if (parsed['@context'] === undefined)
          fail(where, `JSON-LD ก้อนที่ ${index + 1} ไม่มี @context`);
        if (parsed['@type'] === undefined) fail(where, `JSON-LD ก้อนที่ ${index + 1} ไม่มี @type`);
      } catch (error) {
        fail(where, `JSON-LD ก้อนที่ ${index + 1} parse ไม่ผ่าน: ${error.message}`);
      }
    });
  }
}

function checkIndexable(page) {
  const where = page.path;

  if (page.robots !== null && /noindex/i.test(page.robots)) {
    fail(where, `หน้านี้ควรขึ้นดัชนีได้ แต่ประกาศ robots="${page.robots}"`);
  }

  if (page.canonical === null) {
    fail(where, 'ไม่มี <link rel=canonical>');
  } else if (!page.canonical.startsWith('http')) {
    fail(where, `canonical ต้องเป็น URL เต็ม แต่ได้ "${page.canonical}"`);
  }

  if (page.description === null || page.description === '') {
    fail(where, 'ไม่มี meta description');
  } else {
    const length = decodeEntities(page.description).length;
    if (length < DESCRIPTION_MIN) note(where, `description สั้นไป (${length} ตัวอักษร)`);
    if (length > DESCRIPTION_MAX) note(where, `description ยาวไป (${length} ตัวอักษร)`);
  }

  if (page.ogTitle === null) fail(where, 'ไม่มี og:title');
  if (page.ogDescription === null) fail(where, 'ไม่มี og:description');
  if (page.ogImage === null) fail(where, 'ไม่มี og:image');
  if (page.twitterCard === null) fail(where, 'ไม่มี twitter:card');

  if (page.h1Count !== 1) {
    note(where, `มี <h1> ${page.h1Count} อัน (ควรมีหัวข้อหลักอันเดียวต่อหน้า)`);
  }
}

function checkNoindex(page) {
  const where = page.path;

  if (page.robots === null || !/noindex/i.test(page.robots)) {
    fail(
      where,
      `หน้านี้ต้องไม่ถูกเก็บเข้าดัชนี แต่ robots = ${page.robots === null ? 'ไม่มี' : `"${page.robots}"`}` +
        (page.redirected ? ` (redirect ไป ${page.finalUrl})` : ''),
    );
  }
}

/* ─────────────────────────────── main ─────────────────────────────── */

async function main() {
  const results = {};

  // ── robots.txt
  const robotsResponse = await fetch(`${WEB}/robots.txt`);
  const robotsText = await robotsResponse.text();
  if (robotsResponse.status !== 200) fail('/robots.txt', `HTTP ${robotsResponse.status}`);
  if (!/Sitemap:\s*\S+/i.test(robotsText)) fail('/robots.txt', 'ไม่ได้ชี้ไปที่ sitemap');

  const disallowed = [...robotsText.matchAll(/Disallow:\s*(\S+)/gi)].map((match) => match[1]);
  if (disallowed.length === 0) fail('/robots.txt', 'ไม่มี Disallow เลย (หลังบ้านจะถูกไล่คลาน)');

  // ── sitemap.xml
  const sitemapResponse = await fetch(`${WEB}/sitemap.xml`);
  const sitemapText = await sitemapResponse.text();
  if (sitemapResponse.status !== 200) fail('/sitemap.xml', `HTTP ${sitemapResponse.status}`);

  const sitemapUrls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (sitemapUrls.length === 0) fail('/sitemap.xml', 'ไม่มี URL เลย');

  const duplicates = sitemapUrls.filter((url, index) => sitemapUrls.indexOf(url) !== index);
  if (duplicates.length > 0)
    fail('/sitemap.xml', `มี URL ซ้ำ: ${[...new Set(duplicates)].join(', ')}`);

  for (const url of sitemapUrls) {
    if (!url.startsWith(WEB)) {
      fail('/sitemap.xml', `URL ข้ามโดเมน: ${url}`);
      continue;
    }
    const path = url.slice(WEB.length) || '/';
    // URL ที่เราเองสั่งห้ามคลาน ต้องไม่อยู่ใน sitemap
    const blocked = disallowed.find((rule) => rule !== '/' && path.startsWith(rule));
    if (blocked !== undefined) {
      fail('/sitemap.xml', `${path} ถูก Disallow: ${blocked} ใน robots.txt แต่ยังอยู่ใน sitemap`);
    }
  }

  // ── ทุกหน้าใน sitemap ต้องเปิดได้จริงและขึ้นดัชนีได้
  const sitemapPaths = sitemapUrls.map((url) => url.slice(WEB.length) || '/');
  const pathsToCheck = [...new Set([...INDEXABLE, ...sitemapPaths])];

  for (const path of pathsToCheck) {
    const page = await loadPage(path);
    results[path] = page;
    checkCommon(page);
    checkIndexable(page);
  }

  // ── หน้าที่ต้องไม่ขึ้นดัชนี
  for (const path of MUST_NOINDEX) {
    const page = await loadPage(path);
    results[path] = page;
    checkNoindex(page);
  }

  // ── title / description ซ้ำกันข้ามหน้า (สัญญาณว่าหน้าเหล่านั้นแยกกันไม่ออกในสายตา Google)
  const byTitle = new Map();
  const byOgTitle = new Map();
  for (const path of pathsToCheck) {
    const page = results[path];
    if (page?.title) byTitle.set(page.title, [...(byTitle.get(page.title) ?? []), path]);
    if (page?.ogTitle) byOgTitle.set(page.ogTitle, [...(byOgTitle.get(page.ogTitle) ?? []), path]);
  }
  for (const [title, paths] of byTitle) {
    if (paths.length > 1)
      fail('ทั้งเว็บ', `title ซ้ำกัน ${paths.length} หน้า ("${title}"): ${paths.join(', ')}`);
  }
  for (const [ogTitle, paths] of byOgTitle) {
    if (paths.length > 1) {
      fail(
        'ทั้งเว็บ',
        `og:title ซ้ำกัน ${paths.length} หน้า ("${ogTitle}") — การ์ดตอนแชร์จะเหมือนกันหมด: ${paths.slice(0, 5).join(', ')}`,
      );
    }
  }

  // ── canonical ต้องไม่ชี้ไปหน้าที่ canonical ของมันเป็นคนละอัน (ห่วงโซ่ที่ Google จะไม่ตาม)
  for (const path of pathsToCheck) {
    const page = results[path];
    if (!page?.canonical) continue;
    const canonicalPath = page.canonical.startsWith(WEB)
      ? page.canonical.slice(WEB.length) || '/'
      : null;
    if (canonicalPath === null) {
      fail(path, `canonical ชี้ออกนอกโดเมน: ${page.canonical}`);
      continue;
    }
    if (canonicalPath === path) continue;

    const target = results[canonicalPath] ?? (await loadPage(canonicalPath));
    results[canonicalPath] = target;
    if (target.canonical !== page.canonical) {
      fail(
        path,
        `canonical ชี้ไป ${canonicalPath} แต่หน้านั้น canonical เป็น ${target.canonical} (ห่วงโซ่ canonical)`,
      );
    }
  }

  /* ── สรุป ── */
  const log = (line) => process.stdout.write(`${line}\n`);

  log(`ตรวจ ${Object.keys(results).length} หน้า · sitemap ${sitemapUrls.length} URL`);

  if (notes.length > 0) {
    log(`\n── ข้อสังเกต (ไม่นับว่าผิด) ──`);
    for (const line of notes) log(`  · ${line}`);
  }

  if (problems.length > 0) {
    log(`\n── พบปัญหา ${problems.length} ข้อ ──`);
    for (const line of problems) log(`  ✗ ${line}`);
  } else {
    log('\n✅ ไม่พบปัญหา');
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ results, problems, notes }, null, 2), 'utf8');
    log(`\nเขียนผลละเอียดไว้ที่ ${JSON_OUT}`);
  }

  process.exitCode = problems.length > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 2;
});
