// 게임 본문: 격리(sandbox) 설정 헤더와 함께 보내서, 게임이 다른 데이터에 접근하지 못하게 한다
import { getSql } from './_lib/db.mjs';
import { CSP } from './_lib/transform.mjs';
import { currentUser } from './_lib/auth.mjs';

export const config = { path: '/api/play/:id' };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return new Response('불러오지 못했어요', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};

export async function handle(req, context, getDb) {
  const raw = context?.params?.id || new URL(req.url).pathname.split('/').pop();
  const db = await getDb();
  const rows = await db`SELECT html, status, owner_id FROM apps WHERE id = ${decodeURIComponent(raw)}`;
  const notFound = () => new Response('앱을 찾을 수 없어요', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (!rows[0]) return notFound();
  // 공개 전(승인 대기·숨김 등)인 앱은 올린 본인과 교사만 미리 해 볼 수 있다
  if (rows[0].status !== 'published') {
    const u = await currentUser(req, db);
    if (!u || (u.role !== 'admin' && u.id !== rows[0].owner_id)) return notFound();
  }
  return new Response(rows[0].html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-cache',
    },
  });
}
