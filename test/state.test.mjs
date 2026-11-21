import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formSchema } from '../dist/model.js';
import { StateStore } from '../dist/state.js';

const form = formSchema.parse({
  slug: 'gen',
  title: 'Тест',
  elements: [
    { id: 'prompt', kind: 'memo', x: 0, y: 0, w: 300, h: 80, props: { value: 'старт' } },
    { id: 'done', kind: 'check', x: 0, y: 100, w: 200, h: 40 },
    { id: 'status', kind: 'status', x: 0, y: 160, w: 200, h: 40 },
  ],
});

test('начальные значения берутся из формы', () => {
  const store = new StateStore(mkdtempSync(join(tmpdir(), 'ps-')));
  const values = store.values(form, 'sid00001');
  assert.equal(values.prompt, 'старт');
  assert.equal(values.done, false);
  assert.deepEqual(values.status, { state: 'idle', text: '' });
});

test('запись и подписка: изменение уходит слушателю', () => {
  const store = new StateStore(mkdtempSync(join(tmpdir(), 'ps-')));
  const received = [];
  const off = store.subscribe('gen', 'sid00001', (change) => received.push(change));
  store.set(form, 'sid00001', 'prompt', 'два');
  store.set(form, 'sid00001', 'done', true);
  off();
  store.set(form, 'sid00001', 'prompt', 'три');
  assert.equal(received.length, 2);
  assert.equal(received[0].id, 'prompt');
  assert.equal(received[1].value, true);
});

test('сессии не видят значения друг друга', () => {
  const store = new StateStore(mkdtempSync(join(tmpdir(), 'ps-')));
  store.set(form, 'sid00001', 'prompt', 'первый');
  assert.equal(store.get(form, 'sid00002', 'prompt'), 'старт');
});

test('состояние переживает перезапуск', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-'));
  const first = new StateStore(dir);
  first.set(form, 'sid00001', 'prompt', 'сохранился');

  const second = new StateStore(dir);
  assert.equal(second.get(form, 'sid00001', 'prompt'), 'сохранился');
});

test('неизвестное значение не записать', () => {
  const store = new StateStore(mkdtempSync(join(tmpdir(), 'ps-')));
  assert.throws(() => store.set(form, 'sid00001', 'нет_такого', 1), /нет значения/);
});

test('новый элемент появляется у старой сессии, удалённый — исчезает', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-'));
  const before = formSchema.parse({
    slug: 'gen',
    title: 'Тест',
    elements: [{ id: 'prompt', kind: 'memo', x: 0, y: 0, w: 300, h: 80 }],
  });
  const first = new StateStore(dir);
  first.set(before, 'sid00001', 'prompt', 'старое');

  const after = formSchema.parse({
    slug: 'gen',
    title: 'Тест',
    elements: [
      { id: 'prompt', kind: 'memo', x: 0, y: 0, w: 300, h: 80 },
      { id: 'trace', kind: 'list', x: 0, y: 100, w: 300, h: 120 },
    ],
  });
  const second = new StateStore(dir);
  const values = second.values(after, 'sid00001');
  assert.equal(values.prompt, 'старое');
  assert.deepEqual(values.trace, []);
  second.set(after, 'sid00001', 'trace', ['строка']);
});
