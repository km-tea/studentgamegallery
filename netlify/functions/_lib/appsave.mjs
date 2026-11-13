// 앱 올리기/수정 공통 처리 (교사·학생 둘 다 이 함수를 쓴다)
// 학생: 이름·주제·연도·설명만 정할 수 있고, 수료 기준은 교사가 정한다. 공개 여부는 교사 승인 설정을 따른다.
import { randomBytes } from 'node:crypto';
import { json, subjectList, KINDS } from './db.mjs';
import { inspect, transform, MAX_BYTES } from './transform.mjs';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function cleanMeta(b, admin, subjects) {
  const title = clip(b.title, 60), subject = clip(b.subject, 20), year = parseInt(b.year, 10);
  if (!title) return { error: '앱 이름을 입력해 주세요' };
  if (!subject) return { error: '주제를 선택해 주세요' };
  if (!admin && !subjects.includes(subject)) return { error: '목록에 있는 주제를 골라 주세요' };
  if (!(year >= 2000 && year <= 2100)) return { error: '연도를 확인해 주세요' };
  const kind = clip(b.kind, 10) || '게임';
  if (!KINDS.includes(kind)) return { error: '앱 유형을 목록에서 골라 주세요' };
  const meta = { title, subject, year, kind, description: clip(b.description, 200) };
  if (admin) {
    const pass = b.pass === '' || b.pass == null ? null : parseInt(b.pass, 10);
    if (pass !== null && !(pass >= 1)) return { error: '기준 점수는 1 이상의 숫자로 입력해 주세요' };
    Object.assign(meta, { pass, maker: clip(b.maker, 40), minPlays: Math.max(1, parseInt(b.minPlays, 10) || 1), unit: clip(b.unit, 8) || '점' });
  }
  return meta;
}

export async function saveApp({ db, body: b, user, settings }) {
  const admin = user.role === 'admin';
  const meta = cleanMeta(b, admin, subjectList(settings));
  if (meta.error) return json({ error: meta.error }, 400);

  const html = typeof b.html === 'string' && b.html.trim() ? b.html : null;
  if (html && new TextEncoder().encode(html).length > MAX_BYTES) return json({ error: '파일이 너무 커요 (2MB 이하만 가능해요)' }, 413);

  let existing = null;
  if (b.id) {
    existing = (await db`SELECT id, html, checks, owner_id, status FROM apps WHERE id = ${String(b.id)}`)[0];
    // 학생은 자기 앱만 고칠 수 있다 (남의 앱이면 "없다"고 답해서 존재 여부도 숨긴다)
    if (!existing || (!admin && existing.owner_id !== user.id)) return json({ error: '수정할 앱을 찾지 못했어요' }, 404);
  }
  if (!html && !existing) return json({ error: 'HTML 파일을 선택해 주세요' }, 400);

  if (!existing && !admin && !b.dryRun) {
    const max = parseInt(settings.max_apps, 10) || 3;
    const n = (await db`SELECT count(*)::int AS n FROM apps WHERE owner_id = ${user.id}`)[0].n;
    if (n >= max) return json({ error: `앱은 ${max}개까지 올릴 수 있어요. 안 쓰는 앱을 지우거나 선생님께 문의해 주세요` }, 403);
  }

  const appId = existing ? existing.id : `${meta.year}-${randomBytes(3).toString('hex')}`;
  let finalHtml, stored;
  if (html) {
    const insp = inspect(html, { kind: meta.kind });
    if (insp.blocked) return json({ error: insp.checks.find((c) => c.level === 'error').text, checks: insp.checks }, 400);
    const t = transform(html, appId);
    finalHtml = t.html;
    stored = { checks: insp.checks, fixes: t.fixes };
  } else {
    finalHtml = existing.html;
    stored = existing.checks;
  }
  if (b.dryRun) return json({ dryRun: true, ...stored });
  const checksJson = JSON.stringify(stored);

  // 상태 결정: 교사는 그대로(새 앱은 공개), 학생은 승인 설정에 따라
  let status;
  if (admin) status = existing ? existing.status : 'published';
  else if (existing && existing.status === 'hidden') status = 'hidden'; // 교사가 숨긴 앱은 학생이 다시 공개할 수 없다
  else status = settings.auto_publish === '1' ? 'published' : 'pending';

  if (existing && admin) {
    await db`UPDATE apps SET title = ${meta.title}, year = ${meta.year}, subject = ${meta.subject}, kind = ${meta.kind}, maker = ${meta.maker},
      description = ${meta.description}, pass_score = ${meta.pass}, min_plays = ${meta.minPlays}, unit = ${meta.unit},
      html = ${finalHtml}, checks = ${checksJson}::jsonb, updated_at = now() WHERE id = ${appId}`;
  } else if (existing) {
    await db`UPDATE apps SET title = ${meta.title}, year = ${meta.year}, subject = ${meta.subject}, kind = ${meta.kind},
      description = ${meta.description}, html = ${finalHtml}, checks = ${checksJson}::jsonb,
      status = ${status}, review_note = '', updated_at = now() WHERE id = ${appId}`;
  } else if (admin) {
    await db`INSERT INTO apps (id, title, year, subject, kind, maker, description, pass_score, min_plays, unit, html, checks, status)
      VALUES (${appId}, ${meta.title}, ${meta.year}, ${meta.subject}, ${meta.kind}, ${meta.maker}, ${meta.description}, ${meta.pass},
      ${meta.minPlays}, ${meta.unit}, ${finalHtml}, ${checksJson}::jsonb, 'published')`;
  } else {
    await db`INSERT INTO apps (id, title, year, subject, kind, maker, description, html, checks, status, owner, owner_id)
      VALUES (${appId}, ${meta.title}, ${meta.year}, ${meta.subject}, ${meta.kind}, ${user.nickname}, ${meta.description},
      ${finalHtml}, ${checksJson}::jsonb, ${status}, 'student', ${user.id})`;
  }
  return json({ ok: true, id: appId, status, ...stored });
}
