// 교사 전용: 학생 계정 관리(목록·직접 만들기·비밀번호 초기화·사용 중지·삭제) + 갤러리 설정
import { getSql, json, getSettings, SETTING_DEFAULTS } from './_lib/db.mjs';
import { requireUser } from './_lib/auth.mjs';
import { hashPassword, randomId } from './_lib/crypto.mjs';

export const config = { path: ['/api/admin/users', '/api/admin/users/:id', '/api/admin/settings'] };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return json({ error: '잠시 후 다시 시도해 주세요' }, 500);
  }
};

const USERNAME = /^[a-z0-9_]{3,20}$/;

function cleanSettings(b) {
  const out = {};
  const bool = (v) => (v === true || v === '1' || v === 1 ? '1' : '0');
  if ('signup_open' in b) out.signup_open = bool(b.signup_open);
  if ('auto_publish' in b) out.auto_publish = bool(b.auto_publish);
  if ('signup_code' in b) out.signup_code = String(b.signup_code ?? '').trim().toUpperCase().slice(0, 20);
  if ('max_apps' in b) {
    const n = parseInt(b.max_apps, 10);
    if (!(n >= 1 && n <= 50)) return { error: '앱 개수 제한은 1~50 사이로 정해 주세요' };
    out.max_apps = String(n);
  }
  if ('subjects' in b) {
    const list = String(b.subjects || '').split(',').map((x) => x.trim().slice(0, 20)).filter(Boolean);
    if (!list.length || list.length > 20) return { error: '주제는 1~20개를 쉼표(,)로 구분해서 적어 주세요' };
    out.subjects = [...new Set(list)].join(',');
  }
  return out;
}

export async function handle(req, context, getDb) {
  const db = await getDb();
  const { res } = await requireUser(req, db, 'admin');
  if (res) return res;
  const url = new URL(req.url);

  // ---- 설정 ----
  if (url.pathname.endsWith('/api/admin/settings')) {
    if (req.method === 'GET') return json(await getSettings(db));
    if (req.method !== 'PUT') return json({ error: '지원하지 않는 요청이에요' }, 405);
    let b;
    try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
    const s = cleanSettings(b);
    if (s.error) return json({ error: s.error }, 400);
    for (const [k, v] of Object.entries(s)) {
      if (!(k in SETTING_DEFAULTS)) continue;
      await db`INSERT INTO settings (key, value) VALUES (${k}, ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    }
    return json(await getSettings(db));
  }

  // ---- 계정 ----
  const m = url.pathname.match(/\/api\/admin\/users\/([^/]+)$/);
  const id = context?.params?.id || (m ? decodeURIComponent(m[1]) : null);

  if (req.method === 'GET') {
    const rows = await db`SELECT u.id, u.username, u.nickname, u.role, u.status, u.created_at, u.last_login_at,
      (SELECT count(*)::int FROM apps a WHERE a.owner_id = u.id) AS app_count
      FROM users u ORDER BY (u.role = 'admin') DESC, u.created_at DESC`;
    return json(rows);
  }

  if (req.method === 'POST' && !id) {
    let b;
    try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
    const username = String(b.username || '').trim().toLowerCase();
    const nickname = String(b.nickname || '').trim().slice(0, 12);
    const password = String(b.password || '');
    if (!USERNAME.test(username)) return json({ error: '아이디는 영어 소문자·숫자·밑줄(_)로 3~20자로 만들어 주세요' }, 400);
    if (!nickname) return json({ error: '별명을 입력해 주세요' }, 400);
    if (password.length < 6 || password.length > 72) return json({ error: '비밀번호는 6자 이상으로 만들어 주세요' }, 400);
    const r = await db`INSERT INTO users (id, username, nickname, pw_hash, role)
      VALUES (${randomId('u')}, ${username}, ${nickname}, ${hashPassword(password)}, 'student')
      ON CONFLICT (username) DO NOTHING RETURNING id`;
    if (!r.length) return json({ error: '이미 있는 아이디예요' }, 409);
    return json({ ok: true, id: r[0].id });
  }

  if (!id) return json({ error: '지원하지 않는 요청이에요' }, 405);
  const target = (await db`SELECT id, role FROM users WHERE id = ${id}`)[0];
  if (!target) return json({ error: '계정을 찾지 못했어요' }, 404);
  if (target.role === 'admin') return json({ error: '관리자 계정은 여기서 바꿀 수 없어요' }, 403);

  if (req.method === 'DELETE') {
    // 기본: 앱은 남기고(교사 소유로) 계정만 삭제. ?apps=delete 면 앱도 함께 삭제
    if (url.searchParams.get('apps') === 'delete') await db`DELETE FROM apps WHERE owner_id = ${id}`;
    else await db`UPDATE apps SET owner_id = NULL, owner = 'teacher' WHERE owner_id = ${id}`;
    await db`DELETE FROM users WHERE id = ${id}`;
    return json({ ok: true });
  }

  if (req.method === 'PATCH') {
    let b;
    try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
    if ('password' in b) {
      const pw = String(b.password || '');
      if (pw.length < 6 || pw.length > 72) return json({ error: '비밀번호는 6자 이상으로 정해 주세요' }, 400);
      // token_version을 올려서 이미 로그인해 둔 기기는 모두 로그아웃시킨다
      await db`UPDATE users SET pw_hash = ${hashPassword(pw)}, token_version = token_version + 1, failed_count = 0, locked_until = NULL WHERE id = ${id}`;
      return json({ ok: true });
    }
    if ('status' in b) {
      if (!['active', 'disabled'].includes(b.status)) return json({ error: '상태 값이 올바르지 않아요' }, 400);
      await db`UPDATE users SET status = ${b.status}, token_version = token_version + 1 WHERE id = ${id}`;
      return json({ ok: true });
    }
    return json({ error: '바꿀 내용이 없어요' }, 400);
  }
  return json({ error: '지원하지 않는 요청이에요' }, 405);
}
