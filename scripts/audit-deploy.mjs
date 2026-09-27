#!/usr/bin/env node
/**
 * ตรวจของที่ใช้ deploy ให้ตรงกับ repo จริง (STEP 38)
 *
 * ทำไมต้องมี: Dockerfile กับ docker-compose.yml เป็น **โค้ดที่ไม่มีใครรัน**
 * บนเครื่องนี้ (Windows Home ไม่มี WSL2 → daemon ใช้ไม่ได้) ความผิดพลาดในนั้น
 * จึงไม่มีอะไรฟ้องเลยจนกว่าจะขึ้น production แล้วพัง — ซึ่งเป็นเวลาที่แพงที่สุดที่จะรู้
 *
 * สิ่งที่ตรวจทั้งหมดเป็น **ข้อเท็จจริงที่อ่านจาก repo ได้** ไม่ใช่การเดา:
 *   A. ทุก path ที่ Dockerfile สั่ง COPY ต้องมีอยู่จริง (ทั้งจาก build context และจาก stage ก่อนหน้า)
 *   B. workspace ที่ image นั้น build ต้องมี workspace ที่มันพึ่งพาอยู่ใน image ด้วย และถูก build ก่อน
 *   C. compose ต้องส่ง env/ARG ที่โค้ดต้องใช้จริง และห้ามชี้ไป localhost สำหรับค่าที่ใช้ภายใน network
 *   D. `.env.example` ต้องมีชื่อ env ทุกตัวที่โค้ดอ่าน และห้ามมีค่าจริง
 *
 * ⚠️ **สิ่งที่สคริปต์นี้ทำไม่ได้: บอกว่า image build ผ่าน** — ต้องมี Docker daemon
 *    มันบอกได้แค่ว่า "ไม่มีข้อผิดพลาดที่อ่านจาก repo ได้แล้ว" · ดู docs/06-deployment.md
 *
 * ใช้:
 *   node scripts/audit-deploy.mjs                # ตรวจ repo (A–D)
 *   node scripts/audit-deploy.mjs --env .env.prod  # ตรวจค่าในไฟล์ env สำหรับ production ด้วย
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const notes = [];
const passed = [];

function fail(area, message) {
  problems.push({ area, message });
}
function note(area, message) {
  notes.push({ area, message });
}
function ok(area, message) {
  passed.push({ area, message });
}

const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');
const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/* ═══════════════════════ อ่าน Dockerfile ═══════════════════════ */

/**
 * แยก Dockerfile เป็น stage — พอสำหรับงานตรวจนี้ (ไม่ต้องรองรับทุกไวยากรณ์ของ Docker)
 * รองรับบรรทัดต่อด้วย `\` เพราะ RUN ของเราเขียนหลายบรรทัด
 */
function parseDockerfile(text) {
  const logical = [];
  let buffer = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (line.trim().startsWith('#') || (line.trim() === '' && buffer === '')) continue;

    if (line.endsWith('\\')) {
      buffer += `${line.slice(0, -1).trim()} `;
      continue;
    }

    logical.push((buffer + line.trim()).trim());
    buffer = '';
  }
  if (buffer !== '') logical.push(buffer.trim());

  const stages = [];

  for (const line of logical) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i.exec(line);

    if (from) {
      stages.push({ name: from[2] ?? `stage${stages.length}`, base: from[1], instructions: [] });
      continue;
    }
    if (stages.length === 0) continue;

    const match = /^(\w+)\s+([\s\S]*)$/.exec(line);

    if (match) {
      stages[stages.length - 1].instructions.push({ cmd: match[1].toUpperCase(), rest: match[2] });
    }
  }

  return stages;
}

/** คืนรายการ COPY ของ stage: { from, sources[], dest } */
function copiesOf(stage) {
  return stage.instructions
    .filter((i) => i.cmd === 'COPY')
    .map((i) => {
      const tokens = i.rest.split(/\s+/);
      const flags = tokens.filter((t) => t.startsWith('--'));
      const paths = tokens.filter((t) => !t.startsWith('--'));
      const fromFlag = flags.find((f) => f.startsWith('--from='));

      return {
        from: fromFlag ? fromFlag.slice('--from='.length) : null,
        sources: paths.slice(0, -1),
        dest: paths[paths.length - 1],
      };
    });
}

const runCommandsOf = (stage) =>
  stage.instructions.filter((i) => i.cmd === 'RUN').map((i) => i.rest);
const argsOf = (stage) =>
  stage.instructions.filter((i) => i.cmd === 'ARG').map((i) => i.rest.split('=')[0].trim());

/* ═══════════════════════ A + B: Dockerfile ↔ repo ═══════════════════════ */

const WORKSPACES = ['frontend', 'backend', 'database'];

/** workspace ที่ `ws` พึ่งพาภายใน repo นี้ (จาก package.json จริง) */
function internalDepsOf(ws) {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, ws, 'package.json'), 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };

  return Object.keys(all)
    .filter((name) => name.startsWith('@teenstyle/'))
    .map((name) => name.replace('@teenstyle/', ''))
    .filter((name) => WORKSPACES.includes(name));
}

function auditDockerfile(file, buildsWorkspace) {
  const text = readIfExists(path.join(ROOT, file));

  if (text === null) {
    fail('A', `ไม่มีไฟล์ ${file} ที่ compose อ้างถึง`);
    return;
  }

  const stages = parseDockerfile(text);
  const byName = new Map(stages.map((s) => [s.name, s]));

  /** ทุก path ที่ stage หนึ่ง "มี" หลังทำงานเสร็จ — ใช้ตรวจ COPY --from */
  const produced = new Map();

  for (const stage of stages) {
    const owned = new Set();

    for (const copy of copiesOf(stage)) {
      for (const source of copy.sources) {
        if (copy.from === null) {
          // COPY จาก build context (= root ของ repo)
          if (!existsSync(path.join(ROOT, source))) {
            fail(
              'A',
              `${file} stage \`${stage.name}\`: COPY ${source} — ไม่มี path นี้ใน repo ` +
                `(docker build จะล้มทันทีที่บรรทัดนี้)`,
            );
          }
          owned.add(`/app/${source.replace(/^\.\//, '')}`);
        } else {
          const previous = produced.get(copy.from);

          if (previous === undefined) {
            fail(
              'A',
              `${file} stage \`${stage.name}\`: COPY --from=${copy.from} ไม่มี stage ชื่อนี้`,
            );
            continue;
          }

          /**
           * `node_modules` ของ workspace ย่อยมีเฉพาะตอนที่ npm ไม่ได้ hoist ขึ้นไปข้างบน
           * ซึ่งขึ้นกับ dependency tree จริง — ตรวจกับของจริงในเครื่องได้
           * (เจอตอน STEP 38: backend.Dockerfile สั่ง COPY database/node_modules
           *  ซึ่งไม่มีอยู่จริง แล้ว docker build ล้มที่บรรทัดนั้น)
           */
          const workspaceModules = /^\/app\/(frontend|backend|database)\/node_modules\/?$/.exec(
            source,
          );

          if (workspaceModules !== null) {
            const dir = path.join(ROOT, workspaceModules[1], 'node_modules');

            if (!existsSync(dir)) {
              fail(
                'A',
                `${file} stage \`${stage.name}\`: COPY --from=${copy.from} ${source} — ` +
                  `npm hoist ขึ้น root ทำให้ ${workspaceModules[1]}/node_modules ไม่ถูกสร้าง ` +
                  `→ docker build ล้ม (ลบบรรทัดนี้ทิ้ง เพราะ node_modules ของ root ครอบอยู่แล้ว)`,
              );
            }
          } else {
            /**
             * นับว่า "มีอยู่" เมื่อ stage ก่อนหน้าเป็นเจ้าของ path นั้นหรือโฟลเดอร์แม่ของมัน
             * (`COPY database ./database` ทำให้ `/app/database/prisma` มีอยู่ด้วย)
             * ไม่เช็คแบบตรงตัวเป๊ะ ๆ เพราะจะเตือนผิดจนคนเลิกอ่านผลตรวจ — บทเรียนจาก STEP 30
             */
            const owns = [...previous].some(
              (known) => source === known || source.startsWith(`${known}/`),
            );

            if (!owns) {
              fail(
                'A',
                `${file} stage \`${stage.name}\`: COPY --from=${copy.from} ${source} — ` +
                  `stage \`${copy.from}\` ไม่ได้สร้าง path นี้ (ทั้งจากการ COPY และจากการ build)`,
              );
            }
          }
          owned.add(source);
        }
      }
    }

    // ผลลัพธ์ของการ build ที่ stage นี้สร้างขึ้น
    for (const command of runCommandsOf(stage)) {
      for (const ws of WORKSPACES) {
        if (command.includes(`build --workspace ${ws}`)) {
          owned.add(`/app/${ws}/dist`);
          if (ws === 'frontend') owned.add('/app/frontend/.next');
        }
        if (command.includes(`generate --workspace ${ws}`)) owned.add(`/app/${ws}/generated`);
      }
      if (command.includes('npm ci')) {
        owned.add('/app/node_modules');
      }
    }

    produced.set(stage.name, new Set([...(produced.get(stage.name) ?? []), ...owned]));
  }

  /* ─── B: workspace ที่พึ่งพากันต้องอยู่ใน image และถูก build ก่อน ─── */
  const deps = internalDepsOf(buildsWorkspace);
  const builderStages = stages.filter((s) =>
    runCommandsOf(s).some((c) => c.includes(`build --workspace ${buildsWorkspace}`)),
  );

  if (builderStages.length === 0) {
    fail('B', `${file}: ไม่มี stage ไหนสั่ง build workspace \`${buildsWorkspace}\``);
  }

  for (const builder of builderStages) {
    const copiedDirs = copiesOf(builder)
      .filter((c) => c.from === null)
      .flatMap((c) => c.sources);
    const commands = runCommandsOf(builder).join(' ; ');

    for (const dep of deps) {
      if (!copiedDirs.includes(dep)) {
        fail(
          'B',
          `${file} stage \`${builder.name}\`: \`${buildsWorkspace}\` พึ่ง \`@teenstyle/${dep}\` ` +
            `แต่ไม่ได้ COPY โฟลเดอร์ \`${dep}\` เข้ามา → symlink ใน node_modules ชี้ไปที่ไม่มีอยู่ ` +
            `แล้ว build ล้มด้วย "Cannot find module"`,
        );
        continue;
      }
      if (dep === 'database') {
        if (!commands.includes('generate --workspace database')) {
          fail(
            'B',
            `${file} stage \`${builder.name}\`: ต้องรัน \`npm run generate --workspace database\` ` +
              `ก่อน build เพราะ Prisma Client เป็นโค้ดที่ถูก generate (ไม่ได้อยู่ใน git)`,
          );
        }
        if (!commands.includes('build --workspace database')) {
          fail(
            'B',
            `${file} stage \`${builder.name}\`: ต้องรัน \`npm run build --workspace database\` ` +
              `ก่อน build เพราะ package.json ของมันชี้ \`exports.default\` ไปที่ \`dist/\``,
          );
        }
      }
    }
  }

  /* ─── runtime stage ต้องมีของที่ต้องใช้ตอนรัน ─── */
  const last = stages[stages.length - 1];
  const runtimePaths = new Set(
    copiesOf(last)
      .filter((c) => c.from !== null)
      .flatMap((c) => c.sources),
  );

  for (const dep of deps) {
    if (dep === 'database' && !runtimePaths.has(`/app/database/dist`)) {
      fail(
        'B',
        `${file} stage \`${last.name}\` (runtime): ไม่ได้คัดลอก \`/app/database/dist\` มา ` +
          `→ ตอนรันจะ import \`@teenstyle/database\` ไม่ได้`,
      );
    }
  }

  if (!last.instructions.some((i) => i.cmd === 'USER')) {
    fail('A', `${file}: stage สุดท้ายไม่มี \`USER\` → container รันด้วย root`);
  }
  if (!last.instructions.some((i) => i.cmd === 'HEALTHCHECK')) {
    note('A', `${file}: ไม่มี HEALTHCHECK`);
  }

  ok('A', `${file}: อ่านได้ ${stages.length} stage`);

  return { stages, args: stages.flatMap(argsOf) };
}

/* ═══════════════════════ C: compose ↔ โค้ด ═══════════════════════ */

/**
 * env ที่ต้องมี "ค่าเป็นชื่อ service ใน network" ไม่ใช่ localhost
 * เพราะถูกใช้จาก **ภายใน container** — localhost ใน container คือตัวมันเอง
 */
const INTERNAL_URL_KEYS = {
  DATABASE_URL: 'ทุก workspace ที่ใช้ @teenstyle/database เชื่อมต่อฐานข้อมูลด้วยค่านี้',
  REDIS_URL: 'backend ต่อ Redis ด้วยค่านี้',
  NEXT_PUBLIC_API_URL:
    'Server Component ของ Next ใช้ค่านี้ยิงไป backend (lib/api.ts → apiBase() ฝั่ง server)',
};

/** env ที่เป็น URL ที่ **เบราว์เซอร์** ต้องเปิดได้ → localhost ถูกต้องตอนรันบนเครื่อง */
const PUBLIC_URL_KEYS = new Set([
  'AUTH_URL',
  'FRONTEND_URL',
  'BACKEND_URL',
  'CORS_ORIGIN',
  'NEXT_PUBLIC_SITE_URL',
]);

function auditCompose(dockerfileArgs) {
  let raw;

  try {
    raw = execFileSync('docker', ['compose', 'config', '--format', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    note(
      'C',
      `ข้ามการตรวจ compose เพราะเรียก \`docker compose config\` ไม่ได้ ` +
        `(${String(error.message).split('\n')[0]}) — ไม่ต้องมี daemon แต่ต้องมี docker CLI`,
    );
    return;
  }

  const config = JSON.parse(raw);
  const services = config.services ?? {};
  const serviceNames = Object.keys(services);

  ok('C', `docker-compose.yml ถูกต้องตามไวยากรณ์ (${serviceNames.length} service)`);

  /** service ↔ workspace ที่มันรัน (ดูจาก dockerfile ที่ใช้ build) */
  const serviceWorkspace = new Map();

  for (const [name, service] of Object.entries(services)) {
    const dockerfile = service.build?.dockerfile ?? '';
    const ws = WORKSPACES.find((w) => dockerfile.includes(w));

    if (ws) serviceWorkspace.set(name, ws);
  }

  for (const [name, ws] of serviceWorkspace) {
    const service = services[name];
    const env = service.environment ?? {};
    const buildArgs = service.build?.args ?? {};
    const needs = new Set([ws, ...internalDepsOf(ws)]);

    /* ─── C1: workspace ที่ใช้ @teenstyle/database ต้องได้ DATABASE_URL ─── */
    if (needs.has('database') && !('DATABASE_URL' in env)) {
      fail(
        'C',
        `compose service \`${name}\`: รัน \`${ws}\` ซึ่งพึ่ง @teenstyle/database ` +
          `แต่ไม่ได้ตั้ง DATABASE_URL → \`getPrisma()\` โยน error ตอนรัน ` +
          `(ฝั่ง frontend = Auth.js อ่าน/เขียนตาราง Session ไม่ได้ → ล็อกอินไม่ได้เลย)`,
      );
    }

    /* ─── C2: ARG ที่ Dockerfile ประกาศไว้ ต้องถูกส่งมาจาก compose ─── */
    for (const arg of dockerfileArgs.get(name) ?? []) {
      if (!(arg in buildArgs)) {
        fail(
          'C',
          `compose service \`${name}\`: Dockerfile ประกาศ \`ARG ${arg}\` แต่ compose ไม่ส่งมา ` +
            `→ ค่า default ใน Dockerfile ชนะเงียบ ๆ`,
        );
      }
    }

    /* ─── C3: ค่าที่ใช้ภายใน network ห้ามเป็น localhost ─── */
    for (const [key, reason] of Object.entries(INTERNAL_URL_KEYS)) {
      const value = env[key] ?? buildArgs[key];

      if (typeof value !== 'string' || value === '') continue;

      let host = '';

      try {
        host = new URL(value.replace(/^postgresql:/, 'http:').replace(/^redis:/, 'http:')).hostname;
      } catch {
        continue;
      }

      if (host === 'localhost' || host === '127.0.0.1') {
        fail(
          'C',
          `compose service \`${name}\`: ${key} ชี้ไป ${host} ซึ่งใน container คือตัวมันเอง ` +
            `— ต้องใช้ชื่อ service (${serviceNames.filter((s) => s !== name).join(' / ')}) · ${reason}`,
        );
      } else if (!serviceNames.includes(host)) {
        note('C', `compose service \`${name}\`: ${key} ชี้ไปโฮสต์ภายนอก (${host})`);
      }
    }

    /* ─── C4: cookie ข้ามโดเมน — กฎจาก docs/06-deployment.md §3.1 ─── */
    if (ws === 'frontend') {
      const proxyPath = buildArgs.NEXT_PUBLIC_API_PROXY_PATH ?? '';

      if (proxyPath === '') {
        fail(
          'C',
          `compose service \`${name}\`: ไม่ได้ตั้ง NEXT_PUBLIC_API_PROXY_PATH ` +
            `→ เบราว์เซอร์ยิงไป backend คนละ origin แล้ว cookie ถูกบล็อกแบบ third-party ` +
            `→ ตะกร้า สั่งซื้อ จ่ายเงิน และหลังบ้านพังหมด (docs/06-deployment.md §3.1)`,
        );
      } else if (proxyPath.startsWith('/api')) {
        fail(
          'C',
          `compose service \`${name}\`: NEXT_PUBLIC_API_PROXY_PATH = ${proxyPath} ` +
            `ทับเส้นทางของ Next เอง (/api/auth/* ของ Auth.js และ /api/cart/merge) → ล็อกอินพัง`,
        );
      }
    }
  }

  for (const [name, service] of Object.entries(services)) {
    if (service.build === undefined && service.healthcheck === undefined) {
      note('C', `compose service \`${name}\`: ไม่มี healthcheck`);
    }
  }
}

/* ═══════════════════════ D: .env.example ═══════════════════════ */

/** ชื่อ env ที่ backend อ่าน — จาก schema จริงใน config/env.ts */
function backendEnvKeys() {
  const text = readFileSync(path.join(ROOT, 'backend', 'src', 'config', 'env.ts'), 'utf8');
  const schema = text.slice(text.indexOf('const EnvSchema'));

  return [...schema.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/** ชื่อ NEXT_PUBLIC_* ที่ frontend อ่าน */
function frontendPublicKeys() {
  const files = [
    path.join(ROOT, 'frontend', 'src', 'lib', 'env.ts'),
    path.join(ROOT, 'frontend', 'next.config.ts'),
  ];
  const keys = new Set();

  for (const file of files) {
    const text = readIfExists(file);

    if (text === null) continue;
    for (const match of text.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
      keys.add(match[1]);
    }
  }

  return [...keys];
}

function parseEnvFile(text) {
  const map = new Map();

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(line);

    if (match) map.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
  }

  return map;
}

/** ค่าที่ดูเหมือน secret จริง — ห้ามอยู่ใน .env.example */
const REAL_SECRET_SHAPES = [
  { pattern: /^sk_(live|test)_[A-Za-z0-9]{10,}/, label: 'Stripe secret key' },
  { pattern: /^whsec_[A-Za-z0-9]{10,}/, label: 'Stripe webhook secret' },
  { pattern: /^sk-[A-Za-z0-9_-]{20,}/, label: 'OpenAI API key' },
  { pattern: /^[A-Za-z0-9+/]{40,}={0,2}$/, label: 'ค่า base64 ยาว (น่าจะเป็น secret จริง)' },
  { pattern: /\.apps\.googleusercontent\.com$/, label: 'Google OAuth client id' },
];

function auditEnvExample() {
  const exampleText = readIfExists(path.join(ROOT, '.env.example'));

  if (exampleText === null) {
    fail('D', 'ไม่มี .env.example');
    return;
  }

  const example = parseEnvFile(exampleText);
  const frontendExampleText = readIfExists(path.join(ROOT, 'frontend', '.env.local.example'));
  const frontendExample =
    frontendExampleText === null ? new Map() : parseEnvFile(frontendExampleText);

  for (const key of backendEnvKeys()) {
    // PORT ถูกฉีดโดยผู้ให้บริการโฮสต์ ไม่ใช่ค่าที่คนกรอกเอง
    if (key === 'PORT' || key === 'NODE_ENV') continue;
    if (!example.has(key)) {
      fail(
        'D',
        `.env.example ไม่มี \`${key}\` ที่ backend อ่านจาก schema ` +
          `(กฎของ CLAUDE.md: เพิ่ม env ใหม่ต้องใส่ **ชื่อ** ลง .env.example)`,
      );
    }
  }

  for (const key of frontendPublicKeys()) {
    if (!example.has(key) && !frontendExample.has(key)) {
      fail('D', `ไม่มี \`${key}\` ทั้งใน .env.example และ frontend/.env.local.example`);
    }
  }

  for (const [key, value] of [...example, ...frontendExample]) {
    if (value === '') continue;
    const shape = REAL_SECRET_SHAPES.find((s) => s.pattern.test(value));

    if (shape) {
      fail('D', `ค่าของ \`${key}\` ในไฟล์ตัวอย่างดูเหมือน${shape.label} — ห้ามใส่ค่าจริง`);
    }
  }

  ok('D', `.env.example มี ${example.size} ค่า และไม่พบค่าที่ดูเหมือน secret จริง`);
}

/** ตรวจว่าไฟล์ env จริงถูก git ignore (ไม่อ่านเนื้อหา) */
function auditGitIgnore() {
  for (const file of ['.env', 'frontend/.env.local']) {
    if (!existsSync(path.join(ROOT, file))) continue;
    try {
      execFileSync('git', ['check-ignore', '-q', file], { cwd: ROOT, stdio: 'ignore' });
      ok('D', `${file} ถูก git ignore`);
    } catch {
      fail('D', `${file} **ไม่ได้** ถูก git ignore → เสี่ยง commit secret ขึ้น repo`);
    }
  }
}

/* ═══════════════════ E: ค่าในไฟล์ env สำหรับ production ═══════════════════ */

function auditProductionEnv(file) {
  const text = readIfExists(path.resolve(ROOT, file));

  if (text === null) {
    fail('E', `ไม่พบไฟล์ ${file}`);
    return;
  }

  const env = parseEnvFile(text);
  const get = (key) => env.get(key) ?? '';
  const isLocal = (value) => /localhost|127\.0\.0\.1/.test(value);

  if (get('NODE_ENV') !== 'production') {
    fail('E', `${file}: NODE_ENV = "${get('NODE_ENV') || '(ว่าง)'}" ต้องเป็น production`);
  }
  for (const key of ['NEXT_PUBLIC_SITE_URL', 'AUTH_URL', 'FRONTEND_URL', 'BACKEND_URL']) {
    if (isLocal(get(key))) {
      fail(
        'E',
        `${file}: ${key} ยังเป็น localhost — canonical, sitemap, og:image และการ redirect ` +
          `หลังล็อกอินจะชี้ไปเครื่องอื่น`,
      );
    }
  }
  if (get('AUTH_SECRET').length < 32) {
    fail('E', `${file}: AUTH_SECRET สั้นกว่า 32 ตัวอักษร (สร้างด้วย \`openssl rand -base64 32\`)`);
  }
  if (get('CORS_ORIGIN').trim() === '*') {
    fail('E', `${file}: CORS_ORIGIN = * เปิดให้ทุกโดเมนยิงพร้อม cookie ได้`);
  }
  if (!/^\d+$/.test(get('TRUST_PROXY_HOPS'))) {
    fail(
      'E',
      `${file}: TRUST_PROXY_HOPS ต้องเป็นตัวเลขจำนวน proxy จริง ` +
        `(ตั้งเกินจริง = ผู้ใช้ปลอม X-Forwarded-For ได้ → rate limit ถูกข้าม และ IP ใน AdminLog ผิดคน)`,
    );
  }
  if (get('DATABASE_URL') === '') {
    fail('E', `${file}: ไม่มี DATABASE_URL`);
  }
  if (get('REDIS_URL') === '') {
    note(
      'E',
      `${file}: ไม่มี REDIS_URL — rate limit จะนับแยกต่อ process ` +
        `(limit จริง = RATE_LIMIT_MAX × จำนวน instance · ดู docs/10-performance.md)`,
    );
  }
  for (const [key, value] of env) {
    if (/localhost|127\.0\.0\.1/.test(value) && !PUBLIC_URL_KEYS.has(key)) {
      note('E', `${file}: ${key} มี localhost อยู่ในค่า — ตรวจว่าตั้งใจ`);
    }
  }
}

/* ═══════════════════════ F: migration ที่ค้าง ═══════════════════════ */

function auditMigrations() {
  const dir = path.join(ROOT, 'database', 'migrations');

  if (!existsSync(dir)) {
    note('F', 'ไม่มีโฟลเดอร์ database/migrations');
    return;
  }

  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const folder of folders) {
    const sql = readIfExists(path.join(dir, folder, 'migration.sql'));

    if (sql === null) {
      fail('F', `database/migrations/${folder} ไม่มีไฟล์ migration.sql`);
      continue;
    }
    /**
     * Prisma ไม่สร้าง `CREATE EXTENSION` ให้ (STEP 34) — ถ้ามี index แบบ trgm
     * อยู่ในไฟล์นี้ ต้องมีบรรทัดสร้าง extension อยู่ในไฟล์ใดไฟล์หนึ่งก่อนหน้าด้วย
     */
    if (sql.includes('gin_trgm_ops')) {
      const anyCreatesExtension = folders.some((f) =>
        (readIfExists(path.join(dir, f, 'migration.sql')) ?? '').includes(
          'CREATE EXTENSION IF NOT EXISTS pg_trgm',
        ),
      );

      if (!anyCreatesExtension) {
        fail(
          'F',
          `database/migrations/${folder} ใช้ gin_trgm_ops แต่ไม่มี migration ไหนสร้าง extension pg_trgm ` +
            `→ \`prisma migrate deploy\` บนฐานข้อมูลใหม่จะล้ม`,
        );
      }
    }
  }

  ok('F', `migration ${folders.length} ชุด อ่านได้ครบ`);
}

/* ═══════════════════ G: config ของโฮสต์ (railway.json) ═══════════════════ */

function auditHostConfig() {
  const file = 'railway.json';
  const text = readIfExists(path.join(ROOT, file));

  if (text === null) {
    note('G', `ไม่มี ${file}`);
    return;
  }

  const config = JSON.parse(text);
  const build = config.build?.buildCommand ?? '';
  const start = config.deploy?.startCommand ?? '';
  const preDeploy = config.deploy?.preDeployCommand ?? '';
  const rootScripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

  /**
   * `@teenstyle/database` ไม่ได้ commit ผลลัพธ์ที่ generate/build ไว้ใน git
   * (`generated/prisma` + `dist/`) — โฮสต์ที่ไม่รัน db:sync ก่อน build จะหา module ไม่เจอ
   */
  if (!build.includes('db:sync')) {
    fail(
      'G',
      `${file}: buildCommand ไม่ได้รัน \`npm run db:sync\` — Prisma Client ถูก generate ` +
        `ไม่ได้อยู่ใน git จึงต้องสร้างตอน build ไม่งั้น build ล้มด้วย "Cannot find module"`,
    );
  }
  if (!build.includes('--include=dev')) {
    fail(
      'G',
      `${file}: buildCommand ต้องใช้ \`npm ci --include=dev\` เพราะโฮสต์ตั้ง NODE_ENV=production ` +
        `ซึ่งทำให้ npm ข้าม devDependencies แล้ว tsc หา type ไม่เจอ (docs/06-deployment.md §2.1)`,
    );
  }
  if (!preDeploy.includes('migrate:deploy')) {
    fail('G', `${file}: ไม่มี preDeployCommand ที่รัน \`db:migrate:deploy\` → schema ไม่ถูกอัปเดต`);
  }
  if (config.deploy?.healthcheckPath !== '/health') {
    fail(
      'G',
      `${file}: healthcheckPath ต้องเป็น /health (endpoint ที่คืน 503 เมื่อ dependency ล่ม)`,
    );
  }

  // ทุก npm script ที่ config อ้างถึงต้องมีอยู่จริงใน package.json ของ root
  for (const command of [build, start, preDeploy]) {
    for (const match of command.matchAll(/npm run ([a-z:]+)/g)) {
      if (!(match[1] in rootScripts)) {
        fail('G', `${file}: อ้าง \`npm run ${match[1]}\` ซึ่งไม่มีใน package.json ของ root`);
      }
    }
  }

  ok('G', `${file}: build → migrate → start → healthcheck /health ครบและชี้ไป script ที่มีจริง`);
}

/* ═══════════════════════ รายงาน ═══════════════════════ */

const envFlagIndex = process.argv.indexOf('--env');
const envFile = envFlagIndex === -1 ? null : process.argv[envFlagIndex + 1];

console.log('\n🚀 ตรวจของที่ใช้ deploy (STEP 38)\n');

const dockerfileArgs = new Map();
const backendResult = auditDockerfile('docker/backend.Dockerfile', 'backend');
const frontendResult = auditDockerfile('docker/frontend.Dockerfile', 'frontend');

dockerfileArgs.set('backend', backendResult?.args ?? []);
dockerfileArgs.set('frontend', frontendResult?.args ?? []);

auditCompose(dockerfileArgs);
auditEnvExample();
auditGitIgnore();
auditMigrations();
auditHostConfig();
if (envFile !== null) auditProductionEnv(envFile);

const AREA_LABEL = {
  A: 'Dockerfile ↔ ไฟล์ใน repo',
  B: 'workspace ที่พึ่งพากัน',
  C: 'compose ↔ สิ่งที่โค้ดต้องใช้',
  D: 'env ที่ประกาศไว้',
  E: 'ค่าในไฟล์ env สำหรับ production',
  F: 'migration',
  G: 'config ของโฮสต์',
};

for (const area of Object.keys(AREA_LABEL)) {
  const areaProblems = problems.filter((p) => p.area === area);
  const areaNotes = notes.filter((n) => n.area === area);
  const areaPassed = passed.filter((p) => p.area === area);

  if (areaProblems.length + areaNotes.length + areaPassed.length === 0) continue;

  console.log(`\n${area}. ${AREA_LABEL[area]}`);
  for (const item of areaPassed) console.log(`   ✅ ${item.message}`);
  for (const item of areaNotes) console.log(`   ℹ️  ${item.message}`);
  for (const item of areaProblems) console.log(`   ❌ ${item.message}`);
}

console.log(
  `\n${'─'.repeat(78)}\n` +
    `ผิดพลาด ${problems.length} · ข้อสังเกต ${notes.length} · ผ่าน ${passed.length}\n`,
);

if (envFile === null) {
  console.log(
    'ℹ️  ยังไม่ได้ตรวจค่าในไฟล์ env สำหรับ production — ตอน deploy ให้รัน\n' +
      '   node scripts/audit-deploy.mjs --env <ไฟล์ env ของ production>\n',
  );
}

console.log(
  '⚠️  สคริปต์นี้ **ไม่ได้** ยืนยันว่า docker image build ผ่าน (ต้องมี Docker daemon)\n' +
    '   มันยืนยันได้แค่ว่าไม่มีข้อผิดพลาดที่อ่านจาก repo ได้แล้ว\n',
);

process.exit(problems.length > 0 ? 1 : 0);
