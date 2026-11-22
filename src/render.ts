import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_OF, type Element, type Form } from './model.js';
import type { Values } from './state.js';

function asset(name: string): string {
  try {
    return readFileSync(join(process.cwd(), 'assets', name), 'utf8');
  } catch {
    return '';
  }
}

const CSS = asset('style.css');
const CLIENT = asset('client.js');

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_TEXT: Record<string, string> = {
  idle: 'Ожидание',
  queued: 'В очереди',
  running: 'Рисует…',
  done: 'Готово',
  failed: 'Ошибка',
};

export type GalleryItem = { imageId: string; note?: string; createdAt?: string };

type StatusValue = { state?: string; text?: string };
type ImageValue = { imageId?: string } | null;

function sizeClass(el: Element): string {
  return `s-${el.props.size ?? 'm'}`;
}

function eventAttr(el: Element): string {
  const events = EVENTS_OF[el.kind];
  return events && events.length > 0 ? ` data-event="${events[0]}"` : '';
}

function renderInner(el: Element, value: unknown, items: GalleryItem[]): string {
  const p = el.props;
  const label = el.label ? `<div class="cap">${escapeHtml(el.label)}</div>` : '';

  switch (el.kind) {
    case 'label': {
      const text = p.text ?? el.label ?? '';
      return `<div class="txt">${escapeHtml(text)}</div>`;
    }
    case 'edit': {
      const max = p.max ? ` maxlength="${p.max}"` : '';
      return `${label}<input class="inp" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(p.placeholder ?? '')}"${max}>`;
    }
    case 'memo': {
      const max = p.max ? ` maxlength="${p.max}"` : '';
      return `${label}<textarea class="inp" placeholder="${escapeHtml(p.placeholder ?? '')}"${max}>${escapeHtml(value)}</textarea>`;
    }
    case 'combo': {
      const options = (p.options ?? [])
        .map(
          (opt) =>
            `<option value="${escapeHtml(opt)}"${opt === value ? ' selected' : ''}>${escapeHtml(opt)}</option>`,
        )
        .join('');
      return `${label}<select class="inp">${options}</select>`;
    }
    case 'check': {
      return `<label class="check"><input type="checkbox"${value ? ' checked' : ''}><span>${escapeHtml(el.label ?? '')}</span></label>`;
    }
    case 'button': {
      const cls = p.primary === false ? 'btn ghost' : 'btn';
      return `<button class="${cls}" type="button">${escapeHtml(el.label ?? 'Кнопка')}</button>`;
    }
    case 'image': {
      const imageValue = value as ImageValue;
      const img = imageValue?.imageId
        ? `<img src="/media/${escapeHtml(imageValue.imageId)}" alt="${escapeHtml(el.label ?? '')}">`
        : '<div class="ph">картинки пока нет</div>';
      return `${label}<div class="imgbox">${img}</div>`;
    }
    case 'gallery': {
      const limit = p.limit ?? 24;
      const shown = items.slice(0, limit);
      const cards = shown
        .map(
          (item) =>
            `<a class="card" href="/media/${escapeHtml(item.imageId)}" target="_blank" rel="noopener"${item.note ? ` title="${escapeHtml(item.note)}"` : ''}><img src="/media/${escapeHtml(item.imageId)}" alt="${escapeHtml(item.note ?? '')}" loading="lazy"></a>`,
        )
        .join('');
      const empty = `<div class="empty">${escapeHtml(p.empty ?? 'Пока пусто')}</div>`;
      return `${label}<div class="gal" data-empty="${escapeHtml(p.empty ?? 'Пока пусто')}">${shown.length ? cards : empty}</div>`;
    }
    case 'list': {
      const items = Array.isArray(value) ? (value as string[]) : [];
      const list = items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
      const empty = `<li class="empty">${escapeHtml(p.empty ?? 'Пока пусто')}</li>`;
      return `${label}<ul class="items" data-empty="${escapeHtml(p.empty ?? 'Пока пусто')}">${items.length ? list : empty}</ul>`;
    }
    case 'status': {
      const status = (value ?? {}) as StatusValue;
      const state = status.state ?? 'idle';
      const text = status.text || STATUS_TEXT[state] || STATUS_TEXT.idle;
      return `<div class="badge state-${escapeHtml(state)}"><i class="dot"></i><span class="txt">${escapeHtml(text)}</span></div>`;
    }
    default:
      return '';
  }
}

function renderElement(el: Element, value: unknown, items: GalleryItem[]): string {
  const style = [
    `left:${el.x}px`,
    `top:${el.y}px`,
    `width:${el.w}px`,
    `height:${el.h}px`,
    el.hidden ? 'display:none' : '',
  ]
    .filter(Boolean)
    .join(';');

  return `<div class="el k-${el.kind} ${sizeClass(el)}" data-id="${escapeHtml(el.id)}" data-kind="${el.kind}"${eventAttr(el)} style="${style}">${renderInner(el, value, items)}</div>`;
}

export function renderPage(
  form: Form,
  values: Values,
  galleries: Record<string, GalleryItem[]>,
  footer = '',
): string {
  const width = form.canvas.width;
  const bottom = Math.max(...form.elements.map((el) => el.y + el.h), 320);
  const height = bottom + 40;

  const elements = form.elements
    .map((el) => renderElement(el, values[el.id], galleries[el.id] ?? []))
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(form.title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%234f8cff'/><rect x='7' y='10' width='18' height='4' rx='2' fill='white'/><rect x='7' y='18' width='12' height='4' rx='2' fill='white' opacity='.65'/></svg>">
<style>
${CSS}
</style>
</head>
<body>
<div class="wrap" data-page="${escapeHtml(form.slug)}">
  <header class="head">
    <span class="tag">page-studio</span>
    <h1>${escapeHtml(form.title)}</h1>
    ${form.lead ? `<p>${escapeHtml(form.lead)}</p>` : ''}
  </header>
  <div class="stage">
    <div class="canvas" style="width:${width}px;height:${height}px">
      ${elements}
    </div>
  </div>
  ${footer ? `<div class="foot">${escapeHtml(footer)}</div>` : ''}
</div>
<script>
${CLIENT}
</script>
</body>
</html>`;
}

export function renderIndex(items: Array<{ slug: string; title: string; lead?: string; elements: number }>): string {
  const cards = items
    .map(
      (item) => `<a class="page" href="/p/${escapeHtml(item.slug)}">
      <div class="slug">${escapeHtml(item.slug)}</div>
      <h2>${escapeHtml(item.title)}</h2>
      ${item.lead ? `<p>${escapeHtml(item.lead)}</p>` : ''}
      <div class="meta">${item.elements} элемент(ов)</div>
    </a>`,
    )
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>page-studio · страницы</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%234f8cff'/><rect x='7' y='10' width='18' height='4' rx='2' fill='white'/><rect x='7' y='18' width='12' height='4' rx='2' fill='white' opacity='.65'/></svg>">
<style>
${CSS}
.index { max-width: 960px; margin: 0 auto; padding: 48px 24px 64px; }
.index h1 { font-size: 26px; margin: 10px 0 4px; }
.index .sub { color: var(--muted); margin: 0 0 28px; }
.list { display: grid; gap: 14px; }
.page {
  display: block;
  text-decoration: none;
  color: inherit;
  background: var(--form);
  color: var(--ink);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  transition: transform 0.12s, box-shadow 0.12s;
}
.page:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
.page h2 { margin: 4px 0 6px; font-size: 18px; }
.page p { margin: 0 0 10px; color: #4b5563; font-size: 14px; }
.page .slug { font: 600 11px/1 ui-monospace, Consolas, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #4f8cff; }
.page .meta { font-size: 12px; color: #6b7280; }
.index .admin { margin-top: 28px; font-size: 13px; }
.index .admin a { color: var(--muted); }
</style>
</head>
<body>
<div class="index">
  <span class="tag">page-studio</span>
  <h1>Страницы</h1>
  <p class="sub">Портал-конструктор: элементы — это методы, обвязка — в бэкенде.</p>
  <div class="list">
    ${cards}
  </div>
  <div class="admin"><a href="/admin">админка — собрать страницу</a></div>
</div>
</body>
</html>`;
}

export function renderNotFound(): string {  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Нет такой страницы</title>
<style>body{background:#0e1116;color:#e6edf3;font:15px/1.5 "Segoe UI",system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
a{color:#4f8cff}</style></head><body><div><h1>404</h1><p>Такой формы нет. <a href="/">На главную</a></p></div></body></html>`;
}
