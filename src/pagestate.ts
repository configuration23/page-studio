import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PAGE_STATES = ['idle', 'queued', 'running', 'done', 'failed'] as const;
export type PageStateName = (typeof PAGE_STATES)[number];

export type PageState = {
  state: PageStateName;
  text?: string;
  ts?: string;
};

/**
 * Состояние страницы целиком — одно на всех, без привязки к посетителю.
 * Нужно, чтобы список страниц показывал «работает / лежит» ещё до открытия.
 */
export class PageStateStore {
  private readonly file: string;
  private data: Record<string, PageState> = {};

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'page-state.json');
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, PageState>;
        if (parsed && typeof parsed === 'object') this.data = parsed;
      } catch {
        this.data = {};
      }
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('состояние страниц не сохранилось:', (err as Error).message);
    }
  }

  get(slug: string): PageState {
    return this.data[slug] ?? { state: 'idle' };
  }

  set(slug: string, state: PageStateName, text?: string): PageState {
    const next: PageState = { state, ts: new Date().toISOString() };
    if (text) next.text = text.slice(0, 200);
    this.data[slug] = next;
    this.save();
    return next;
  }

  remove(slug: string): void {
    if (!this.data[slug]) return;
    delete this.data[slug];
    this.save();
  }
}
