// 비밀번호 해시 + 로그인 토큰(서명). 외부 패키지 없이 Node 내장 crypto만 사용한다.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = scryptSync(String(pw), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [alg, n, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(hash, 'base64');
    const got = scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: R, p: P });
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// 존재하지 않는 아이디로 로그인해도 같은 시간이 걸리게 하려고 쓰는 가짜 해시
export const DUMMY_HASH = hashPassword('dummy-password-for-timing');

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `v1.${body}.${sig}`;
}

export function verifyToken(token, secret) {
  try {
    const [v, body, sig] = String(token).split('.');
    if (v !== 'v1' || !body || !sig) return null;
    const want = createHmac('sha256', secret).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.e !== 'number' || p.e < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export const sha = (s) => createHash('sha256').update(String(s)).digest();
export const safeEqual = (a, b) => timingSafeEqual(sha(a), sha(b));
export const randomId = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;
// 일괄 가입 때 비밀번호를 비워 두면 서버가 만들어 주는 8자 임시 비밀번호 (헷갈리는 글자 제외)
export function randomPassword(len = 8) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(len), (x) => abc[x % abc.length]).join('');
}
// 헷갈리는 글자(0/O, 1/I)를 뺀 가입 코드
export function randomCode(len = 6) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(len);
  return Array.from(b, (x) => abc[x % abc.length]).join('');
}
