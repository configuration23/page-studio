// Разовая проверка цикла «черновик → публикация». Меняет форму и возвращает её назад.
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const SLUG = process.env.SMOKE_PAGE ?? 'generation';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-dev';

// страницы админки открываются только по сессии
const login = await fetch(BASE + '/admin/login', {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `user=${encodeURIComponent(ADMIN_USER)}&password=${encodeURIComponent(ADMIN_PASSWORD)}`,
});
const session = String(login.headers.get('set-cookie') || '').split(';')[0];
const auth = { cookie: session };

const get = (path) =>
  fetch(BASE + path, { headers: auth }).then((res) => res.json());
const send = (path, method, body) =>
  fetch(BASE + path, {
    method,
    headers: body ? { ...auth, 'content-type': 'application/json' } : auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
const html = (path) => fetch(BASE + path).then((res) => res.text());

const { form } = await get(`/api/v1/admin/forms/${SLUG}`);
const push = form.elements.find((el) => el.id === 'push');
const originalY = push.y;

const page = await html(`/p/${SLUG}`);
const publishedHasOriginal = page.includes(`top:${originalY}px`);

push.y = 296;
const saved = await send(`/api/v1/admin/forms/${SLUG}`, 'PUT', { form });
const afterSave = await html(`/p/${SLUG}`);

const list = await get('/api/v1/admin/forms');
const listed = list.forms.find((item) => item.slug === SLUG);

const draftPreview = await fetch(`${BASE}/p/${SLUG}?draft=1`, { headers: { cookie: session } });
const previewText = await draftPreview.text();

const published = await send(`/api/v1/admin/forms/${SLUG}/publish`, 'POST');
const afterPublish = await html(`/p/${SLUG}`);

// возвращаем как было
push.y = originalY;
await send(`/api/v1/admin/forms/${SLUG}`, 'PUT', { form });
await send(`/api/v1/admin/forms/${SLUG}/publish`, 'POST');
const restore = await html(`/p/${SLUG}`);

const result = {
  publishedHasOriginal,
  saveStatus: saved.status,
  hasDraftFlag: listed?.hasDraft,
  pageUnchangedAfterSave: afterSave.includes(`top:${originalY}px`) && !afterSave.includes('top:296px'),
  previewShowsDraft: draftPreview.ok && previewText.includes('top:296px'),
  publishStatus: published.status,
  pageChangedAfterPublish: afterPublish.includes('top:296px'),
  restored: restore.includes(`top:${originalY}px`),
};
console.log(result);
const ok = Object.values(result).every((value) => value === true || value === 200 || value === undefined);
process.exit(ok ? 0 : 1);
