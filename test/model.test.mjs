import test from 'node:test';
import assert from 'node:assert/strict';
import { formSchema, methodsOf, resolveElement } from '../dist/model.js';

const base = { slug: 'gen', title: 'Тест', canvas: { width: 960 } };

function parse(elements) {
  const form = formSchema.parse({ ...base, elements });
  return form;
}

test('методы выводятся из раскладки, отдельно их никто не заводит', () => {
  const form = parse([
    { id: 'prompt', kind: 'memo', x: 0, y: 0, w: 300, h: 80 },
    { id: 'push', kind: 'button', x: 0, y: 100, w: 200, h: 40 },
    { id: 'image', kind: 'image', x: 0, y: 200, w: 300, h: 300 },
    { id: 'gallery', kind: 'gallery', x: 320, y: 200, w: 300, h: 300 },
  ]);
  const names = methodsOf(form)
    .map((m) => m.name)
    .sort();
  assert.deepEqual(names, [
    'gen.gallery',
    'gen.image',
    'gen.on_change_prompt',
    'gen.on_click_push',
    'gen.post_gallery',
    'gen.post_image',
    'gen.post_prompt',
    'gen.prompt',
  ]);
});

test('label и button не получают методов значения', () => {
  const form = parse([
    { id: 'title', kind: 'label', x: 0, y: 0, w: 400, h: 40 },
    { id: 'go', kind: 'button', x: 0, y: 60, w: 200, h: 40 },
  ]);
  const names = methodsOf(form).map((m) => m.name);
  assert.deepEqual(names, ['gen.on_click_go']);
});

test('повтор id запрещён: имя элемента — это имя метода', () => {
  assert.throws(
    () =>
      parse([
        { id: 'prompt', kind: 'edit', x: 0, y: 0, w: 200, h: 40 },
        { id: 'prompt', kind: 'memo', x: 0, y: 60, w: 200, h: 80 },
      ]),
    /уже занят/,
  );
});

test('элемент не выходит за канвас', () => {
  assert.throws(
    () => parse([{ id: 'wide', kind: 'edit', x: 800, y: 0, w: 300, h: 40 }]),
    /выходит за канвас/,
  );
});

test('combo без вариантов не проходит схему', () => {
  assert.throws(
    () => parse([{ id: 'pick', kind: 'combo', x: 0, y: 0, w: 200, h: 40 }]),
    /options/,
  );
});

test('id должен быть пригоден для имени метода', () => {
  assert.throws(() => parse([{ id: 'Промпт', kind: 'edit', x: 0, y: 0, w: 200, h: 40 }]));
});

test('алиас ведёт к текущему элементу', () => {
  const form = formSchema.parse({
    ...base,
    elements: [{ id: 'text', kind: 'memo', x: 0, y: 0, w: 200, h: 40 }],
    aliases: { prompt: 'text' },
  });
  assert.equal(resolveElement(form, 'text')?.id, 'text');
  assert.equal(resolveElement(form, 'prompt')?.id, 'text');
  assert.equal(resolveElement(form, 'nope'), undefined);
});

test('алиас на несуществующий элемент не проходит схему', () => {
  assert.throws(
    () =>
      formSchema.parse({
        ...base,
        elements: [{ id: 'text', kind: 'memo', x: 0, y: 0, w: 200, h: 40 }],
        aliases: { prompt: 'nope' },
      }),
    /несуществующ/,
  );
});

test('алиас не может совпадать с именем элемента', () => {
  assert.throws(
    () =>
      formSchema.parse({
        ...base,
        elements: [{ id: 'prompt', kind: 'memo', x: 0, y: 0, w: 200, h: 40 }],
        aliases: { prompt: 'prompt' },
      }),
    /совпадает/,
  );
});
