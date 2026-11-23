import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

export type Settings = {
  /** Страница, которая открывается на входе в портал. Пусто — показываем список. */
  defaultPage?: string;
};

/** Настройки портала, которые не относятся к отдельной странице. */
export class SettingsStore {
  private readonly file: string;
  private data: Settings = {};

  constructor(dataDir: string, defaultPage?: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'settings.yaml');
    if (existsSync(this.file)) {
      try {
        const parsed = YAML.parse(readFileSync(this.file, 'utf8')) as Settings | null;
        if (parsed && typeof parsed === 'object') this.data = parsed;
      } catch {
        this.data = {};
      }
    }
    // если файла ещё нет, стартовое значение можно задать снаружи
    if (!existsSync(this.file) && defaultPage) {
      this.data.defaultPage = defaultPage;
      this.save();
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file, YAML.stringify(this.data), 'utf8');
    } catch (err) {
      console.error('настройки не сохранились:', (err as Error).message);
    }
  }

  get(): Settings {
    return { ...this.data };
  }

  setDefaultPage(slug: string): void {
    if (slug) this.data.defaultPage = slug;
    else delete this.data.defaultPage;
    this.save();
  }
}
