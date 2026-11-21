import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import YAML from 'yaml';
import { formSchema, type Form } from './model.js';

function parseForm(file: string): Form {
  const raw = readFileSync(file, 'utf8');
  let data: unknown;
  try {
    data = YAML.parse(raw);
  } catch (err) {
    throw new Error(`${basename(file)}: YAML не разобрался — ${(err as Error).message}`);
  }
  const parsed = formSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${basename(file)}: форма не прошла схему\n${issues}`);
  }
  if (parsed.data.slug !== basename(file).replace(/\.ya?ml$/, '')) {
    throw new Error(`${basename(file)}: slug «${parsed.data.slug}» не совпадает с именем файла`);
  }
  return parsed.data;
}

export function loadForms(dir: string): Map<string, Form> {
  const forms = new Map<string, Form>();
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  if (files.length === 0) throw new Error(`В ${dir} нет ни одной формы`);
  for (const file of files) {
    const form = parseForm(join(dir, file));
    forms.set(form.slug, form);
  }
  return forms;
}
