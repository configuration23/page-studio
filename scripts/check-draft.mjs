// Разовая проверка цикла «черновик → публикация». Меняет форму и возвращает её назад.
const BASE = 'http://127.0.0.1:3000';
const SLUG = 'generation';

const get = (path) => fetch(BASE + path).then((res) => res.json());
const send = (path, method, body) =>
  fetch(BASE + path, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));

const { form } = await get(`/api/v1/admin/forms/${SLUG}`);
const push = form.elements.find((el) => el.id === 'push');
const originalY = push.y;

const page = await fetch(`${BASE}/p/${SLUG}`).then((res) => res.text());
const publishedHasOriginal = page.includes(`top:${originalY}px`);

push.y = 296;
const saved = await send(`/api/v1/admin/forms/${SLUG}`, 'PUT', { form });
const afterSave = await fetch(`${BASE}/p/${SLUG}`).then((res) => res.text());

const list = await get('/api/v1/admin/forms');
const listed = list.forms.find((item) => item.slug === SLUG);

const published = await send(`/api/v1/admin/forms/${SLUG}/publish`, 'POST');
const afterPublish = await fetch(`${BASE}/p/${SLUG}`).then((res) => res.text());

// возвращаем как было
push.y = originalY;
await send(`/api/v1/admin/forms/${SLUG}`, 'PUT', { form: { ...form, elements: form.elements } });
await send(`/api/v1/admin/forms/${SLUG}/publish`, 'POST');

const restore = await fetch(`${BASE}/p/${SLUG}`).then((res) => res.text());

const result = {
  publishedHasOriginal,
  saveStatus: saved.status,
  hasDraftFlag: listed?.hasDraft,
  pageUnchangedAfterSave: afterSave.includes(`top:${originalY}px`) && !afterSave.includes('top:296px'),
  publishStatus: published.status,
  pageChangedAfterPublish: afterPublish.includes('top:296px'),
  restored: restore.includes(`top:${originalY}px`),
};
console.log(result);
const ok = Object.values(result).every((value) => value === true || value === 200 || value === undefined);
process.exit(ok ? 0 : 1);
