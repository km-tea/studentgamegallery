// 교사 전용: 앱 목록 / 업로드(검사·자동 보정) / 수정 / 승인·반려·숨김 / 삭제
// 인증: 관리자 계정으로 로그인한 쿠키 (로그인은 /api/auth/login)
import { getSql, json, getSettings } from './_lib/db.mjs';
import { requireUser } from './_lib/auth.mjs';
import { saveApp } from './_lib/appsave.mjs';

export const config = { path: ['/api/admin/apps', '/api/admin/apps/:id'] };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return json({ error: '잠시 후 다시 시도해 주세요' }, 500);
  }
};

const STATUSES = ['published', 'hidden', 'pending', 'rejected'];

export async function handle(req, context, getDb) {
  const db = await getDb();
  const { user, res } = await requireUser(req, db, 'admin');
  if (res) return res;
  const m = new URL(req.url).pathname.match(/\/api\/admin\/apps\/([^/]+)$/);
  const id = context?.params?.id || (m ? decodeURIComponent(m[1]) : null);

  if (req.method === 'GET') {
    const rows = await db`SELECT a.id, a.title, a.year, a.subject, a.kind, a.maker, a.description, a.pass_score, a.min_plays, a.unit,
      a.status, a.review_note, a.checks, a.owner, a.owner_id, u.username AS owner_username,
      octet_length(a.html) AS size, a.updated_at,
      (SELECT count(*)::int FROM comments c WHERE c.app_id = a.id) AS comment_count,
      (SELECT count(*)::int FROM comments c WHERE c.app_id = a.id AND c.kind = 'request' AND NOT c.resolved) AS open_requests
      FROM apps a LEFT JOIN users u ON u.id = a.owner_id ORDER BY (a.status = 'pending') DESC, a.created_at DESC`;
    return json(rows);
  }

  if (req.method === 'DELETE' && id) {
    await db`DELETE FROM comments WHERE app_id = ${id}`;
    await db`DELETE FROM apps WHERE id = ${id}`;
    return json({ ok: true });
  }

  let b;
  try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }

  if (req.method === 'PATCH' && id) {
    if (!STATUSES.includes(b.status)) return json({ error: '상태 값이 올바르지 않아요' }, 400);
    const note = b.status === 'rejected' ? String(b.note || '').trim().slice(0, 200) : '';
    await db`UPDATE apps SET status = ${b.status}, review_note = ${note}, updated_at = now() WHERE id = ${id}`;
    return json({ ok: true });
  }

  if (req.method !== 'POST') return json({ error: '지원하지 않는 요청이에요' }, 405);
  return saveApp({ db, body: b, user, settings: await getSettings(db) });
}
