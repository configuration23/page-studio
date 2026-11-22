import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

export type Target = { name: string; url: string };

export const TARGET_NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;

function validUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Именованные адреса, куда уходят события. Живут отдельно от страниц:
 * страницу можно экспортировать, не выдавая адреса вебхуков.
 */
export class TargetStore {
  private readonly file: string;
  private items = new Map<string, string>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'targets.yaml');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = YAML.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown> | null;
      for (const [name, url] of Object.entries(parsed ?? {})) {
        if (TARGET_NAME_RE.test(name) && typeof url === 'string' && validUrl(url)) {
          this.items.set(name, url);
        }
      }
    } catch {
      // битый файл не должен ронять портал
    }
  }

  private save(): void {
    const plain: Record<string, string> = {};
    for (const [name, url] of this.items) plain[name] = url;
    try {
      writeFileSync(this.file, YAML.stringify(plain), 'utf8');
    } catch (err) {
      console.error('цели не сохранились:', (err as Error).message);
    }
  }

  list(): Target[] {
    return [...this.items.entries()].map(([name, url]) => ({ name, url }));
  }

  get(name: string): string | null {
    return this.items.get(name) ?? null;
  }

  set(name: string, url: string): void {
    if (!TARGET_NAME_RE.test(name)) throw new Error('имя цели: латиница, цифры, _ и -');
    const trimmed = url.trim();
    if (!validUrl(trimmed)) throw new Error('адрес цели должен быть http(s)://…');
    this.items.set(name, trimmed);
    this.save();
  }

  remove(name: string): boolean {
    const existed = this.items.delete(name);
    if (existed) this.save();
    return existed;
  }
}
