import type { CallLog } from './log.js';

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
