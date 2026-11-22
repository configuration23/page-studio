#!/usr/bin/env node
/**
 * Демо-драйвер вместо бэкенда. Играет ровно ту роль, которую сыграет воркфлоу n8n или любой другой сервис:
 * получает событие портала, пишет статус, кладёт картинку.
 *
 * Он же — исполняемая документация контракта: те же три вызова делает любой бэкенд.
 *
 *   node demo/driver.mjs
 *   PORTAL_URL=http://127.0.0.1:3000 PORTAL_TOKEN=dev-token-local node demo/driver.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}

const PORT = Number(process.env.DRIVER_PORT ?? 7100);
const PORTAL = process.env.PORTAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? 3000}`;
const TOKEN = process.env.PORTAL_TOKEN ?? env.PORTAL_TOKEN;
const PAGE = process.env.DRIVER_PAGE ?? 'generation';
const WORK_MS = Number(process.env.DRIVER_WORK_MS ?? 2000);
// В контейнере драйвер должен слушать все интерфейсы, иначе портал его не увидит.
const HOST = process.env.DRIVER_HOST ?? '127.0.0.1';

if (!TOKEN) {
  console.error('PORTAL_TOKEN не задан — портал не пустит запись');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const PALETTES = [
  ['#1b2a4a', '#3b5b8c', '#8fb6e8'],
  ['#2b1b3d', '#5b3b7a', '#c9a0e8'],
  ['#3d2416', '#8c5b3b', '#e8b68f'],
  ['#12332e', '#2e6b5f', '#8fdfc8'],
  ['#3a1220', '#7a2e46', '#e89bb0'],
];

function wrap(text, maxChars, maxLines) {
  const words = String(text || 'без промпта').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let consumed = 0;
  for (const word of words) {
    if (lines.length >= maxLines) break;
    consumed += 1;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(`${word.slice(0, maxChars - 1)}…`);
      current = '';
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const truncated = consumed < words.length || (current && lines.length >= maxLines);
  if (truncated && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.endsWith('…') ? last : `${last.slice(0, maxChars - 1)}…`;
  }
  return lines;
}

function renderSvg(prompt) {
  const h = hashOf(prompt);
  const [from, to, accent] = PALETTES[h % PALETTES.length];
  const lines = wrap(prompt, 26, 6);
  const lineHeight = 44;
  const startY = 384 - ((lines.length - 1) * lineHeight) / 2;

  const circles = [0, 1, 2]
    .map((i) => {
      const cx = 120 + ((h >> (i * 5)) % 520);
      const cy = 100 + ((h >> (i * 7)) % 560);
      const r = 90 + ((h >> (i * 3)) % 170);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" opacity="0.14"/>`;
    })
    .join('');

  const text = lines
    .map(
      (line, i) =>
        `<text x="56" y="${startY + i * lineHeight}" font-family="Segoe UI, system-ui, sans-serif" font-size="34" font-weight="600" fill="#ffffff" opacity="0.96">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="768" height="768" fill="url(#bg)"/>
  ${circles}
  <rect x="40" y="${startY - 74}" width="4" height="${lines.length * lineHeight + 40}" fill="${accent}" opacity="0.85"/>
  ${text}
  <g transform="translate(48, 690)">
    <rect width="150" height="40" rx="20" fill="#000000" opacity="0.28"/>
    <text x="20" y="27" font-family="Segoe UI, system-ui, sans-serif" font-size="18" fill="#ffffff" opacity="0.92">demo</text>
  </g>
</svg>`;
}

async function call(path, init) {
  const res = await fetch(`${PORTAL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

async function getJson(path) {
  const res = await call(path);
  return res.json();
}

async function setStatus(page, sid, state, text) {
  await call(`/api/v1/forms/${page}/values/status?sid=${encodeURIComponent(sid)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: { state, text } }),
  });
}

async function postList(page, sid, id, items) {
  await call(`/api/v1/forms/${page}/values/${encodeURIComponent(id)}?sid=${encodeURIComponent(sid)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: items }),
  });
}

async function postImage(page, sid, note) {
  const encoded = encodeURIComponent(String(note || '').slice(0, 300));
  await call(`/api/v1/forms/${page}/values/image?sid=${encodeURIComponent(sid)}&note=${encoded}`, {
    method: 'POST',
    headers: { 'content-type': 'image/svg+xml' },
    body: renderSvg(note),
  });
}

/** Текст для галереи: первое осмысленное поле формы, иначе первая строка. */
function pickNote(values) {
  if (!values || typeof values !== 'object') return '';
  for (const key of ['prompt', 'message', 'text', 'name']) {
    if (typeof values[key] === 'string' && values[key].trim()) return values[key].trim();
  }
  for (const value of Object.values(values)) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

async function runJob(payload) {
  const page = String(payload?.page ?? PAGE);
  const sid = String(payload?.sid ?? '');
  if (!sid) throw new Error('в событии нет sid');

  // Страница сама говорит, что у неё есть: картинка, статус или ничего.
  const manifest = await getJson(`/api/v1/forms/${page}/manifest`);
  const kinds = manifest.elements.map((item) => item.kind);
  const hasImage = kinds.includes('image');
  const hasStatus = kinds.includes('status');
  const listId = manifest.elements.find((item) => item.kind === 'list')?.id;
  const note = pickNote(payload.values);
  const startedAt = Date.now();

  if (hasStatus) await setStatus(page, sid, 'queued', 'принято демо-драйвером');
  await sleep(500);
  if (hasStatus) await setStatus(page, sid, 'running', hasImage ? 'рисует' : 'в работе');
  await sleep(WORK_MS);
  if (hasImage) await postImage(page, sid, note);
  if (listId) {
    await postList(page, sid, listId, [
      'Демо-драйвер: событие получено',
      `Демо-драйвер: работа заняла ${((Date.now() - startedAt) / 1000).toFixed(1)} с`,
    ]);
  }
  if (hasStatus) await setStatus(page, sid, 'done', 'готово');
}

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('только POST');
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on('end', () => {
    // Отвечаем сразу: портал шлёт событие fire-and-forget и ждать не должен.
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      console.error('событие не разобралось');
      return;
    }
    console.log(
      `[${new Date().toISOString()}] ${payload.page}.${payload.event}_${payload.element} sid=${payload.sid}`,
    );
    runJob(payload).catch((err) => {
      console.error('прогон упал:', err.message);
      const sid = String(payload?.sid ?? '');
      const page = String(payload?.page ?? PAGE);
      if (sid) {
        setStatus(page, sid, 'failed', err.message.slice(0, 120)).catch(() => {});
      }
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`демо-драйвер: http://${HOST}:${PORT}/webhook/gen-push → портал ${PORTAL}`);
});
