// 댓글(피드백): 앱을 해 본 사람이 제작자에게 수정 요청·질문·칭찬을 남긴다
// 로그인한 학생·교사만 읽고 쓸 수 있다. 공개 전 앱은 올린 본인과 교사만 (교사가 승인 전에 의견을 줄 수 있게)
import { getSql, json, COMMENT_KINDS } from './_lib/db.mjs';
import { requireUser } from './_lib/auth.mjs';
import { randomId } from './_lib/crypto.mjs';

export const config = { path: ['/api/comments', '/api/comments/:id'] };

export default async (req, context) => {
  try {
    return await handle(req, context, getSql);
  } catch (e) {
    return json({ error: '잠시 후 다시 시도해 주세요' }, 500);
  }
};

const MAX_PER_APP = 10; // 한 사람이 앱 하나에 남길 수 있는 댓글 수

// apps.json(폴더로 올린 앱)에 있는 앱도 댓글을 받을 수 있게, 목록을 잠깐 기억해 두고 확인한다
let folderCache = { at: 0, ids: new Set() };
async function folderAppExists(req, id) {
  if (Date.now() - folderCache.at > 60000) {
    try {
      const r = await fetch(new URL('/apps.json', req.url));
      folderCache = { at: Date.now(), ids: new Set(r.ok ? (await r.json()).map((a) => a.id) : []) };
    } catch { /* 못 읽으면 폴더 앱은 없는 것으로 */ }
  }
  return folderCache.ids.has(id);
}

async function loadApp(db, id, user, req) {
  const a = (await db`SELECT id, status, owner_id FROM apps WHERE id = ${String(id || '')}`)[0];
  if (!a) {
    // 폴더 앱: 항상 공개 상태이고 제작자 계정은 없다 (반영 표시는 교사만)
    if (id && await folderAppExists(req, String(id))) return { id: String(id), status: 'published', owner_id: null, isOwner: false, isAdmin: user.role === 'admin' };
    return null;
  }
  const owner = !!a.owner_id && a.owner_id === user.id;
  if (a.status !== 'published' && !owner && user.role !== 'admin') return null; // 볼 수 없는 앱은 "없다"고 답한다
  return { ...a, isOwner: owner, isAdmin: user.role === 'admin' };
}

export async function handle(req, context, getDb) {
  const db = await getDb();
  const { user, res } = await requireUser(req, db);
  if (res) return res;
  const url = new URL(req.url);
  const m = url.pathname.match(/\/api\/comments\/([^/]+)$/);
  const id = context?.params?.id || (m ? decodeURIComponent(m[1]) : null);

  if (req.method === 'GET' && !id) {
    const app = await loadApp(db, url.searchParams.get('app'), user, req);
    if (!app) return json({ error: '앱을 찾을 수 없어요' }, 404);
    const rows = await db`SELECT c.id, c.author_id, c.author_name, c.kind, c.body, c.resolved, c.created_at, u.role AS author_role
      FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.app_id = ${app.id} ORDER BY c.created_at ASC`;
    const comments = rows.map((c) => ({
      id: c.id, kind: c.kind, body: c.body, author: c.author_name, created_at: c.created_at, resolved: c.resolved,
      byMaker: !!app.owner_id && c.author_id === app.owner_id, byTeacher: c.author_role === 'admin',
      mine: c.author_id === user.id,
      canDelete: app.isAdmin || c.author_id === user.id,
      canResolve: c.kind === 'request' && (app.isAdmin || app.isOwner),
    }));
    return json({ comments, me: { isOwner: app.isOwner, isAdmin: app.isAdmin }, openRequests: comments.filter((c) => c.kind === 'request' && !c.resolved).length });
  }

  if (req.method === 'POST' && !id) {
    let b;
    try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
    const app = await loadApp(db, b.app, user, req);
    if (!app) return json({ error: '앱을 찾을 수 없어요' }, 404);
    const body = String(b.body || '').trim().slice(0, 300);
    if (body.length < 2) return json({ error: '내용을 두 글자 이상 써 주세요' }, 400);
    // 제작자는 '답글'만, 다른 사람은 수정 요청·질문·칭찬 중에서 고른다
    const kind = app.isOwner ? 'reply' : String(b.kind || 'request');
    if (kind === 'reply' ? !app.isOwner : !['request', 'question', 'cheer'].includes(kind)) return json({ error: '댓글 종류가 올바르지 않아요' }, 400);
    const n = (await db`SELECT count(*)::int AS n FROM comments WHERE app_id = ${app.id} AND author_id = ${user.id}`)[0].n;
    if (n >= MAX_PER_APP) return json({ error: `한 앱에는 댓글을 ${MAX_PER_APP}개까지 남길 수 있어요` }, 429);
    const cid = randomId('c');
    await db`INSERT INTO comments (id, app_id, author_id, author_name, kind, body)
      VALUES (${cid}, ${app.id}, ${user.id}, ${user.role === 'admin' ? '선생님' : user.nickname}, ${kind}, ${body})`;
    return json({ ok: true, id: cid, kind: COMMENT_KINDS[kind] });
  }

  if (id) {
    const c = (await db`SELECT c.id, c.author_id, c.kind, a.owner_id FROM comments c LEFT JOIN apps a ON a.id = c.app_id WHERE c.id = ${id}`)[0];
    if (!c) return json({ error: '댓글을 찾지 못했어요' }, 404);
    const isAdmin = user.role === 'admin';
    if (req.method === 'DELETE') {
      if (!isAdmin && c.author_id !== user.id) return json({ error: '내가 쓴 댓글만 지울 수 있어요' }, 403);
      await db`DELETE FROM comments WHERE id = ${id}`;
      return json({ ok: true });
    }
    if (req.method === 'PATCH') {
      let b;
      try { b = await req.json(); } catch { return json({ error: '요청 형식이 올바르지 않아요' }, 400); }
      // '반영했어요' 표시는 수정 요청에만, 앱을 올린 제작자와 교사만
      if (c.kind !== 'request' || (!isAdmin && c.owner_id !== user.id)) return json({ error: '권한이 없어요' }, 403);
      await db`UPDATE comments SET resolved = ${!!b.resolved} WHERE id = ${id}`;
      return json({ ok: true });
    }
  }
  return json({ error: '지원하지 않는 요청이에요' }, 405);
}
