import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Сравнение без утечки длины по времени. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Идентификатор сессии — им же отзываем ровно одну сессию при выходе. */
export function newSessionId(): string {
  return randomBytes(8).toString('hex');
}

export function isSessionId(value: string): boolean {
  return /^[a-f0-9]{16}$/.test(value);
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`admin:${payload}`).digest('hex');
}

/** Токен сессии: «срок.идентификатор.подпись». Живёт в куке. */
export function createSessionToken(
  secret: string,
  sessionId: string,
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  const expiry = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  return `${expiry}.${sessionId}.${sign(secret, `${expiry}:${sessionId}`)}`;
}

export function sessionIdFromToken(token: string | null | undefined): string | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const id = parts[1] ?? '';
  return isSessionId(id) ? id : null;
}

export function verifySessionToken(
  secret: string,
  token: string | null | undefined,
  isActive: (sessionId: string) => boolean,
): boolean {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return false;
  const [expiry, sessionId, mac] = parts as [string, string, string];
  const seconds = Number(expiry);
  if (!Number.isFinite(seconds) || seconds * 1000 < Date.now()) return false;
  if (!isActive(sessionId)) return false;
  return safeEqual(mac, sign(secret, `${expiry}:${sessionId}`));
}

export function checkCredentials(
  givenUser: string,
  givenPassword: string,
  expectedUser: string,
  expectedPassword: string,
): boolean {
  return safeEqual(givenUser, expectedUser) && safeEqual(givenPassword, expectedPassword);
}
