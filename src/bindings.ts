import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import type { CallLog } from './log.js';

export type Binding = { on: string; url: string };

/** Ключ привязки: "<slug>/<event>/<id>". URL вебхука живёт здесь, не в форме. */
export function bindingKey(slug: string, event: string, id: string): string {
  return `${slug}/${event}/${id}`;
}

export function loadBindings(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(file)) return map;
  const parsed = YAML.parse(readFileSync(file, 'utf8')) as Binding[] | null;
  for (const item of parsed ?? []) {
    if (!item?.on || !item?.url) continue;
    map.set(item.on, item.url);
  }
  return map;
}

export type PushResult = { ok: boolean; status?: number; ms: number; note?: string };

/**
 * Fire-and-forget: портал не ждёт бэкенд и не зависит от его ответа.
 * Три попытки, таймаут 3 с каждая, итог — в журнал.
 */
export async function pushEvent(
  url: string,
  payload: unknown,
  log: CallLog,
  meta: { page: string; name: string; sid: string },
): Promise<PushResult> {
  const started = Date.now();
  let note: string | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
      const ms = Date.now() - started;
      const ok = res.ok;
      note = ok ? undefined : `HTTP ${res.status}`;
      if (ok || res.status < 500) {
        log.add({ kind: 'push', page: meta.page, name: meta.name, sid: meta.sid, ok, note, ms });
        return { ok, status: res.status, ms, note };
      }
      note = `HTTP ${res.status}`;
    } catch (err) {
      note = (err as Error).message;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
  }

  const ms = Date.now() - started;
  log.add({ kind: 'push', page: meta.page, name: meta.name, sid: meta.sid, ok: false, note, ms });
  return { ok: false, ms, note };
}
