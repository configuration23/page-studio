import test from 'node:test';
import assert from 'node:assert/strict';
import { formSchema } from '../dist/model.js';
import { escapeHtml, renderPage } from '../dist/render.js';

const form = formSchema.parse({
  slug: 'gen',
  title: 'Тест <b>',
  lead: 'Описание',
  elements: [
    { id: 'prompt', kind: 'memo', x: 10, y: 20, w: 300, h: 80, label: 'Промпт' },
    { id: 'push', kind: 'button', x: 320, y: 20, w: 200, h: 40, label: 'Пуск' },
    {
      id: 'pick',
      kind: 'combo',
      x: 10,
      y: 120,
      w: 200,
      h: 40,
      props: { options: ['акварель', 'неон'] },
    },
    { id: 'shot', kind: 'image', x: 10, y: 180, w: 300, h: 300 },
    { id: 'gal', kind: 'gallery', x: 320, y: 180, w: 300, h: 300, props: { limit: 3 } },
    { id: 'badge', kind: 'status', x: 320, y: 120, w: 200, h: 40 },
  ],
});

test('экранирование: разметка в значениях не исполняется', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const html = renderPage(form, { prompt: '<img onerror=1>', pick: 'неон' }, {}, '');
  assert.ok(!html.includes('<img onerror=1>'));
  assert.ok(html.includes('&lt;img onerror=1&gt;'));
});

test('страница содержит координаты и элементы с id', () => {
  const html = renderPage(form, {}, {}, '');
  assert.ok(html.includes('data-page="gen"'));
  assert.ok(html.includes('data-id="prompt"'));
  assert.ok(html.includes('left:10px;top:20px;width:300px;height:80px'));
  assert.ok(html.includes('width:960px'));
});

test('выбранный вариант combo помечен', () => {
  const html = renderPage(form, { pick: 'неон' }, {}, '');
  assert.ok(html.includes('<option value="неон" selected>'));
});

test('пустая галерея показывает текст из props', () => {
  const html = renderPage(form, {}, {}, '');
  assert.ok(html.includes('data-empty="Пока пусто"'));
});

test('статус рендерится классом состояния', () => {
  const html = renderPage(form, { badge: { state: 'running', text: 'рисует' } }, {}, '');
  assert.ok(html.includes('badge state-running'));
  assert.ok(html.includes('рисует'));
});
