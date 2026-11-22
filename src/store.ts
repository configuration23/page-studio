import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export type ImageRecord = {
  id: string;
  file: string;
  contentType: string;
  bytes: number;
  createdAt: string;
  page?: string;
  element?: string;
  sid?: string;
  note?: string;
};

export type SaveImage = {
  bytes: Buffer;
  contentType: string;
  page?: string;
  element?: string;
  sid?: string;
  note?: string;
};

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export const IMAGE_ID_RE = /^[a-z0-9]{6,20}$/;

/**
 * Картинки, которые бэкенд положил в портал. Байты лежат на диске, метаданные —
 * в index.jsonl: галерея переживает перезапуск и не зависит от хоста Comfy.
 */
export class ImageStore {
  private readonly dir: string;
  private readonly indexFile: string;
  private cache: ImageRecord[] | null = null;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'generations');
    this.indexFile = join(this.dir, 'index.jsonl');
    mkdirSync(this.dir, { recursive: true });
  }

  save(input: SaveImage): ImageRecord {
    const id = Date.now().toString(36) + randomBytes(2).toString('hex');
    const ext = EXT[input.contentType] ?? 'bin';
    const file = `${id}.${ext}`;
    writeFileSync(join(this.dir, file), input.bytes);

    const record: ImageRecord = {
      id,
      file,
      contentType: input.contentType,
      bytes: input.bytes.length,
      createdAt: new Date().toISOString(),
      page: input.page,
      element: input.element,
      sid: input.sid,
      note: input.note?.slice(0, 300),
    };
    appendFileSync(this.indexFile, JSON.stringify(record) + '\n', 'utf8');
    this.cache = null;
    return record;
  }

  list(limit = 24, page?: string): ImageRecord[] {
    if (this.cache === null) {
      this.cache = [];
      if (existsSync(this.indexFile)) {
        for (const line of readFileSync(this.indexFile, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            this.cache.push(JSON.parse(line) as ImageRecord);
          } catch {
            // оборванная строка — пропускаем, остальное живо
          }
        }
      }
    }
    const filtered = page ? this.cache.filter((r) => r.page === page) : this.cache;
    return filtered.slice(-limit).reverse();
  }

  get(id: string): ImageRecord | null {
    if (!IMAGE_ID_RE.test(id)) return null;
    return this.list(10_000).find((r) => r.id === id) ?? null;
  }

  pathOf(record: ImageRecord): string {
    return join(this.dir, record.file);
  }

  /** Значение для элемента галереи: то, что видит браузер и бэкенд. */
  toGallery(page: string, limit = 24): Array<{ imageId: string; note?: string; createdAt: string }> {
    return this.list(limit, page).map((r) => ({
      imageId: r.id,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }
}
