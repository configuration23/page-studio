import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type TokenRecord = {
  id: string;
  name: string;
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type PublicToken = Omit<TokenRecord, 'hash'>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * API-токены админки: в файле лежат только хеши, сам токен показывается один раз.
 * Ими ходят скрипты и автоматизация; человек входит по форме.
 */
export class TokenStore {
  private readonly file: string;
  private items: TokenRecord[] = [];

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'api-tokens.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (Array.isArray(parsed)) this.items = parsed as TokenRecord[];
    } catch {
      // битый файл не должен ронять портал
      this.items = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8');
    } catch (err) {
      console.error('токены не сохранились:', (err as Error).message);
    }
  }

  list(): PublicToken[] {
    return this.items.map(({ hash: _hash, ...rest }) => rest);
  }

  create(name: string): { token: string; record: PublicToken } {
    const token = `ps_${randomBytes(24).toString('base64url')}`;
    const record: TokenRecord = {
      id: `tk_${randomBytes(4).toString('hex')}`,
      name: name.slice(0, 60),
      hash: hashToken(token),
      createdAt: new Date().toISOString(),
    };
    this.items.push(record);
    this.save();
    const { hash: _hash, ...rest } = record;
    return { token, record: rest };
  }

  revoke(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  /** Проверка предъявленного токена; отметку «использован» пишем не чаще раза в минуту. */
  verify(token: string): TokenRecord | null {
    if (!token) return null;
    const hash = hashToken(token);
    const found = this.items.find((item) => sameHash(item.hash, hash));
    if (!found) return null;
    const now = Date.now();
    const last = found.lastUsedAt ? Date.parse(found.lastUsedAt) : 0;
    if (!Number.isFinite(last) || now - last > 60_000) {
      found.lastUsedAt = new Date(now).toISOString();
      this.save();
    }
    return found;
  }
}
