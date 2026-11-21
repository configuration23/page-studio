import { existsSync, readFileSync } from 'node:fs';

/** Минимальный загрузчик .env: без зависимостей, не перетирает уже заданные переменные. */
function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

export type Config = {
  port: number;
  host: string;
  dataDir: string;
  formsDir: string;
  token: string;
  maxImageBytes: number;
  publicUrl: string;
};

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export function loadConfig(): Config {
  const token = (process.env.PORTAL_TOKEN ?? '').trim();
  if (!token) throw new Error('PORTAL_TOKEN не задан: без него n8n не сможет писать значения');
  const port = int(process.env.PORT, 3000);
  return {
    port,
    host: process.env.HOST ?? '127.0.0.1',
    dataDir: process.env.DATA_DIR ?? 'data',
    formsDir: process.env.FORMS_DIR ?? 'data/forms',
    token,
    maxImageBytes: int(process.env.MAX_IMAGE_BYTES, 20 * 1024 * 1024),
    publicUrl: process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`,
  };
}
