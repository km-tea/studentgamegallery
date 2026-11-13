// 계정: 가입 / 로그인 / 로그아웃 / 내 정보 / 비밀번호 변경 / 화면용 공개 설정
import { getSql, json, getSettings, subjectList } from './_lib/db.mjs';
import { hashPassword, verifyPassword, DUMMY_HASH, safeEqual, randomId } from './_lib/crypto.mjs';
import { sessionCookie, clearCookie, currentUser, publicUser, checkOrigin, cleanEmail } from './_lib/auth.mjs';

export const config = { path: '/api/auth/:action' };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return json({ error: '잠시 후 다시 시도해 주세요' }, 500);
  }
};

const MAX_FAILS = 5, LOCK_MIN = 5;

export async function handle(req, context, getDb) {
  const action = context?.params?.action || new URL(req.url).pathname.split('/').pop();
  const db = await getDb();

  if (req.method === 'GET') {
    if (action === 'me') {
      const u = await currentUser(req, db);
      return json({ user: u ? publicUser(u) : null });
    }
    if (action === 'config') {
      const s = await getSettings(db);
      const admins = await db`SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1`;
      return json({
        signupOpen: s.signup_open === '1',
        codeRequired: !!s.signup_code,
        subjects: subjectList(s),
        maxApps: parseInt(s.max_apps, 10) || 3,
        autoPublish: s.auto_publish === '1',
        needsSetup: !admins.length, // 관리자 계정이 아직 없음 (ADMIN_PASSWORD 미설정)
      });
    }
    return json({ error: '없는 주소예요' }, 404);
  }

  if (req.method !== 'POST') return json({ error: '지원하지 않는 요청이에요' }, 405);
  const bad = checkOrigin(req);
  if (bad) return bad;
  if (!(req.headers.get('content-type') || '').includes('application/json')) return json({ error: '요청 형식이 올바르지 않아요' }, 400);
  let b;
  try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }

  if (action === 'logout') return json({ ok: true }, 200, { 'set-cookie': clearCookie(req) });

  if (action === 'signup') {
    const s = await getSettings(db);
    if (s.signup_open !== '1') return json({ error: '지금은 새로 가입할 수 없어요. 선생님께 문의해 주세요' }, 403);
    if (s.signup_code && !safeEqual(String(b.code || '').trim().toUpperCase(), s.signup_code.toUpperCase()))
      return json({ error: '가입 코드가 맞지 않아요. 선생님께 받은 코드를 확인해 주세요' }, 403);

    const username = cleanEmail(b.username); // 이메일을 username 칸에 저장한다
    const nickname = String(b.nickname || '').trim().slice(0, 12);
    const password = String(b.password || '');
    if (!username) return json({ error: '이메일 주소를 올바르게 입력해 주세요 (예: name@gmail.com)' }, 400);
    if (!nickname) return json({ error: '별명을 입력해 주세요 (실명은 쓰지 마세요)' }, 400);
    if (password.length < 6 || password.length > 72) return json({ error: '비밀번호는 6자 이상으로 만들어 주세요' }, 400);

    const id = randomId('u');
    const r = await db`INSERT INTO users (id, username, nickname, pw_hash, role)
      VALUES (${id}, ${username}, ${nickname}, ${hashPassword(password)}, 'student')
      ON CONFLICT (username) DO NOTHING RETURNING id, token_version`;
    if (!r.length) return json({ error: '이미 가입된 이메일이에요. 로그인해 주세요' }, 409);
    const user = { id, username, nickname, role: 'student', token_version: r[0].token_version };
    return json({ ok: true, user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(req, user) });
  }

  if (action === 'login') {
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const rows = await db`SELECT id, username, nickname, role, status, pw_hash, token_version,
      (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users WHERE username = ${username}`;
    const u = rows[0];
    if (u && u.locked) return json({ error: `비밀번호를 여러 번 틀렸어요. ${LOCK_MIN}분 뒤에 다시 해 보세요` }, 429);
    const ok = verifyPassword(password, u ? u.pw_hash : DUMMY_HASH);
    if (!u || !ok) {
      if (u) {
        await db`UPDATE users x SET failed_count = n.nc,
            locked_until = CASE WHEN n.nc >= ${MAX_FAILS} THEN now() + ${`${LOCK_MIN} minutes`}::interval ELSE NULL END
          FROM (SELECT id, CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_count + 1 END AS nc
                FROM users WHERE id = ${u.id}) n WHERE x.id = n.id`;
      }
      return json({ error: '이메일 또는 비밀번호가 맞지 않아요' }, 401);
    }
    if (u.status !== 'active') return json({ error: '사용이 중지된 계정이에요. 선생님께 문의해 주세요' }, 403);
    await db`UPDATE users SET failed_count = 0, locked_until = NULL, last_login_at = now() WHERE id = ${u.id}`;
    return json({ ok: true, user: publicUser(u) }, 200, { 'set-cookie': sessionCookie(req, u) });
  }

  if (action === 'password') {
    const u = await currentUser(req, db);
    if (!u) return json({ error: '로그인이 필요해요' }, 401);
    const cur = (await db`SELECT pw_hash FROM users WHERE id = ${u.id}`)[0];
    if (!verifyPassword(String(b.current || ''), cur.pw_hash)) return json({ error: '지금 비밀번호가 맞지 않아요' }, 401);
    const pw = String(b.password || '');
    if (pw.length < 6 || pw.length > 72) return json({ error: '새 비밀번호는 6자 이상으로 만들어 주세요' }, 400);
    // token_version을 올리면 다른 기기에서 로그인된 상태가 모두 풀린다. 지금 기기는 새 쿠키를 받는다.
    const r = await db`UPDATE users SET pw_hash = ${hashPassword(pw)}, token_version = token_version + 1 WHERE id = ${u.id} RETURNING token_version`;
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(req, { ...u, token_version: r[0].token_version }) });
  }

  return json({ error: '없는 주소예요' }, 404);
}
