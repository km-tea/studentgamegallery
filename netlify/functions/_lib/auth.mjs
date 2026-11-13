// 로그인 확인(세션) 도우미: 쿠키에서 토큰을 읽고 DB의 계정 상태와 맞춰 본다
import { signToken, verifyToken } from './crypto.mjs';
import { env, json } from './db.mjs';
import { createHash } from 'node:crypto';

const COOKIE = 'gallery_session';
const DAYS = 7;

function secret() {
  const s = env('SESSION_SECRET');
  if (s) return s;
  // SESSION_SECRET을 따로 안 정했으면 DATABASE_URL(비밀 값)에서 만든다
  return createHash('sha256').update('gallery-session:' + (env('DATABASE_URL') || 'dev')).digest('hex');
}

function readCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  for (const part of c.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const secure = (req) => new URL(req.url).protocol === 'https:';

export function sessionCookie(req, user) {
  const token = signToken({ u: user.id, v: user.token_version, e: Math.floor(Date.now() / 1000) + DAYS * 86400 }, secret());
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure(req) ? '; Secure' : ''}`;
}

export function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`;
}

// 로그인한 사용자를 돌려준다. 로그인 안 했거나 막힌 계정이면 null
export async function currentUser(req, db) {
  const p = verifyToken(readCookie(req, COOKIE) || '', secret());
  if (!p) return null;
  const rows = await db`SELECT id, username, nickname, role, status, token_version FROM users WHERE id = ${p.u}`;
  const u = rows[0];
  if (!u || u.status !== 'active' || u.token_version !== p.v) return null;
  return u;
}

export const publicUser = (u) => ({ id: u.id, username: u.username, nickname: u.nickname, role: u.role });

// 로그인 필요(role을 주면 그 역할만 허용). 통과하면 { user }, 아니면 { res } 를 돌려준다.
export async function requireUser(req, db, role) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe) {
    // 다른 사이트에서 몰래 보낸 요청(CSRF) 막기: Origin이 있으면 같은 주소여야 하고, JSON 형식만 받는다
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(req.url).host) return { res: json({ error: '허용되지 않은 요청이에요' }, 403) };
    const ct = req.headers.get('content-type') || '';
    if (req.method !== 'DELETE' && !ct.includes('application/json')) return { res: json({ error: '요청 형식이 올바르지 않아요' }, 400) };
    if (req.method === 'DELETE' && !req.headers.get('x-requested-with')) return { res: json({ error: '요청 형식이 올바르지 않아요' }, 400) };
  }
  const user = await currentUser(req, db);
  if (!user) return { res: json({ error: '로그인이 필요해요' }, 401) };
  if (role && user.role !== role) return { res: json({ error: '권한이 없어요' }, 403) };
  return { user };
}

export function checkOrigin(req) {
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(req.url).host) return json({ error: '허용되지 않은 요청이에요' }, 403);
  return null;
}
