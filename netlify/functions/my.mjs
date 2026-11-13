// 학생(로그인한 본인) 전용: 내가 올린 앱 목록 / 올리기·수정 / 삭제
import { getSql, json, getSettings } from './_lib/db.mjs';
import { requireUser } from './_lib/auth.mjs';
import { saveApp } from './_lib/appsave.mjs';

export const config = { path: ['/api/my/apps', '/api/my/apps/:id'] };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return json({ error: '잠시 후 다시 시도해 주세요' }, 500);
  }
};

export async function handle(req, context, getDb) {
  const db = await getDb();
  const { user, res } = await requireUser(req, db);
  if (res) return res;
  const m = new URL(req.url).pathname.match(/\/api\/my\/apps\/([^/]+)$/);
  const id = context?.params?.id || (m ? decodeURIComponent(m[1]) : null);

  if (req.method === 'GET') {
    const rows = await db`SELECT id, title, year, subject, description, pass_score, min_plays, unit, status, review_note, checks,
      octet_length(html) AS size, updated_at FROM apps WHERE owner_id = ${user.id} ORDER BY created_at DESC`;
    return json(rows);
  }

  if (req.method === 'DELETE' && id) {
    await db`DELETE FROM apps WHERE id = ${id} AND owner_id = ${user.id}`;
    return json({ ok: true });
  }

  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
    return saveApp({ db, body: b, user, settings: await getSettings(db) });
  }
  return json({ error: '지원하지 않는 요청이에요' }, 405);
}
