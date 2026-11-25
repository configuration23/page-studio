import { EVENTS_OF, hasValue, methodsOf, type Element, type Form, type Kind } from './model.js';

type Entry = {
  name: string;
  what: string;
  props?: Array<[string, string]>;
  pitfalls?: Array<[string, string]>;
};

/**
 * Справка по видам элементов — единственный источник.
 * Методы и примеры собираются из модели, поэтому не расходятся с кодом.
 */
const HELP: Record<Kind, Entry> = {
  label: {
    name: 'Текст',
    what: 'Блок текста: заголовок, пояснение, длинная инструкция. Длинный текст прокручивается внутри блока. Пользователь его не редактирует — для ввода есть «Абзац».',
    props: [
      ['данные', 'многострочный текст, переносы сохраняются, до 20 000 символов'],
      ['обмен', 'включён — появляются методы и текст попадает в снимок формы'],
      ['формат', 'обычный текст или маркдаун (заголовки, жирный, списки, код, ссылки)'],
      ['выравн.', 'слева, по центру или справа'],
    ],
    pitfalls: [
      ['401', 'для записи значений нужен PORTAL_TOKEN, не токен админского API'],
      ['400', 'у текста не включён обмен или строка длиннее 20 000 символов'],
    ],
  },
  edit: {
    name: 'Строка',
    what: 'Однострочное поле ввода. Пользователь вводит текст, значение хранится на сервере по сессии.',
    props: [
      ['подсказка', 'серый текст внутри поля'],
      ['лимит', 'сколько символов разрешено'],
      ['значение', 'что показать по умолчанию'],
    ],
    pitfalls: [['401', 'нужен PORTAL_TOKEN'], ['400', 'строка длиннее лимита']],
  },
  memo: {
    name: 'Абзац',
    what: 'Многострочное поле ввода: промпты, сообщения, описания. Всё как у строки, но с переносами.',
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
    what: 'Ничего не хранит. По клику отправляет событие вместе со снимком всей формы. Результат появляется позже — через запись других элементов.',
    props: [['подпись', 'текст на кнопке']],
    pitfalls: [
      ['событие не ушло', 'у кнопки не выбрана цель («куда уходит» в инспекторе)'],
      ['404', 'цель есть, но вебхук в бэкенде не зарегистрирован'],
    ],
  },
  image: {
    name: 'Картинка',
    what: 'Место под одно изображение. Бэкенд присылает файл байтами, портал хранит его и отдаёт по /media/<id>. Сама страница ничего не запрашивает.',
    props: [
      ['вписывать', 'включено — без обрезки, выключено — заполняет блок'],
      ['по клику', 'открывать поверх страницы в затемнённом слое'],
      ['в новом окне', 'открывать отдельным окном без интерфейса'],
    ],
    pitfalls: [
      ['415', 'не тот Content-Type: нужен image/png, image/jpeg или другой image/*'],
      ['400', 'пустое тело — файл не передан'],
    ],
  },
  gallery: {
    name: 'Галерея',
    what: 'Лента последних картинок страницы. Отдельно писать не нужно: как только бэкенд кладёт картинку в image, она появляется здесь.',
    props: [
      ['штук', 'сколько последних показывать'],
      ['пусто', 'что показать, пока картинок нет'],
    ],
  },
  list: {
    name: 'Список',
    what: 'Строки от бэкенда: шаги обработки, статусы, названия. Это текст, а не картинки.',
    props: [
      ['пусто', 'что показать, пока данных нет'],
    ],
    pitfalls: [['400', 'ожидается массив строк, до 100 штук по 300 символов']],
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
      ['событие не ушло', 'не выбрана цель («куда уходит»)'],
      ['событие не ушло', 'в дизайнере элемент есть, но страница не опубликована'],
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

const PORTAL = '<портал>';
const SID = '<sid>';
const TOKEN = '<PORTAL_TOKEN>';

function methodsHtml(form: Form, el: Element): string {
  const methods = methodsOf(form).filter((method) => method.elementId === el.id);
  if (!methods.length) return '<div class="m"><b>Методов нет</b><br><span class="muted">элемент только показывает, бэкенд его не видит</span></div>';

  return methods
    .map((method) => {
      let line = '';
      let title = '';
      if (method.kind === 'get') {
        title = 'прочитать';
        line = `GET  ${PORTAL}/api/v1/forms/${form.slug}/values/${el.id}?sid=${SID}`;
      } else if (method.kind === 'post') {
        title = 'записать';
        line = `POST ${PORTAL}/api/v1/forms/${form.slug}/values/${el.id}?sid=${SID}`;
      } else {
        title = 'событие';
        line = `POST ${PORTAL}/api/v1/forms/${form.slug}/events/${el.id}?sid=${SID}`;
      }
      return `<div class="m"><span><b>${esc(title)}</b><br>${esc(method.name)}<br><code>${esc(line)}</code></span></div>`;
    })
    .join('');
}

function exampleHtml(form: Form, el: Element): string {
  const events = EVENTS_OF[el.kind] ?? [];
  if (events.length) {
    const payload = {
      page: form.slug,
      element: el.id,
      event: events[0],
      sid: 'a1b2c3d4e5f6',
      values: { '<id поля>': '<значение>' },
    };
    return `<div class="m"><b>Что уходит в событии</b><pre>${esc(JSON.stringify(payload, null, 2))}</pre></div>`;
  }
  if (!hasValue(el)) return '';
  if (el.kind === 'image') {
    return `<div class="m"><b>Как записать</b><pre>${esc(
      `curl -X POST "${PORTAL}/api/v1/forms/${form.slug}/values/${el.id}?sid=${SID}" \\\n  -H "Authorization: Bearer ${TOKEN}" \\\n  -H "Content-Type: image/png" \\\n  --data-binary @result.png`,
    )}</pre></div>`;
  }
  const body =
    el.kind === 'check'
      ? '{ "value": true }'
      : el.kind === 'list'
        ? '{ "value": ["строка", "ещё строка"] }'
        : el.kind === 'status'
          ? '{ "value": { "state": "running", "text": "работаю" } }'
          : '{ "value": "значение" }';
  return `<div class="m"><b>Как записать</b><pre>${esc(
    `curl -X POST "${PORTAL}/api/v1/forms/${form.slug}/values/${el.id}?sid=${SID}" \\\n  -H "Authorization: Bearer ${TOKEN}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`,
  )}</pre></div>`;
}

/** HTML-справка для инспектора: описание, свойства, методы, пример, ошибки. */
export function elementHelpHtml(form: Form, el: Element): string {
  const entry = HELP[el.kind];
  const props = (entry.props ?? [])
    .map(([name, desc]) => `<div class="m"><span><b>${esc(name)}</b><br><span class="muted">${esc(desc)}</span></span></div>`)
    .join('');
  const pitfalls = (entry.pitfalls ?? [])
    .map(([code, text]) => `<div class="m"><span><b>${esc(code)}</b><br><span class="muted">${esc(text)}</span></span></div>`)
    .join('');

  return [
    `<h3>Справка</h3>`,
    `<div class="m"><span><b>${esc(entry.name)}</b><br><span class="muted">${esc(entry.what)}</span></span></div>`,
    props ? `<div class="m"><span><b>Свойства</b></span></div>${props}` : '',
    methodsHtml(form, el),
    exampleHtml(form, el),
    pitfalls ? `<div class="m"><span><b>Частые ошибки</b></span></div>${pitfalls}` : '',
  ].join('');
}
