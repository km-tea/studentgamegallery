// 공개 목록: 갤러리 화면이 읽어 가는 앱 목록 (HTML 본문은 포함하지 않음)
//  /api/apps      → 공개된 앱 전체
//  /api/apps/:id  → 앱 1개 (공개된 앱이거나, 올린 본인·교사가 미리 볼 때)
import { getSql, json } from './_lib/db.mjs';
import { currentUser } from './_lib/auth.mjs';

export const config = { path: ['/api/apps', '/api/apps/:id'] };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return json({ error: '목록을 불러오지 못했어요' }, 500);
  }
};

const shape = (r) => ({
  id: r.id, title: r.title, year: r.year, subject: r.subject, maker: r.maker, description: r.description,
  ...(r.pass_score ? { scoring: { pass: r.pass_score, minPlays: r.min_plays, unit: r.unit } } : {}),
});

export async function handle(req, context, getDb) {
  if (req.method !== 'GET') return json({ error: 'GET만 가능해요' }, 405);
  const db = await getDb();
  const m = new URL(req.url).pathname.match(/\/api\/apps\/([^/]+)$/);
  const id = context?.params?.id || (m ? decodeURIComponent(m[1]) : null);

  if (id) {
    const r = (await db`SELECT id, title, year, subject, maker, description, pass_score, min_plays, unit, status, owner_id
      FROM apps WHERE id = ${id}`)[0];
    if (!r) return json({ error: '앱을 찾을 수 없어요' }, 404);
    if (r.status !== 'published') {
      const u = await currentUser(req, db);
      if (!u || (u.role !== 'admin' && u.id !== r.owner_id)) return json({ error: '앱을 찾을 수 없어요' }, 404);
    }
    return json({ ...shape(r), status: r.status });
  }

  const rows = await db`SELECT id, title, year, subject, maker, description, pass_score, min_plays, unit
    FROM apps WHERE status = 'published' ORDER BY year DESC, created_at DESC`;
  return json(rows.map(shape));
}
