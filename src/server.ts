import { createReadStream } from 'node:fs';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { parse as parseQuery } from 'node:querystring';
import { join } from 'node:path';
import YAML from 'yaml';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { loadConfig } from './config.js';
import { draftFile, loadForms, publishedFile } from './forms.js';
import { pushEvent } from './push.js';
import { TargetStore } from './targets.js';
import { SettingsStore } from './settings.js';
import { PageStateStore, PAGE_STATES } from './pagestate.js';
import { StateStore } from './state.js';
import { ImageStore } from './store.js';
import { CallLog } from './log.js';
import { renderIndex, renderNotFound, renderPage } from './render.js';
import { renderAdmin, renderLogin } from './admin.js';
import {
  checkCredentials,
  createSessionToken,
  newSessionId,
  sessionIdFromToken,
  verifySessionToken,
} from './auth.js';
import { TokenStore } from './tokens.js';
import { EVENTS_OF, VALUE_KINDS, elementById, formSchema, methodsOf, resolveElement, type Element, type Form } from './model.js';

const config = loadConfig();
const forms = loadForms(config.formsDir);
const drafts = loadForms(config.formsDir, { drafts: true });
/** Именованные адреса, куда уходят события. */
const targets = new TargetStore(config.dataDir);

/** Настройки портала: какая страница открывается на входе. */
const settings = new SettingsStore(config.dataDir, process.env.DEFAULT_PAGE?.trim() || undefined);

/** Состояние страницы целиком — для списка страниц. */
const pageStates = new PageStateStore(config.dataDir);

function indexItems(): Array<{
  slug: string;
  title: string;
  lead?: string;
  elements: number;
  state: { state: string; text?: string; ts?: string };
}> {
  return [...forms.values()].map((form) => ({
    slug: form.slug,
    title: form.title,
    lead: form.lead,
    elements: form.elements.length,
    state: pageStates.get(form.slug),
  }));
}
const state = new StateStore(config.dataDir);
const images = new ImageStore(config.dataDir);
const log = new CallLog(200, join(config.logsDir, 'calls.jsonl'));

const SID_RE = /^[a-f0-9]{8,32}$/;
const STATUS_STATES = ['idle', 'queued', 'running', 'done', 'failed'];
/** Защита от двойного нажатия: событие одного элемента чаще раза в 1,2 с не шлём. */
const DEBOUNCE_MS = 1200;
const lastEventAt = new Map<string, number>();

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly issues?: string[],
  ) {
    super(message);
  }
}

const app = Fastify({ logger: false, bodyLimit: config.maxImageBytes + 4096 });

// Время ответа по каждому запросу: без него «страница думает» нечем проверить.
// Формат строки стабильный, чтобы по логам можно было считать статистику.
app.addHook('onResponse', (request, reply, done) => {
  const ms = Math.round(reply.elapsedTime);
  const path = request.url.split('?')[0];
  const mark = ms >= 500 ? ' SLOW' : '';
  console.log(`http${mark} ${request.method} ${path} ${reply.statusCode} ${ms}ms ${request.ip}`);
  done();
});

app.addContentTypeParser(/^image\//, { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'string' },
  (_req, body, done) => {
    try {
      done(null, parseQuery(String(body)));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

function cookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sidFrom(req: FastifyRequest): string | null {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const fromQuery = typeof query.sid === 'string' ? query.sid : null;
  if (fromQuery && SID_RE.test(fromQuery)) return fromQuery;
  const fromCookie = cookie(req, 'ps_sid');
  return fromCookie && SID_RE.test(fromCookie) ? fromCookie : null;
}

function newSid(): string {
  return randomBytes(8).toString('hex');
}

function setSidCookie(reply: FastifyReply, sid: string): void {
  reply.header('set-cookie', `ps_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function ensureSid(req: FastifyRequest, reply: FastifyReply): string {
  const existing = sidFrom(req);
  if (existing) return existing;
  const sid = newSid();
  setSidCookie(reply, sid);
  return sid;
}

const ADMIN_COOKIE = 'ps_admin';

function setAdminCookie(reply: FastifyReply, token: string): void {
  reply.header(
    'set-cookie',
    `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
  );
}

function clearAdminCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sameToken(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return false;
  return sameToken(header.slice(7).trim());
}

/** Секрет подписи сессии: постоянный, если задан, иначе производный от пароля. */
const adminSecret =
  (process.env.ADMIN_SESSION_SECRET ?? '').trim() ||
  createHash('sha256').update(`page-studio:${config.adminPassword}`).digest('hex');

/** Растёт при выходе: все выданные сессии перестают работать. */
const activeSessions = new Set<string>();

/** Токены для API: создаются и отзываются в админке. */
const tokens = new TokenStore(config.dataDir);

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

/** Сессия из формы входа. */
function adminSession(req: FastifyRequest): boolean {
  return verifySessionToken(adminSecret, cookie(req, ADMIN_COOKIE), (sid) => activeSessions.has(sid));
}

/**
 * Админ для API: сессия из формы или API-токен.
 * HTTP Basic не используется: браузер кеширует его и не даёт выйти из админки.
 */
function isAdmin(req: FastifyRequest): boolean {
  if (!config.adminPassword) return false;
  if (adminSession(req)) return true;
  const token = bearerToken(req);
  return token ? tokens.verify(token) !== null : false;
}

/**
 * Страницы админки: только сессия. Токен — для API, а не для браузера,
 * иначе браузер с закешированным заголовком не показал бы форму входа.
 */
function requireAdminPage(req: FastifyRequest, reply: FastifyReply): boolean {
  if (adminSession(req)) return true;
  const next = encodeURIComponent(req.url.split('?')[0] === '/admin' ? '/admin' : req.url);
  reply.redirect(`/admin/login?next=${next}`, 303);
  return false;
}

/** API админки: 401 без заголовка WWW-Authenticate, чтобы браузер не звал диалог. */
function requireAdminApi(req: FastifyRequest, reply: FastifyReply): void {
  if (!config.adminPassword) {
    throw new HttpError(503, 'админка выключена: задайте ADMIN_USER и ADMIN_PASSWORD');
  }
  if (!isAdmin(req)) throw new HttpError(401, 'нужен вход в админку');
}

function getForm(slug: string): Form {
  const form = forms.get(slug);
  if (!form) throw new HttpError(404, `формы «${slug}» нет`);
  return form;
}

function getElement(form: Form, id: string): Element {
  const el = resolveElement(form, id);
  if (!el) throw new HttpError(404, `в форме «${form.slug}» нет элемента «${id}»`);
  return el;
}

function requireSid(req: FastifyRequest): string {
  const sid = sidFrom(req);
  if (!sid) throw new HttpError(400, 'нужен ?sid= (8–32 символа 0-9a-f) или cookie ps_sid');
  return sid;
}

/** Приведение входящего значения к типу элемента: мусор не должен попадать в состояние. */
function normalizeValue(el: Element, raw: unknown): unknown {
  switch (el.kind) {
    case 'check': {
      if (typeof raw !== 'boolean') throw new HttpError(400, `«${el.id}»: ожидал true/false`);
      return raw;
    }
    case 'status': {
      const value = raw as { state?: unknown; text?: unknown } | null;
      if (!value || typeof value !== 'object') {
        throw new HttpError(400, `«${el.id}»: ожидал {"state":"running","text":"..."}`);
      }
      const status = String(value.state ?? '');
      if (!STATUS_STATES.includes(status)) {
        throw new HttpError(400, `«${el.id}»: state из ${STATUS_STATES.join(', ')}`);
      }
      return { state: status, text: typeof value.text === 'string' ? value.text.slice(0, 300) : '' };
    }
    case 'list': {
      if (!Array.isArray(raw)) throw new HttpError(400, `«${el.id}»: ожидал массив строк`);
      if (raw.length > 100) throw new HttpError(400, `«${el.id}»: не больше 100 строк`);
      return raw.map((item) => {
        if (typeof item !== 'string') throw new HttpError(400, `«${el.id}»: только строки`);
        return item.slice(0, 300);
      });
    }
    case 'combo': {
      const options = el.props.options ?? [];
      if (typeof raw !== 'string' || !options.includes(raw)) {
        throw new HttpError(400, `«${el.id}»: допустимо ${options.join(', ')}`);
      }
      return raw;
    }
    case 'edit':
    case 'memo': {
      if (typeof raw !== 'string') throw new HttpError(400, `«${el.id}»: ожидал строку`);
      const max = el.props.max ?? 2000;
      if (raw.length > max) throw new HttpError(400, `«${el.id}»: не длиннее ${max} символов`);
      return raw;
    }
    default:
      throw new HttpError(400, `«${el.id}» (${el.kind}) не принимает значение`);
  }
}

function galleriesOf(form: Form): Record<string, Array<{ imageId: string; note?: string }>> {
  const out: Record<string, Array<{ imageId: string; note?: string }>> = {};
  for (const el of form.elements) {
    if (el.kind === 'gallery') out[el.id] = images.toGallery(form.slug, el.props.limit ?? 24);
  }
  return out;
}

app.setErrorHandler((rawError: unknown, _req, reply) => {
  const error = rawError as Error & { statusCode?: number };
  if (error instanceof HttpError) {
    reply
      .code(error.statusCode)
      .send(error.issues ? { error: error.message, issues: error.issues } : { error: error.message });
    return;
  }
  // ошибки Fastify (пустое тело, неверный JSON, слишком большой файл) — это 4xx
  const fastifyStatus = (error as { statusCode?: number }).statusCode;
  if (typeof fastifyStatus === 'number' && fastifyStatus >= 400 && fastifyStatus < 500) {
    reply.code(fastifyStatus).send({ error: error.message });
    return;
  }
  console.error(error);
  reply.code(500).send({ error: error.message });
});

app.get('/', async (_req, reply) => {
  const { defaultPage } = settings.get();
  if (defaultPage && forms.has(defaultPage)) return reply.redirect(`/p/${defaultPage}`, 302);
  return reply.type('text/html; charset=utf-8').send(renderIndex(indexItems()));
});

/** Список страниц — отдельный адрес, чтобы он не пропадал при странице по умолчанию. */
app.get('/pages', async (_req, reply) =>
  reply.type('text/html; charset=utf-8').send(renderIndex(indexItems())),
);

/** Список для обновления статусов на клиенте. */
app.get('/api/v1/pages', async () => ({
  pages: [...forms.values()].map((form) => ({
    slug: form.slug,
    title: form.title,
    state: pageStates.get(form.slug),
  })),
}));

app.get('/api/v1/forms/:slug/state', async (req) => {
  const form = getForm((req.params as { slug: string }).slug);
  return { value: pageStates.get(form.slug) };
});

app.post('/api/v1/forms/:slug/state', async (req, reply) => {
  if (!authorized(req)) throw new HttpError(401, 'нужен токен портала');
  const form = getForm((req.params as { slug: string }).slug);
  const body = (req.body ?? {}) as { value?: { state?: unknown; text?: unknown } };
  const state = String(body.value?.state ?? '');
  if (!(PAGE_STATES as readonly string[]).includes(state)) {
    throw new HttpError(400, `state: одно из ${PAGE_STATES.join(', ')}`);
  }
  const text = body.value?.text ? String(body.value.text) : undefined;
  const value = pageStates.set(form.slug, state as (typeof PAGE_STATES)[number], text);
  log.add({ kind: 'value', page: form.slug, name: `${form.slug}.state`, ok: true, note: state });
  return reply.send({ value });
});

app.get('/health', async () => ({
  ok: true,
  forms: [...forms.keys()],
  provider: 'external',
}));

app.get('/p/:slug', async (req, reply) => {
  const slug = (req.params as { slug: string }).slug;
  const query = (req.query ?? {}) as Record<string, unknown>;
  // ?draft=1 — предпросмотр черновика: только для админа, страница ещё не опубликована.
  if (query.draft === '1' && !requireAdminPage(req, reply)) return reply;
  const form = query.draft === '1' ? (drafts.get(slug) ?? getForm(slug)) : getForm(slug);
  const sid = ensureSid(req, reply);
  const values = state.values(form, sid);
  const footer =
    query.debug === '1' ? `${form.elements.length} элементов · сессия ${sid}` : '';
  const isDraft = query.draft === '1';
  const nav = [
    ...(isDraft ? [{ href: '/admin', label: '← В админку' }] : []),
    { href: '/pages', label: 'К списку страниц' },
  ];
  return reply
    .type('text/html; charset=utf-8')
    .send(renderPage(form, values, galleriesOf(form), { footer, nav, badge: isDraft ? 'черновик' : '' }));
});

app.get('/media/:id', async (req, reply) => {
  const record = images.get((req.params as { id: string }).id);
  if (!record) return reply.code(404).send({ error: 'картинки нет' });
  reply.header('cache-control', 'public, max-age=31536000, immutable');
  reply.header('x-content-type-options', 'nosniff');
  if (record.contentType === 'image/svg+xml') {
    reply.header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  }
  return reply.type(record.contentType).send(createReadStream(images.pathOf(record)));
});

app.get('/api/v1/forms/:slug/manifest', async (req) => {
  const form = getForm((req.params as { slug: string }).slug);
  const methods = methodsOf(form);
  return {
    page: form.slug,
    title: form.title,
    canvas: form.canvas,
    elements: form.elements.map((el) => ({
      id: el.id,
      kind: el.kind,
      label: el.label ?? null,
      rect: { x: el.x, y: el.y, w: el.w, h: el.h },
      events: EVENTS_OF[el.kind] ?? [],
      // имя цели, а не адрес: манифест открыт, адреса вебхуков — нет
      target: el.target ?? null,
      methods: methods.filter((m) => m.elementId === el.id).map((m) => ({ name: m.name, kind: m.kind })),
    })),
    methods,
    aliases: form.aliases,
    targets: targets.list().map((t) => t.name),
  };
});

app.get('/api/v1/forms/:slug/values/:id', async (req) => {
  const params = req.params as { slug: string; id: string };
  const form = getForm(params.slug);
  const el = getElement(form, params.id);
  if (!VALUE_KINDS.has(el.kind)) {
    throw new HttpError(400, `«${el.id}» (${el.kind}) значения не хранит`);
  }
  const sid = requireSid(req);
  if (el.kind === 'gallery') {
    return { value: images.toGallery(form.slug, el.props.limit ?? 24) };
  }
  return { value: state.get(form, sid, el.id) };
});

app.post('/api/v1/forms/:slug/values/:id', async (req, reply) => {
  if (!authorized(req)) throw new HttpError(401, 'нужен Authorization: Bearer <PORTAL_TOKEN>');
  const params = req.params as { slug: string; id: string };
  const form = getForm(params.slug);
  const el = getElement(form, params.id);
  const sid = requireSid(req);

  if (el.kind === 'gallery') {
    throw new HttpError(400, 'галерея только читается: картинки кладутся в элемент image');
  }

  if (el.kind === 'image') {
    const contentType = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!contentType.startsWith('image/')) {
      throw new HttpError(415, 'для image нужен Content-Type: image/png и тело-файл');
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, 'пустое тело картинки');
    }
    if (body.length > config.maxImageBytes) {
      throw new HttpError(413, `картинка больше ${config.maxImageBytes} байт`);
    }
    const query = (req.query ?? {}) as Record<string, unknown>;
    const note = typeof query.note === 'string' ? query.note : undefined;
    const record = images.save({
      bytes: body,
      contentType,
      page: form.slug,
      element: el.id,
      sid,
      note,
    });
    const value = { imageId: record.id };
    state.set(form, sid, el.id, value);
    for (const gallery of form.elements) {
      if (gallery.kind === 'gallery') {
        state.publish(form.slug, sid, {
          id: gallery.id,
          value: images.toGallery(form.slug, gallery.props.limit ?? 24),
          version: 0,
        });
      }
    }
    log.add({ kind: 'value', page: form.slug, name: `${form.slug}.post_${el.id}`, sid, ok: true, note: record.id });
    return reply.code(201).send({ value, url: `/media/${record.id}` });
  }

  const body = (req.body ?? {}) as { value?: unknown };
  const value = normalizeValue(el, body.value);
  state.set(form, sid, el.id, value);
  log.add({ kind: 'value', page: form.slug, name: `${form.slug}.post_${el.id}`, sid, ok: true });
  return { value };
});

app.post('/api/v1/forms/:slug/events/:id', async (req, reply) => {
  const params = req.params as { slug: string; id: string };
  const form = getForm(params.slug);
  const el = getElement(form, params.id);
  const events = EVENTS_OF[el.kind];
  if (!events || events.length === 0) {
    throw new HttpError(400, `у «${el.id}» (${el.kind}) нет событий`);
  }
  const sid = requireSid(req);
  const body = (req.body ?? {}) as { value?: unknown; values?: Record<string, unknown> };

  // Снимок формы из браузера: кнопка нажата раньше, чем change дошёл до сервера.
  if (body.values && typeof body.values === 'object') {
    for (const [id, raw] of Object.entries(body.values)) {
      const target = elementById(form, id);
      if (!target || !VALUE_KINDS.has(target.kind)) continue;
      if (target.kind === 'image' || target.kind === 'gallery') continue;
      try {
        state.set(form, sid, id, normalizeValue(target, raw));
      } catch {
        // одно негодное поле не должно отменять нажатие
      }
    }
  }

  if (body.value !== undefined && VALUE_KINDS.has(el.kind)) {
    state.set(form, sid, el.id, normalizeValue(el, body.value));
  }

  const event = events[0]!;
  const url = el.target ? targets.get(el.target) : null;
  const payload = {
    page: form.slug,
    element: el.id,
    event,
    sid,
    ts: new Date().toISOString(),
    values: { ...state.values(form, sid) },
  };

  const debounceKey = `${form.slug}:${sid}:${el.id}:${event}`;
  const now = Date.now();
  const last = lastEventAt.get(debounceKey) ?? 0;
  if (now - last < DEBOUNCE_MS) {
    log.add({
      kind: 'event',
      page: form.slug,
      name: `${form.slug}.${event}_${el.id}`,
      sid,
      ok: false,
      note: 'повтор раньше 1,2 с — пропущен',
    });
    return reply.code(202).send({ ok: true, event, pushed: false, debounced: true });
  }
  lastEventAt.set(debounceKey, now);

  if (url) {
    void pushEvent(url, payload, log, { page: form.slug, name: `${form.slug}.${event}_${el.id}`, sid });
  }
  log.add({
    kind: 'event',
    page: form.slug,
    name: `${form.slug}.${event}_${el.id}`,
    sid,
    ok: true,
    note: url ? 'отправлено в бэкенд' : 'цель не задана',
  });

  return reply.code(202).send({ ok: true, event, pushed: Boolean(url) });
});

app.get('/api/v1/forms/:slug/stream', (req, reply) => {
  let form: Form;
  try {
    form = getForm((req.params as { slug: string }).slug);
  } catch {
    reply.code(404).send({ error: 'нет формы' });
    return;
  }

  const existing = sidFrom(req);
  const sid = existing ?? newSid();

  reply.hijack();
  const headers: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
  if (!existing) headers['set-cookie'] = `ps_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  reply.raw.writeHead(200, headers);
  reply.raw.write(': connected\n\n');

  const unsubscribe = state.subscribe(form.slug, sid, (change) => {
    reply.raw.write(`data: ${JSON.stringify(change)}\n\n`);
  });
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

  req.raw.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

/** Убирает из формы значения по умолчанию, чтобы YAML оставался читаемым. */
function compactForm(form: Form) {
  return {
    slug: form.slug,
    title: form.title,
    ...(form.lead ? { lead: form.lead } : {}),
    canvas: {
      width: form.canvas.width,
      ...(form.canvas.height ? { height: form.canvas.height } : {}),
    },
    elements: form.elements.map((el) => {
      const out: Record<string, unknown> = {
        id: el.id,
        kind: el.kind,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
      };
      if (el.label) out.label = el.label;
      if (el.hidden) out.hidden = true;
      if (el.target) out.target = el.target;
      const props = Object.fromEntries(
        Object.entries(el.props).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(props).length > 0) out.props = props;
      return out;
    }),
    ...(Object.keys(form.aliases).length > 0
      ? { aliases: { ...form.aliases } }
      : {}),
  };
}

app.get('/admin/login', async (req, reply) => {
  if (!config.adminPassword) {
    return reply.code(503).type('text/html; charset=utf-8').send(renderLogin({ disabled: true }));
  }
  if (isAdmin(req)) return reply.redirect('/admin', 303);
  const query = (req.query ?? {}) as { next?: string };
  const next = typeof query.next === 'string' && query.next.startsWith('/') ? query.next : '/admin';
  return reply.type('text/html; charset=utf-8').send(renderLogin({ next }));
});

app.post('/admin/login', async (req, reply) => {
  if (!config.adminPassword) {
    return reply.code(503).type('text/html; charset=utf-8').send(renderLogin({ disabled: true }));
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const user = String(body.user ?? '');
  const password = String(body.password ?? '');
  const nextRaw = String(body.next ?? '/admin');
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/admin';

  if (!checkCredentials(user, password, config.adminUser, config.adminPassword)) {
    // небольшая задержка, чтобы перебор не был бесплатным
    await new Promise((resolve) => setTimeout(resolve, 400));
    log.add({
      kind: 'error',
      page: 'admin',
      name: 'admin.login',
      ok: false,
      note: `неудачный вход: ${user.slice(0, 40) || '(пусто)'}`,
    });
    return reply
      .code(401)
      .type('text/html; charset=utf-8')
      .send(renderLogin({ next, error: 'Неверный логин или пароль' }));
  }

  const sessionId = newSessionId();
  activeSessions.add(sessionId);
  setAdminCookie(reply, createSessionToken(adminSecret, sessionId));
  log.add({ kind: 'value', page: 'admin', name: 'admin.login', ok: true });
  return reply.redirect(next, 303);
});

app.get('/admin/logout', async (req, reply) => {
  const sessionId = sessionIdFromToken(cookie(req, ADMIN_COOKIE));
  if (sessionId) activeSessions.delete(sessionId);
  clearAdminCookie(reply);
  return reply.redirect('/admin/login', 303);
});

app.get('/admin', async (req, reply) => {
  if (!requireAdminPage(req, reply)) return reply;
  return reply.type('text/html; charset=utf-8').send(renderAdmin());
});

app.get('/admin.css', async (req, reply) => {
  requireAdminApi(req, reply);
  return reply
    .type('text/css; charset=utf-8')
    .header('cache-control', 'no-cache')
    .send(readFileSync(join(process.cwd(), 'assets', 'admin.css'), 'utf8'));
});

app.get('/admin.js', async (req, reply) => {
  requireAdminApi(req, reply);
  return reply
    .type('text/javascript; charset=utf-8')
    .header('cache-control', 'no-cache')
    .send(readFileSync(join(process.cwd(), 'assets', 'admin.js'), 'utf8'));
});

/** Для админки отдаём черновик, если он есть: правки не должны ждать публикации. */
function adminForm(slug: string): Form {
  const form = drafts.get(slug) ?? forms.get(slug);
  if (!form) throw new HttpError(404, `формы «${slug}» нет`);
  return form;
}

app.get('/api/v1/admin/forms', async (req, reply) => {
  requireAdminApi(req, reply);
  return {
    forms: [...forms.values()].map((published) => {
      const draft = drafts.get(published.slug);
      const shown = draft ?? published;
      return {
        slug: published.slug,
        title: shown.title,
        elements: shown.elements.length,
        hasDraft: Boolean(draft),
      };
    }),
  };
});

app.get('/api/v1/admin/forms/:slug', async (req, reply) => {
  requireAdminApi(req, reply);
  const slug = (req.params as { slug: string }).slug;
  return { form: adminForm(slug), hasDraft: drafts.has(slug) };
});

app.post('/api/v1/admin/forms', async (req, reply) => {
  requireAdminApi(req, reply);
  const body = (req.body ?? {}) as { slug?: unknown; title?: unknown };
  const slug = String(body.slug ?? '')
    .trim()
    .toLowerCase();
  const title = String(body.title ?? '').trim();

  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)) {
    throw new HttpError(400, 'slug: латиница, цифры и дефис, до 40 символов');
  }
  if (!title) throw new HttpError(400, 'нужен заголовок');
  if (forms.has(slug)) throw new HttpError(409, `страница «${slug}» уже есть`);

  const form = formSchema.parse({
    slug,
    title,
    canvas: { width: 960 },
    elements: [
      {
        id: 'heading',
        kind: 'label',
        x: 40,
        y: 32,
        w: 600,
        h: 48,
        props: { text: title, size: 'l' },
      },
    ],
  });

  writeFileSync(join(config.formsDir, `${slug}.yaml`), YAML.stringify(compactForm(form)), 'utf8');
  forms.set(slug, form);
  log.add({ kind: 'value', page: slug, name: 'admin.create', ok: true });
  return { form };
});

app.put('/api/v1/admin/forms/:slug', async (req, reply) => {
  requireAdminApi(req, reply);
  const slug = (req.params as { slug: string }).slug;
  if (!forms.has(slug)) throw new HttpError(404, `формы «${slug}» нет`);

  const body = (req.body ?? {}) as { form?: unknown };
  const parsed = formSchema.safeParse(body.form);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`,
    );
    throw new HttpError(400, 'схема не прошла', issues);
  }

  const form = parsed.data;
  if (form.slug !== slug) {
    throw new HttpError(400, `slug нельзя менять: было «${slug}», стало «${form.slug}»`);
  }

  writeFileSync(
    draftFile(config.formsDir, slug),
    YAML.stringify(compactForm(form)),
    'utf8',
  );
  drafts.set(slug, form);
  log.add({ kind: 'value', page: slug, name: 'admin.save', ok: true });
  return { ok: true, draft: true, methods: methodsOf(form).map((method) => method.name) };
});

app.post('/api/v1/admin/forms/:slug/publish', async (req, reply) => {
  requireAdminApi(req, reply);
  const slug = (req.params as { slug: string }).slug;
  const draft = drafts.get(slug);
  const source = draft ?? forms.get(slug);
  if (!source) throw new HttpError(404, `формы «${slug}» нет`);

  writeFileSync(
    publishedFile(config.formsDir, slug),
    YAML.stringify(compactForm(source)),
    'utf8',
  );
  forms.set(slug, source);
  if (draft) {
    drafts.delete(slug);
    try {
      unlinkSync(draftFile(config.formsDir, slug));
    } catch {
      // черновик уже убран — не беда
    }
  }
  log.add({ kind: 'value', page: slug, name: 'admin.publish', ok: true });
  return { ok: true, methods: methodsOf(source).map((method) => method.name) };
});

app.delete('/api/v1/admin/forms/:slug', async (req, reply) => {
  requireAdminApi(req, reply);
  const slug = (req.params as { slug: string }).slug;
  const query = (req.query ?? {}) as Record<string, unknown>;

  if (query.confirm !== slug) {
    throw new HttpError(400, `для удаления нужен ?confirm=${slug}`);
  }
  if (!forms.has(slug) && !drafts.has(slug)) {
    throw new HttpError(404, `формы «${slug}» нет`);
  }
  if (forms.size <= 1 && forms.has(slug)) {
    throw new HttpError(409, 'последнюю страницу удалять нельзя: порталу нужна хотя бы одна');
  }

  for (const file of [publishedFile(config.formsDir, slug), draftFile(config.formsDir, slug)]) {
    try {
      unlinkSync(file);
    } catch {
      // файла могло не быть: страница жила только черновиком
    }
  }
  forms.delete(slug);
  drafts.delete(slug);
  state.removeForm(slug);
  pageStates.remove(slug);
  log.add({ kind: 'value', page: slug, name: 'admin.delete', ok: true });
  return { ok: true, removed: slug };
});

app.get('/api/v1/admin/settings', async (req, reply) => {
  requireAdminApi(req, reply);
  // токен записи нужен бэкенду; показываем его только вошедшему админу
  return { portalToken: config.token, defaultPage: settings.get().defaultPage ?? '' };
});

app.put('/api/v1/admin/settings', async (req, reply) => {
  requireAdminApi(req, reply);
  const body = (req.body ?? {}) as { defaultPage?: unknown };
  const slug = String(body.defaultPage ?? '').trim();
  if (slug && !forms.has(slug)) throw new HttpError(400, `страницы «${slug}» нет`);
  settings.setDefaultPage(slug);
  log.add({ kind: 'value', page: 'admin', name: 'admin.settings', ok: true, note: slug || 'список' });
  return { ok: true, defaultPage: settings.get().defaultPage ?? '' };
});

app.get('/api/v1/admin/tokens', async (req, reply) => {
  requireAdminApi(req, reply);
  return { tokens: tokens.list() };
});

app.post('/api/v1/admin/tokens', async (req, reply) => {
  requireAdminApi(req, reply);
  const body = (req.body ?? {}) as { name?: unknown };
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'нужно имя токена');
  const created = tokens.create(name);
  log.add({
    kind: 'value',
    page: 'admin',
    name: 'admin.token.create',
    ok: true,
    note: created.record.name,
  });
  return reply.code(201).send({ token: created.token, record: created.record });
});

app.delete('/api/v1/admin/tokens/:id', async (req, reply) => {
  requireAdminApi(req, reply);
  const id = (req.params as { id: string }).id;
  if (!tokens.revoke(id)) throw new HttpError(404, 'такого токена нет');
  log.add({ kind: 'value', page: 'admin', name: 'admin.token.revoke', ok: true, note: id });
  return { ok: true };
});

app.get('/api/v1/admin/targets', async (req, reply) => {
  requireAdminApi(req, reply);
  const usage = new Map<string, number>();
  for (const form of forms.values()) {
    for (const el of form.elements) {
      if (el.target) usage.set(el.target, (usage.get(el.target) ?? 0) + 1);
    }
  }
  return {
    targets: targets.list().map((t) => ({ ...t, usedBy: usage.get(t.name) ?? 0 })),
  };
});

app.put('/api/v1/admin/targets/:name', async (req, reply) => {
  requireAdminApi(req, reply);
  const name = (req.params as { name: string }).name;
  const body = (req.body ?? {}) as { url?: unknown };
  try {
    targets.set(name, String(body.url ?? ''));
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  log.add({ kind: 'value', page: 'admin', name: 'admin.target.set', ok: true, note: name });
  return { ok: true, targets: targets.list() };
});

app.delete('/api/v1/admin/targets/:name', async (req, reply) => {
  requireAdminApi(req, reply);
  const name = (req.params as { name: string }).name;
  if (!targets.remove(name)) throw new HttpError(404, 'такой цели нет');
  log.add({ kind: 'value', page: 'admin', name: 'admin.target.remove', ok: true, note: name });
  return { ok: true };
});

app.get('/api/v1/log', async (req) => {
  if (!authorized(req)) throw new HttpError(401, 'нужен Authorization: Bearer <PORTAL_TOKEN>');
  return { entries: log.tail(100) };
});

await app.listen({ port: config.port, host: config.host });
console.log(`page-studio: http://${config.host}:${config.port} · формы: ${[...forms.keys()].join(', ')}`);
