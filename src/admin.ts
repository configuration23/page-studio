export function renderLogin(options: { next?: string; error?: string; disabled?: boolean } = {}): string {
  const error = options.error
    ? `<div class="err">${escapeLogin(options.error)}</div>`
    : '';
  const body = options.disabled
    ? `<div class="err">Админка выключена: не задан ADMIN_PASSWORD.</div>`
    : `<form method="post" action="/admin/login">
      <input type="hidden" name="next" value="${escapeLogin(options.next ?? '/admin')}">
      <label>Логин<input name="user" autocomplete="username" autofocus></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password"></label>
      ${error}
      <button type="submit">Войти</button>
    </form>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>page-studio · вход</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%234f8cff'/><rect x='7' y='10' width='18' height='4' rx='2' fill='white'/><rect x='7' y='18' width='12' height='4' rx='2' fill='white' opacity='.65'/></svg>">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0b0e13; color: #e6edf3;
    font: 15px/1.5 "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
  }
  .card {
    width: 340px; background: #121722; border: 1px solid #232c3b;
    border-radius: 14px; padding: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.5);
  }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 18px; color: #8b949e; font-size: 13px; }
  label { display: block; margin-bottom: 12px; font-size: 12px; color: #8b949e; }
  input {
    display: block; width: 100%; margin-top: 5px; padding: 9px 11px;
    background: #171d29; border: 1px solid #232c3b; border-radius: 8px;
    color: #e6edf3; font: inherit; outline: none;
  }
  input:focus { border-color: #4f8cff; }
  button {
    width: 100%; margin-top: 6px; padding: 10px; border: 0; border-radius: 8px;
    background: #4f8cff; color: #fff; font: 600 15px/1 inherit; cursor: pointer;
  }
  button:hover { filter: brightness(1.06); }
  .err {
    margin: 0 0 12px; padding: 8px 10px; border-radius: 8px;
    background: #2a1717; border: 1px solid #6b2a2a; color: #ff8b84; font-size: 13px;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>page-studio</h1>
    <p class="sub">Вход в админку</p>
    ${body}
  </div>
</body>
</html>`;
}

function escapeLogin(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderAdmin(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>page-studio · админка</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%234f8cff'/><rect x='7' y='10' width='18' height='4' rx='2' fill='white'/><rect x='7' y='18' width='12' height='4' rx='2' fill='white' opacity='.65'/></svg>">
<link rel="stylesheet" href="/admin.css">
</head>
<body>
<header>
  <span class="brand">page-studio <span>· админка</span></span>
  <select id="form-select" title="страница"></select>
  <button class="btn" id="new-page" title="создать страницу">+ Страница</button>
  <button class="btn" id="page-settings" title="настройки страницы">Настройки</button>
  <button class="btn" id="save">Сохранить</button>
  <button class="btn primary" id="publish">Опубликовать</button>
  <span id="draft-badge" class="draft-badge" hidden>черновик</span>
  <a class="btn" id="preview" target="_blank" rel="noopener">Предпросмотр</a>
  <a class="btn" id="open" target="_blank" rel="noopener">Открыть</a>
  <span class="spacer"></span>
  <span id="status"></span>
  <a class="btn" href="/admin/logout" title="выйти из админки">Выйти</a>
</header>
<main>
  <aside class="panel">
    <h3>Палитра</h3>
    <div id="palette"></div>
    <div class="muted">Клик — элемент появляется на канвасе. Имя элемента станет именем метода.</div>
    <div class="snap-panel">
      <label><input type="checkbox" id="snap-enabled" checked> <b>Магнит</b></label>
      <label><input type="checkbox" id="snap-edges" checked> края элементов</label>
      <label><input type="checkbox" id="snap-centers" checked> центры элементов</label>
      <label><input type="checkbox" id="snap-canvas" checked> края и центр канваса</label>
      <label><input type="checkbox" id="snap-resize" checked> изменение размера</label>
    </div>
    <button class="btn" id="tokens-open" style="margin: 0 10px 14px; width: calc(100% - 20px)">API-токены</button>
  </aside>
  <section id="stage">
    <div id="canvas"></div>
  </section>
  <aside class="panel right" id="inspector"></aside>
</main>
<div class="modal" id="modal" hidden>
  <div class="modal-box">
    <h3>Новая страница</h3>
    <label>Адрес (slug)<input id="new-slug" placeholder="recipes" autocomplete="off"></label>
    <label>Заголовок<input id="new-title" placeholder="Рецепты" autocomplete="off"></label>
    <p class="modal-hint">slug попадает в имена методов: <code>recipes.heading</code>. Менять его потом нельзя.</p>
    <div class="modal-actions">
      <button class="btn" id="new-cancel">Отмена</button>
      <button class="btn primary" id="new-create">Создать</button>
    </div>
  </div>
</div>
<div class="modal" id="page-modal" hidden>
  <div class="modal-box">
    <h3>Страница</h3>
    <label>Заголовок<input id="page-title" autocomplete="off"></label>
    <label>Подпись<input id="page-lead" autocomplete="off"></label>
    <label>Ширина, px<input id="page-width" type="number" min="320" max="1920" step="10"></label>
    <label>Высота, px<input id="page-height" type="number" min="200" max="8000" step="10" placeholder="авто"></label>
    <p class="modal-hint">Пустая высота — страница по содержимому. Заданная — фиксированная; элемент ниже границы подсвечивается на канвасе.</p>
    <div class="modal-actions">
      <button class="btn danger" id="delete-page" style="margin-right:auto">Удалить страницу</button>
      <button class="btn" id="page-cancel">Отмена</button>
      <button class="btn primary" id="page-apply">Применить</button>
    </div>
  </div>
</div>
<div class="modal" id="tokens-modal" hidden>
  <div class="modal-box" style="width: 540px">
    <h3>Токены API</h3>
    <p class="modal-hint">Токеном ходят скрипты и автоматизация: <code>Authorization: Bearer &lt;токен&gt;</code>. Сам токен показывается один раз — сохрани его.</p>
    <div id="token-fresh" class="token-fresh" hidden>
      <label>Новый токен<input id="token-value" readonly></label>
      <button class="btn" id="token-copy">копировать</button>
    </div>
    <div id="token-list" class="token-list"></div>
    <div class="modal-actions">
      <input id="token-name" placeholder="имя, например n8n-backup" style="flex: 1; margin-right: 8px">
      <button class="btn primary" id="token-create">Создать</button>
      <button class="btn" id="token-close">Закрыть</button>
    </div>
  </div>
</div>
<script src="/admin.js"></script>
</body>
</html>`;
}
