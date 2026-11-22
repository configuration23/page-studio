import { createHmac, timingSafeEqual } from 'node:crypto';

/** Сравнение без утечки длины по времени. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function sign(secret: string, expiry: string): string {
  return createHmac('sha256', secret).update(`admin:${expiry}`).digest('hex');
}

/** Токен сессии админки: «срок.подпись», без состояния на сервере. */
export function createSessionToken(secret: string, ttlSeconds = SESSION_TTL_SECONDS): string {
  const expiry = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  return `${expiry}.${sign(secret, expiry)}`;
}

export function verifySessionToken(secret: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiry = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const seconds = Number(expiry);
  if (!Number.isFinite(seconds) || seconds * 1000 < Date.now()) return false;
  return safeEqual(mac, sign(secret, expiry));
}

export function checkCredentials(
  givenUser: string,
  givenPassword: string,
  expectedUser: string,
  expectedPassword: string,
): boolean {
  return safeEqual(givenUser, expectedUser) && safeEqual(givenPassword, expectedPassword);
}
