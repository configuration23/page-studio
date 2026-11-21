import { z } from 'zod';

/** Виды элементов. Имя элемента = имя метода, см. docs/ARCHITECTURE.md §2. */
export const KINDS = [
  'label',
  'edit',
  'memo',
  'combo',
  'check',
  'button',
  'image',
  'gallery',
  'status',
] as const;

export type Kind = (typeof KINDS)[number];

/** Какие виды отдают и принимают значение. */
export const VALUE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'edit',
  'memo',
  'combo',
  'check',
  'image',
  'gallery',
  'status',
]);

export const EVENTS_OF: Partial<Record<Kind, readonly string[]>> = {
  edit: ['on_change'],
  memo: ['on_change'],
  combo: ['on_change'],
  check: ['on_change'],
  button: ['on_click'],
};

export const propsSchema = z.object({
  text: z.string().max(2000).optional(),
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
  placeholder: z.string().max(200).optional(),
  value: z.string().max(2000).optional(),
  options: z.array(z.string().min(1).max(80)).min(1).max(50).optional(),
  primary: z.boolean().optional(),
  max: z.number().int().positive().max(10000).optional(),
  hint: z.string().max(300).optional(),
  limit: z.number().int().positive().max(100).optional(),
  empty: z.string().max(200).optional(),
});

export type ElementProps = z.infer<typeof propsSchema>;

export const elementSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,30}$/, 'id: латиница, цифры и _, начинается с буквы'),
  kind: z.enum(KINDS),
  x: z.number().int().min(0).max(4000),
  y: z.number().int().min(0).max(8000),
  w: z.number().int().min(40).max(4000),
  h: z.number().int().min(20).max(2000),
  label: z.string().max(120).optional(),
  hidden: z.boolean().default(false),
  props: propsSchema.default({}),
});

export type Element = z.infer<typeof elementSchema>;

export const formSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'slug: латиница, цифры, дефис'),
    title: z.string().min(1).max(120),
    lead: z.string().max(600).optional(),
    canvas: z
      .object({ width: z.number().int().min(320).max(1920).default(960) })
      .default({ width: 960 }),
    elements: z.array(elementSchema).min(1).max(40),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<string>();
    for (const [i, el] of form.elements.entries()) {
      if (seen.has(el.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['elements', i, 'id'],
          message: `id «${el.id}» уже занят: имя элемента — это имя метода`,
        });
      }
      seen.add(el.id);
      if (el.x + el.w > form.canvas.width) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['elements', i],
          message: `«${el.id}» выходит за канвас: ${el.x}+${el.w} > ${form.canvas.width}`,
        });
      }
      if (el.kind === 'combo' && !el.props.options) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['elements', i, 'props', 'options'],
          message: 'combo без options нечего показывать',
        });
      }
    }
  });

export type Form = z.infer<typeof formSchema>;

export type MethodKind = 'get' | 'post' | 'event';

export type Method = {
  name: string;
  kind: MethodKind;
  elementId: string;
  elementKind: Kind;
  event?: string;
};

/** Методы выводятся из раскладки: отдельно их никто не заводит. */
export function methodsOf(form: Form): Method[] {
  const out: Method[] = [];
  for (const el of form.elements) {
    const base = `${form.slug}.${el.id}`;
    if (VALUE_KINDS.has(el.kind)) {
      out.push({ name: base, kind: 'get', elementId: el.id, elementKind: el.kind });
      out.push({ name: `${form.slug}.post_${el.id}`, kind: 'post', elementId: el.id, elementKind: el.kind });
    }
    for (const event of EVENTS_OF[el.kind] ?? []) {
      out.push({
        name: `${form.slug}.${event}_${el.id}`,
        kind: 'event',
        elementId: el.id,
        elementKind: el.kind,
        event,
      });
    }
  }
  return out;
}

export function elementById(form: Form, id: string): Element | undefined {
  return form.elements.find((el) => el.id === id);
}
