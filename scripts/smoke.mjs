#!/usr/bin/env node
/**
 * Сквозная проверка контракта: временная страница, методы, событие, доставка
 * картинки, галерея. Требует запущенных портала и демо-драйвера.
 *
 * Страница создаётся на время проверки и удаляется в конце, поэтому чужие
 * страницы не трогаются, а демо-страница для проверки не нужна.
 *
 *   node scripts/smoke.mjs
 */
import { randomBytes } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const TOKEN = process.env.PORTAL_TOKEN ?? 'dev-token-local';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-dev';
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 25000);
const PAGE = `smoke-${randomBytes(3).toString('hex')}`;

const adminAuth = `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')}`;

let failed = 0;
const results = [];

function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const auth = { authorization: `Bearer ${TOKEN}` };
const json = { 'content-type': 'application/json', ...auth };

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json() : await res.text();
  return { res, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEST_FORM = {
  slug: PAGE,
  title: 'Проверка контракта',
  canvas: { width: 960, height: 800 },
  elements: [
    { id: 'prompt', kind: 'memo', x: 40, y: 40, w: 520, h: 120, label: 'Промпт', props: { placeholder: 'что нарисовать' } },
    { id: 'push', kind: 'button', x: 600, y: 40, w: 200, h: 48, label: 'Нарисовать', target: 'demo', props: { primary: true } },
    { id: 'status', kind: 'status', x: 600, y: 110, w: 260, h: 40 },
    { id: 'image', kind: 'image', x: 40, y: 190, w: 520, h: 360, label: 'Результат', props: { zoom: true, newWindow: true } },
    { id: 'gallery', kind: 'gallery', x: 600, y: 190, w: 300, h: 360, label: 'История' },
    { id: 'open', kind: 'onload', x: 40, y: 560, w: 220, h: 32, target: 'demo' },
    { id: 'doc', kind: 'label', x: 40, y: 604, w: 880, h: 140, props: { text: 'Начальный **текст**', send: true, format: 'markdown', align: 'center' } },
  ],
};

async function main() {
  const health = await api('/health');
  check('health отвечает', health.res.ok && health.body.ok === true, JSON.stringify(health.body));

  // --- вход в админку --------------------------------------------------------
  const adminClosed = await fetch(`${BASE}/admin`, { redirect: 'manual' });
  check(
    'админка без входа уводит на форму',
    adminClosed.status === 303 && String(adminClosed.headers.get('location') || '').startsWith('/admin/login'),
    `код ${adminClosed.status}`,
  );

  const loginPage = await fetch(`${BASE}/admin/login`);
  const loginHtml = await loginPage.text();
  check('форма входа отдаётся', loginPage.ok && loginHtml.includes('name="password"'));

  const login = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(ADMIN_USER)}&password=${encodeURIComponent(ADMIN_PASSWORD)}&next=%2Fadmin`,
  });
  const session = String(login.headers.get('set-cookie') || '').split(';')[0];
  check('вход по форме выдаёт сессию', login.status === 303 && session.startsWith('ps_admin='), `код ${login.status}`);

  const adminOpen = await fetch(`${BASE}/admin`, { headers: { cookie: session } });
  check('админка открывается с сессией', adminOpen.ok, `код ${adminOpen.status}`);

  const adminBasic = await fetch(`${BASE}/admin`, {
    headers: { authorization: adminAuth },
    redirect: 'manual',
  });
  check('страницы админки не пускают по учётным данным Basic', adminBasic.status === 303, `код ${adminBasic.status}`);

  // --- токены ----------------------------------------------------------------
  const tokenCreated = await fetch(`${BASE}/api/v1/admin/tokens`, {
    method: 'POST',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'smoke' }),
  });
  const tokenBody = await tokenCreated.json().catch(() => ({}));
  const apiToken = typeof tokenBody.token === 'string' ? tokenBody.token : '';
  check('токен создаётся', tokenCreated.status === 201 && apiToken.startsWith('ps_'));

  const apiWithToken = await fetch(`${BASE}/api/v1/admin/forms`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  check('API принимает токен', apiWithToken.ok, `код ${apiWithToken.status}`);

  const pageWithToken = await fetch(`${BASE}/admin`, {
    headers: { authorization: `Bearer ${apiToken}` },
    redirect: 'manual',
  });
  check('страницы админки не пускают по токену', pageWithToken.status === 303);

  const revoked = await fetch(`${BASE}/api/v1/admin/tokens/${tokenBody.record?.id}`, {
    method: 'DELETE',
    headers: { cookie: session },
  });
  check('токен отзывается', revoked.ok, `код ${revoked.status}`);

  const afterRevoke = await fetch(`${BASE}/api/v1/admin/forms`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  check('отозванный токен не работает', afterRevoke.status === 401, `код ${afterRevoke.status}`);

  // --- временная страница ----------------------------------------------------
  const created = await fetch(`${BASE}/api/v1/admin/forms`, {
    method: 'POST',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: PAGE, title: TEST_FORM.title }),
  });
  check('временная страница создаётся', created.status === 200, `код ${created.status}`);

  const saved = await fetch(`${BASE}/api/v1/admin/forms/${PAGE}`, {
    method: 'PUT',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: JSON.stringify({ form: TEST_FORM }),
  });
  check('черновик временной страницы сохраняется', saved.ok, `код ${saved.status}`);

  const published = await fetch(`${BASE}/api/v1/admin/forms/${PAGE}/publish`, {
    method: 'POST',
    headers: { cookie: session },
  });
  check('временная страница публикуется', published.ok, `код ${published.status}`);

  try {
    // --- публичная часть -----------------------------------------------------
    const page = await api(`/p/${PAGE}`);
    const pageHtml = String(page.body);
    check('страница отдаётся', page.res.ok && pageHtml.includes(`data-page="${PAGE}"`));
    check(
      'на странице есть возврат к списку',
      pageHtml.includes('href="/pages"') && pageHtml.includes('К списку страниц'),
    );

    const index = await api('/pages');
    check('список страниц доступен', index.res.ok && String(index.body).includes(`/p/${PAGE}`));

    const manifest = await api(`/api/v1/forms/${PAGE}/manifest`);
    const methods = (manifest.body.methods ?? []).map((m) => m.name);
    check('манифест: метод события', methods.includes(`${PAGE}.on_click_push`));
    check('манифест: метод записи картинки', methods.includes(`${PAGE}.post_image`));
    const pushElement = (manifest.body.elements ?? []).find((el) => el.id === 'push');
    check('манифест: у кнопки есть цель события', Boolean(pushElement?.target), String(pushElement?.target));
    check('манифест: адреса целей не отдаются', !JSON.stringify(manifest.body).includes('http'));

    const draftClosed = await fetch(`${BASE}/p/${PAGE}?draft=1`, { redirect: 'manual' });
    check('предпросмотр черновика закрыт', draftClosed.status === 303);

    // --- триггер открытия и состояние страницы --------------------------------
    check('манифест: метод открытия страницы', methods.includes(`${PAGE}.on_open_open`));
    check('на странице есть невидимый триггер', pageHtml.includes('data-onload="1"'));

    const noTokenState = await api(`/api/v1/forms/${PAGE}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { state: 'done' } }),
    });
    check('состояние страницы без токена не пишется', noTokenState.res.status === 401, `код ${noTokenState.res.status}`);

    const setState = await api(`/api/v1/forms/${PAGE}/state`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ value: { state: 'done', text: 'работает' } }),
    });
    check('состояние страницы записывается', setState.res.ok && setState.body.value?.state === 'done');

    const readState = await api(`/api/v1/forms/${PAGE}/state`);
    check('состояние страницы читается', readState.body.value?.state === 'done');

    const pagesApi = await api('/api/v1/pages');
    const listed = (pagesApi.body.pages ?? []).find((item) => item.slug === PAGE);
    check('список страниц показывает состояние', listed?.state?.state === 'done', JSON.stringify(listed?.state));

    // --- значения и событие --------------------------------------------------
    const sid = randomBytes(6).toString('hex');

    const denied = await api(`/api/v1/forms/${PAGE}/values/status?sid=${sid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { state: 'running' } }),
    });
    check('без токена запись запрещена', denied.res.status === 401, `код ${denied.res.status}`);

    const prompt = 'кот-астронавт, акварель, мягкий свет';
    const setPrompt = await api(`/api/v1/forms/${PAGE}/values/prompt?sid=${sid}`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ value: prompt }),
    });
    check('промпт записан', setPrompt.res.ok && setPrompt.body.value === prompt);

    check(
      'манифест: у текста есть методы обмена',
      methods.includes(`${PAGE}.doc`) && methods.includes(`${PAGE}.post_doc`),
    );

    const longText = 'строка текста с переносами.\n'.repeat(120);
    const setDoc = await api(`/api/v1/forms/${PAGE}/values/doc?sid=${sid}`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ value: longText }),
    });
    check(
      'длинный текст записывается целиком',
      setDoc.res.ok && setDoc.body.value?.length === longText.length,
      `код ${setDoc.res.status}, ${setDoc.body.value?.length ?? 0} символов`,
    );

    const pageWithDoc = await api(`/p/${PAGE}?sid=${sid}`);
    check('текст с бэкенда виден на странице', String(pageWithDoc.body).includes('строка текста с переносами.'));

    // оформление текста: маркдаун и выравнивание
    const styled = await api(`/p/${PAGE}?sid=${sid}`);
    check('маркдаун превращается в разметку', String(styled.body).includes('<strong>текст</strong>'));
    check('выравнивание попадает в разметку', String(styled.body).includes('text-align:center'));

    // вид списка страниц: меняем, проверяем и возвращаем как было
    const settingsBefore = await (await fetch(`${BASE}/api/v1/admin/settings`, { headers: { cookie: session } })).json();
    const viewChanged = await fetch(`${BASE}/api/v1/admin/settings`, {
      method: 'PUT',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ listView: 'rows' }),
    });
    const rowsPage = await api('/pages');
    check(
      'вид списка применяется',
      viewChanged.ok && String(rowsPage.body).includes('view-rows'),
    );
    await fetch(`${BASE}/api/v1/admin/settings`, {
      method: 'PUT',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ listView: settingsBefore.listView || 'cards' }),
    });

    const event = await api(`/api/v1/forms/${PAGE}/events/push?sid=${sid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('событие принято', event.res.status === 202 && event.body.pushed === true, JSON.stringify(event.body));

    const started = Date.now();
    let status = null;
    while (Date.now() - started < WAIT_MS) {
      const statusRes = await api(`/api/v1/forms/${PAGE}/values/status?sid=${sid}`, { headers: auth });
      status = statusRes.body.value;
      if (status?.state === 'done' || status?.state === 'failed') break;
      await sleep(500);
    }
    check('статус дошёл до done', status?.state === 'done', `state=${status?.state} text=${status?.text}`);

    const imageRes = await api(`/api/v1/forms/${PAGE}/values/image?sid=${sid}`, { headers: auth });
    const image = imageRes.body.value;
    check('картинка записана', Boolean(image?.imageId), JSON.stringify(image));

    if (image?.imageId) {
      const media = await fetch(`${BASE}/media/${image.imageId}`);
      const type = media.headers.get('content-type') ?? '';
      const bytes = (await media.arrayBuffer()).byteLength;
      check('картинка отдаётся', media.ok && type.startsWith('image/') && bytes > 1000, `${type}, ${bytes} байт`);
    }

    const gallery = await api(`/api/v1/forms/${PAGE}/values/gallery?sid=${sid}`, { headers: auth });
    check('галерея видит картинку', Array.isArray(gallery.body.value) && gallery.body.value.length > 0);

    const pageWithImage = await api(`/p/${PAGE}?sid=${sid}`);
    const htmlWithImage = String(pageWithImage.body);
    check('картинка открывается в слое', htmlWithImage.includes('data-zoom="1"'));
    check('картинка открывается в новом окне', htmlWithImage.includes('data-href="/media/'));

    const log = await api('/api/v1/log', { headers: auth });
    check('журнал пишет вызовы', Array.isArray(log.body.entries) && log.body.entries.length > 0);
  } finally {
    // за собой убираем всегда, даже если проверка упала
    const removed = await fetch(`${BASE}/api/v1/admin/forms/${PAGE}?confirm=${PAGE}`, {
      method: 'DELETE',
      headers: { cookie: session },
    });
    check('временная страница удаляется', removed.ok, `код ${removed.status}`);
  }

  // --- выход -----------------------------------------------------------------
  const logout = await fetch(`${BASE}/admin/logout`, {
    headers: { cookie: session },
    redirect: 'manual',
  });
  check(
    'выход очищает сессию',
    logout.status === 303 && String(logout.headers.get('set-cookie') || '').includes('ps_admin=;'),
    `код ${logout.status}`,
  );

  const afterLogout = await fetch(`${BASE}/admin`, { headers: { cookie: session }, redirect: 'manual' });
  check('после выхода сессия не работает', afterLogout.status === 303, `код ${afterLogout.status}`);

  const adminApiClosed = await fetch(`${BASE}/api/v1/admin/forms`);
  check(
    'API админки без входа закрыт без диалога браузера',
    adminApiClosed.status === 401 && !adminApiClosed.headers.get('www-authenticate'),
  );

  console.log(`\n${failed === 0 ? 'всё зелёное' : `провалов: ${failed}`} · ${results.length} проверок`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('проверка упала:', err);
  process.exit(1);
});
