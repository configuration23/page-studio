// Разовая проверка предпросмотра черновика. Меняет contact и возвращает назад.
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const SLUG = process.env.PREVIEW_PAGE ?? 'contact';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-dev';

// страницы админки открываются только по сессии, поэтому входим формой
const login = await fetch(BASE + '/admin/login', {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `user=${encodeURIComponent(ADMIN_USER)}&password=${encodeURIComponent(ADMIN_PASSWORD)}`,
});
const session = String(login.headers.get('set-cookie') || '').split(';')[0];
const auth = { cookie: session };

const get = (path) => fetch(BASE + path, { headers: auth }).then((res) => res.json());
const send = (path, method, body) =>
  fetch(BASE + path, {
    method,
    headers: body ? { ...auth, 'content-type': 'application/json' } : auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
const html = (path, withAuth) =>
  fetch(BASE + path, withAuth ? { headers: { cookie: session } } : undefined).then((res) =>
    res.text(),
  );

const { form } = await get(`/api/v1/admin/forms/${SLUG}`);
const trace = form.elements.find((el) => el.id === 'trace');
const originalY = trace.y;

trace.y = originalY + 24;
const saved = await send(`/api/v1/admin/forms/${SLUG}`, 'PUT', { form });

const draftPage = await html(`/p/${SLUG}?draft=1`, true);
const publicPage = await html(`/p/${SLUG}`);
const closed = await fetch(`${BASE}/p/${SLUG}?draft=1`);

const result = {
  saveStatus: saved.status,
  draftShowsNew: draftPage.includes(`top:${originalY + 24}px`),
  publicKeepsOld:
    publicPage.includes(`top:${originalY}px`) && !publicPage.includes(`top:${originalY + 24}px`),
  draftRequiresAuth: closed.status === 401,
};

trace.y = originalY;
await send(`/api/v1/admin/forms/${SLUG}`, 'PUT', { form });
await send(`/api/v1/admin/forms/${SLUG}/publish`, 'POST');
const restored = await html(`/p/${SLUG}`);
result.restored = restored.includes(`top:${originalY}px`);

console.log(result);
process.exit(Object.values(result).every((value) => value === true || value === 200) ? 0 : 1);
