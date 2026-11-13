// 앱 올리기/수정 공통 처리 (교사·학생 둘 다 이 함수를 쓴다)
// 학생: 이름·주제·연도·설명과 수료 조건(기준 점수·최소 플레이 횟수·단위)을 정할 수 있다. 공개 여부는 교사 승인 설정을 따르고, 교사는 승인할 때 수료 조건을 고칠 수 있다.
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
  } else if ('pass' in b) {
    // 학생이 정하는 수료 조건: 게임만 의미가 있다 (점수를 보고하는 앱). 비우면 수료증 없음
    const raw = b.pass === '' || b.pass == null ? null : Number(b.pass);
    if (kind !== '게임' || raw === null) Object.assign(meta, { pass: null, minPlays: 1, unit: '점' });
    else {
      if (!Number.isInteger(raw) || raw < 1 || raw > 1000000) return { error: '수료 기준 점수는 1 이상 1,000,000 이하의 정수로 입력해 주세요' };
      const mp = b.minPlays === '' || b.minPlays == null ? 1 : Number(b.minPlays);
      if (!Number.isInteger(mp) || mp < 1 || mp > 20) return { error: '최소 플레이 횟수는 1~20 사이의 정수로 입력해 주세요' };
      Object.assign(meta, { pass: raw, minPlays: mp, unit: clip(b.unit, 8) || '점' });
    }
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
    existing = (await db`SELECT id, html, checks, owner_id, status, pass_score, min_plays, unit FROM apps WHERE id = ${String(b.id)}`)[0];
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
    // 수료 조건을 보내지 않은 요청이면 기존 값을 그대로 둔다
    const hasPass = 'pass' in meta;
    const pass = hasPass ? meta.pass : existing.pass_score;
    const minPlays = hasPass ? meta.minPlays : existing.min_plays;
    const unit = hasPass ? meta.unit : existing.unit;
    await db`UPDATE apps SET title = ${meta.title}, year = ${meta.year}, subject = ${meta.subject}, kind = ${meta.kind},
      description = ${meta.description}, pass_score = ${pass}, min_plays = ${minPlays}, unit = ${unit},
      html = ${finalHtml}, checks = ${checksJson}::jsonb,
      status = ${status}, review_note = '', updated_at = now() WHERE id = ${appId}`;
  } else if (admin) {
    await db`INSERT INTO apps (id, title, year, subject, kind, maker, description, pass_score, min_plays, unit, html, checks, status)
      VALUES (${appId}, ${meta.title}, ${meta.year}, ${meta.subject}, ${meta.kind}, ${meta.maker}, ${meta.description}, ${meta.pass},
      ${meta.minPlays}, ${meta.unit}, ${finalHtml}, ${checksJson}::jsonb, 'published')`;
  } else {
    await db`INSERT INTO apps (id, title, year, subject, kind, maker, description, pass_score, min_plays, unit, html, checks, status, owner, owner_id)
      VALUES (${appId}, ${meta.title}, ${meta.year}, ${meta.subject}, ${meta.kind}, ${user.nickname}, ${meta.description},
      ${'pass' in meta ? meta.pass : null}, ${'pass' in meta ? meta.minPlays : 1}, ${'pass' in meta ? meta.unit : '점'},
      ${finalHtml}, ${checksJson}::jsonb, ${status}, 'student', ${user.id})`;
  }
  return json({ ok: true, id: appId, status, ...stored });
}
