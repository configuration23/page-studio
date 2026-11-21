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
  <button class="btn primary" id="save">Сохранить</button>
  <a class="btn" id="open" target="_blank" rel="noopener">Открыть страницу</a>
  <span class="spacer"></span>
  <span id="status"></span>
</header>
<main>
  <aside class="panel">
    <h3>Палитра</h3>
    <div id="palette"></div>
    <div class="muted">Клик — элемент появляется на канвасе. Имя элемента станет именем метода.</div>
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
<script src="/admin.js"></script>
</body>
</html>`;
}
