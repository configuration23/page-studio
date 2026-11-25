import { EVENTS_OF, KINDS, VALUE_KINDS, type Kind } from './model.js';
import { renderMarkdown } from './render.js';

type Entry = {
  name: string;
  what: string;
  props?: Array<[string, string]>;
  pitfalls?: Array<[string, string]>;
};

/**
 * Справка по видам элементов — единственный источник.
 * Общая страница собирается из этих записей; у элемента — короткий итог и ссылка.
 */
const HELP: Record<Kind, Entry> = {
  label: {
    name: 'Текст',
    what: 'Блок текста: заголовок, пояснение, длинная инструкция. Длинный текст прокручивается внутри блока. Пользователь его не редактирует — для ввода есть «Абзац».',
    props: [
      ['данные', 'многострочный текст, переносы сохраняются, до 20 000 символов'],
      ['обмен', 'включён — появляются методы, и текст попадает в снимок формы'],
      ['формат', 'обычный текст или маркдаун: заголовки, жирный, списки, код, ссылки'],
      ['выравн.', 'слева, по центру или справа'],
    ],
    pitfalls: [
      ['401', 'для записи значений нужен PORTAL_TOKEN, а не токен админского API'],
      ['400', 'у текста не включён «обмен» или строка длиннее 20 000 символов'],
    ],
  },
  edit: {
    name: 'Строка',
    what: 'Однострочное поле ввода. Пользователь вводит текст, значение хранится на сервере по сессии и видно бэкенду.',
    props: [
      ['подсказка', 'серый текст внутри поля'],
      ['лимит', 'сколько символов разрешено'],
      ['значение', 'что показать по умолчанию'],
    ],
    pitfalls: [['401', 'нужен PORTAL_TOKEN'], ['400', 'строка длиннее лимита']],
  },
  memo: {
    name: 'Абзац',
    what: 'Многострочное поле ввода: промпты, сообщения, описания. Всё как у строки, но с переносами строк.',
    props: [
      ['подсказка', 'серый текст внутри поля'],
      ['лимит', 'сколько символов разрешено'],
      ['значение', 'что показать по умолчанию'],
    ],
    pitfalls: [['401', 'нужен PORTAL_TOKEN'], ['400', 'строка длиннее лимита']],
  },
  combo: {
    name: 'Выбор',
    what: 'Список вариантов на выбор. Бэкенд получает выбранную строку; записать можно только один из вариантов.',
    props: [
      ['варианты', 'по одному в строке'],
      ['значение', 'какой вариант выбран по умолчанию'],
    ],
    pitfalls: [['400', 'значение должно быть из списка вариантов']],
  },
  check: {
    name: 'Флажок',
    what: 'Галочка: true или false. Годится для согласий и переключателей.',
    pitfalls: [['400', 'ожидается true или false, не строка']],
  },
  button: {
    name: 'Кнопка',
    what: 'Ничего не хранит. По клику отправляет событие вместе со снимком всей формы. Результат появляется позже — записью других элементов.',
    props: [['подпись', 'текст на кнопке']],
    pitfalls: [
      ['событие не ушло', 'у кнопки не выбрана цель («куда уходит» в инспекторе)'],
      ['404', 'цель есть, но вебхук в бэкенде не зарегистрирован или путь другой'],
    ],
  },
  image: {
    name: 'Картинка',
    what: 'Место под одно изображение. Бэкенд присылает файл байтами, портал хранит его и отдаёт по /media/<id>. Сама страница ничего не запрашивает.',
    props: [
      ['вписывать', 'включено — без обрезки, выключено — заполняет блок'],
      ['по клику', 'открывать поверх страницы в затемнённом слое'],
      ['в новом окне', 'открывать отдельным окном без интерфейса портала'],
    ],
    pitfalls: [
      ['415', 'не тот Content-Type: нужен image/png, image/jpeg или другой image/*'],
      ['400', 'пустое тело — файл не передан'],
    ],
  },
  gallery: {
    name: 'Галерея',
    what: 'Лента последних картинок страницы. Отдельно писать не нужно: как только бэкенд кладёт картинку в элемент «Картинка», она появляется здесь.',
    props: [
      ['штук', 'сколько последних показывать'],
      ['пусто', 'что показать, пока картинок нет'],
    ],
  },
  list: {
    name: 'Список',
    what: 'Строки от бэкенда: шаги обработки, статусы, названия. Это текст, а не картинки.',
    props: [['пусто', 'что показать, пока данных нет']],
    pitfalls: [['400', 'ожидается массив строк: до 100 штук по 300 символов']],
  },
  status: {
    name: 'Статус',
    what: 'Бейдж состояния: ожидание, в очереди, в работе, готово, ошибка. Страница обновляется сама, перезагружать не нужно.',
    pitfalls: [['400', 'state должен быть idle, queued, running, done или failed']],
  },
  onload: {
    name: 'Открытие',
    what: 'Невидимый на странице триггер: как только посетитель открыл страницу, портал отправляет событие со снимком формы. Нужен для дашбордов.',
    pitfalls: [
      ['событие не ушло', 'не выбрана цель («куда уходит» в инспекторе)'],
      ['событие не ушло', 'страница ещё не опубликована'],
    ],
  },
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function kindAnchor(kind: Kind): string {
  return `kind-${kind}`;
}

export function elementSummary(kind: Kind): { name: string; what: string; anchor: string } {
  return { name: HELP[kind].name, what: HELP[kind].what, anchor: kindAnchor(kind) };
}

/** Короткие итоги для инспектора: встраиваются в страницу админки. */
export function helpSummaries(): Record<string, { name: string; what: string }> {
  const out: Record<string, { name: string; what: string }> = {};
  for (const kind of KINDS) out[kind] = { name: HELP[kind].name, what: HELP[kind].what };
  return out;
}

function methodLines(kind: Kind): Array<[string, string, string]> {
  const lines: Array<[string, string, string]> = [];
  if (VALUE_KINDS.has(kind)) {
    lines.push(['прочитать', '<страница>.<id>', 'GET  <портал>/api/v1/forms/<страница>/values/<id>?sid=<sid>']);
    lines.push(['записать', '<страница>.post_<id>', 'POST <портал>/api/v1/forms/<страница>/values/<id>?sid=<sid>']);
  } else if (kind === 'label') {
    lines.push(['с галочкой «обмен»', '<страница>.<id>', 'GET  <портал>/api/v1/forms/<страница>/values/<id>?sid=<sid>']);
    lines.push(['с галочкой «обмен»', '<страница>.post_<id>', 'POST <портал>/api/v1/forms/<страница>/values/<id>?sid=<sid>']);
  }
  for (const event of EVENTS_OF[kind] ?? []) {
    lines.push([
      'событие',
      `<страница>.${event}_<id>`,
      `POST <портал>/api/v1/forms/<страница>/events/<id>?sid=<sid>`,
    ]);
  }
  return lines;
}

function writeExample(kind: Kind): string {
  if (!VALUE_KINDS.has(kind) && kind !== 'label') return '';
  if (kind === 'image') {
    return [
      'curl -X POST "<портал>/api/v1/forms/<страница>/values/<id>?sid=<sid>" \\',
      '  -H "Authorization: Bearer <PORTAL_TOKEN>" \\',
      '  -H "Content-Type: image/png" \\',
      '  --data-binary @result.png',
    ].join('\n');
  }
  const body =
    kind === 'check'
      ? '{ "value": true }'
      : kind === 'list'
        ? '{ "value": ["строка", "ещё строка"] }'
        : kind === 'status'
          ? '{ "value": { "state": "running", "text": "работаю" } }'
          : kind === 'label'
            ? '{ "value": "текст до 20 000 символов" }'
            : '{ "value": "значение" }';
  return [
    'curl -X POST "<портал>/api/v1/forms/<страница>/values/<id>?sid=<sid>" \\',
    '  -H "Authorization: Bearer <PORTAL_TOKEN>" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '${body}'`,
  ].join('\n');
}

function kindSection(kind: Kind): string {
  const entry = HELP[kind];
  const methods = methodLines(kind)
    .map(
      ([title, name, line]) =>
        `<tr><td>${esc(title)}</td><td><code>${esc(name)}</code></td><td><code>${esc(line)}</code></td></tr>`,
    )
    .join('');
  const props = (entry.props ?? [])
    .map(([name, desc]) => `<tr><td><code>${esc(name)}</code></td><td>${esc(desc)}</td></tr>`)
    .join('');
  const pitfalls = (entry.pitfalls ?? [])
    .map(([code, text]) => `<tr><td><code>${esc(code)}</code></td><td>${esc(text)}</td></tr>`)
    .join('');
  const write = writeExample(kind);

  return [
    `<section id="${kindAnchor(kind)}">`,
    `<h2>${esc(entry.name)} <span class="k">${esc(kind)}</span></h2>`,
    `<p>${esc(entry.what)}</p>`,
    props ? `<h3>Свойства</h3><table>${props}</table>` : '',
    methods ? `<h3>Методы</h3><table><tr><th>что</th><th>метод</th><th>вызов</th></tr>${methods}</table>` : `<h3>Методы</h3><p>Элемент только показывает — методов нет.</p>`,
    write ? `<h3>Как записать</h3><pre>${esc(write)}</pre>` : '',
    pitfalls ? `<h3>Частые ошибки</h3><table>${pitfalls}</table>` : '',
    `</section>`,
  ]
    .filter(Boolean)
    .join('\n');
}

const COMMON = `# Справка портала

## Как всё устроено

Портал хранит состояние страницы и показывает то, что в него положили. Каждый элемент на
канвасе — это **метод**: имя элемента становится именем метода.

- пользователь открывает страницу и что-то вводит — значение хранится на сервере в рамках сессии;
- нажимает кнопку — портал отправляет **событие** на выбранную цель со снимком всей формы;
- бэкенд решает, что делать, и присылает обратно статус, картинку или текст;
- страница обновляется сама (SSE), перезагружать её не нужно.

## Авторизация

| Что | Как | Для чего |
|---|---|---|
| Токен записи | \`Authorization: Bearer <PORTAL_TOKEN>\` | запись значений, картинок, состояния страницы |
| Токены админского API | \`Authorization: Bearer ps_…\` | скрипты: создать страницу, опубликовать, отозвать токен |
| Сессия админа | форма входа, кука | только админка и предпросмотр |

Для записи значений нужен **токен записи**, а не токен API — это самая частая ошибка
при подключении.

## Адреса

| Метод | Адрес | Что делает |
|---|---|---|
| GET | \`/p/<страница>\` | страница для пользователя |
| GET | \`/api/v1/forms/<страница>/manifest\` | элементы, методы, цели (без адресов) |
| GET | \`/api/v1/forms/<страница>/values/<id>?sid=<sid>\` | прочитать значение |
| POST | \`/api/v1/forms/<страница>/values/<id>?sid=<sid>\` | записать значение (JSON или image/*) |
| POST | \`/api/v1/forms/<страница>/events/<id>?sid=<sid>\` | браузер: событие |
| GET | \`/api/v1/forms/<страница>/stream\` | SSE: изменения |
| GET | \`/api/v1/forms/<страница>/state\` | состояние страницы (общее) |
| POST | \`/api/v1/forms/<страница>/state\` | бэкенд: записать состояние страницы |
| GET | \`/api/v1/forms/<страница>/ui\` | что скрыто и что неактивно в сессии |
| POST | \`/api/v1/forms/<страница>/ui/<id>\` | бэкенд: скрыть/показать один элемент |
| GET | \`/media/<id>\` | картинка |
| GET | \`/api/v1/pages\` | список страниц со статусами |

\`sid\` — идентификатор сессии посетителя: приходит в событии полем \`sid\` и в куке
\`ps_sid\`. Без него запись не поймёт, какой странице отдать значение.

## События и цели

Событие уходит на **цель** — именованный адрес из «Цели событий». В элементе хранится
только имя цели, поэтому страницу можно переносить между стендами, не выдавая адреса
вебхуков.

## Видимость и активность

Два уровня. Статические — в самой форме: у элемента «скрыт на странице» и «неактивен»,
у страницы «скрыть из списка» (прямая ссылка работает). Динамические — из бэкенда:
\`POST /api/v1/forms/<страница>/ui/<id>\` с \`{"hidden": true}\` или \`{"disabled": true}\`
меняет **один** элемент, остальные не трогает; \`false\` возвращает как было.

## Частые ошибки

| Код | Причина | Что делать |
|---|---|---|
| 401 | не тот токен | для значений — токен записи, не токен API |
| 415 | не тот Content-Type | для картинки \`image/png\`, для значения \`application/json\` |
| 400 | нет \`sid\` | брать \`sid\` из тела события |
| 404 | нет такой страницы или элемента | проверить \`slug\` и \`id\` в манифесте |
`;

const STYLE = `
:root { --bg:#0b0e13; --text:#e6edf3; --muted:#8b949e; --line:#232c3b; --accent:#4f8cff; --panel:#121722; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 "Segoe UI", system-ui, -apple-system, Arial, sans-serif; }
.layout { display:grid; grid-template-columns: 260px minmax(0, 900px); gap:36px; max-width:1250px; margin:0 auto; padding:28px 24px 80px; }
.toc { position:sticky; top:24px; align-self:start; font-size:13px; }
.toc a { display:block; color:var(--muted); text-decoration:none; padding:3px 0; }
.toc a:hover { color:var(--text); }
.toc .group { margin:16px 0 4px; color:#6b7787; text-transform:uppercase; letter-spacing:.07em; font-size:10px; }
main h1 { margin:0 0 14px; font-size:28px; }
main h2 { margin:34px 0 10px; font-size:20px; padding-top:10px; border-top:1px solid var(--line); }
main h3 { margin:20px 0 8px; font-size:15px; color:#c9d1d9; }
main p { margin:8px 0; }
main code { background:var(--panel); border:1px solid var(--line); border-radius:5px; padding:1px 5px; font-family:ui-monospace, Consolas, monospace; font-size:.92em; }
main pre { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; overflow:auto; }
main pre code { background:none; border:0; padding:0; }
main table { border-collapse:collapse; width:100%; margin:8px 0 4px; font-size:13px; }
main th, main td { border:1px solid var(--line); padding:6px 9px; text-align:left; vertical-align:top; }
main th { background:var(--panel); font-weight:600; }
main ul { margin:8px 0; padding-left:22px; }
main a { color:var(--accent); }
.k { font-size:11px; color:#6b7787; font-weight:400; }
section h2 { scroll-margin-top:20px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .toc { position:static; } }
`;

/** Полная страница справки: общие разделы + раздел на каждый вид элемента. */
export function guidePage(): string {
  const kinds = KINDS.map((kind) => `<a href="#${kindAnchor(kind)}">${esc(HELP[kind].name)}</a>`).join('');
  const sections = KINDS.map((kind) => kindSection(kind)).join('\n');
  const commonHtml = renderMarkdown(COMMON, 1)
    .replace('<h2>Как всё устроено</h2>', '<h2 id="how">Как всё устроено</h2>')
    .replace('<h2>Авторизация</h2>', '<h2 id="auth">Авторизация</h2>')
    .replace('<h2>Адреса</h2>', '<h2 id="api">Адреса</h2>')
    .replace('<h2>События и цели</h2>', '<h2 id="events">События и цели</h2>')
    .replace('<h2>Частые ошибки</h2>', '<h2 id="errors">Частые ошибки</h2>');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Справка портала</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%234f8cff'/><rect x='7' y='10' width='18' height='4' rx='2' fill='white'/><rect x='7' y='18' width='12' height='4' rx='2' fill='white' opacity='.65'/></svg>">
<style>${STYLE}</style>
</head>
<body>
<div class="layout">
  <nav class="toc">
    <a href="#top"><b>Справка</b></a>
    <div class="group">Общее</div>
    <a href="#how">Как всё устроено</a>
    <a href="#auth">Авторизация</a>
    <a href="#api">Адреса</a>
    <a href="#events">События и цели</a>
    <a href="#errors">Частые ошибки</a>
    <div class="group">Элементы</div>
    ${kinds}
  </nav>
  <main id="top">
    ${commonHtml}
    <section id="kinds">
      <h2>Элементы</h2>
      <p>У каждого вида — что это, свойства, методы и частые ошибки. Методы показаны шаблоном:
      <code>&lt;страница&gt;</code>, <code>&lt;id&gt;</code>, <code>&lt;sid&gt;</code> подставляются по вашей странице.</p>
    </section>
    ${sections}
  </main>
</div>
</body>
</html>`;
}
