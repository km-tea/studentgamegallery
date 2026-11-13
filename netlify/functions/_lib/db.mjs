// Neon 연결 + 공통 도우미 (_lib 폴더는 함수로 배포되지 않고 다른 함수가 가져다 씀)
import { hashPassword, randomId, randomCode } from './crypto.mjs';

export const env = (k) => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : process.env[k]);

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

let _sql;
let _ensured;

export async function getSql() {
  if (!_sql) {
    const url = env('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL 환경변수가 설정되어 있지 않아요');
    const { neon } = await import('@neondatabase/serverless');
    _sql = neon(url);
  }
  await ensure(_sql);
  return _sql;
}

// 표가 없으면 처음 한 번 자동으로 만든다 (Neon에서 SQL을 따로 실행할 필요 없음)
// 이미 쓰던 DB도 안전하게 이어서 쓸 수 있도록 "없으면 추가"만 한다.
export function ensure(db) {
  if (!_ensured) {
    _ensured = migrate(db).catch((e) => { _ensured = null; throw e; });
  }
  return _ensured;
}

export async function migrate(db) {
  await db`CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    year INT NOT NULL,
    subject TEXT NOT NULL,
    maker TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    pass_score INT,
    min_plays INT NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT '점',
    html TEXT NOT NULL,
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'published',
    owner TEXT NOT NULL DEFAULT 'teacher',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // 2단계(계정) 추가 칸
  await db`ALTER TABLE apps ADD COLUMN IF NOT EXISTS owner_id TEXT`;
  await db`ALTER TABLE apps ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''`;
  await db`CREATE INDEX IF NOT EXISTS apps_owner_idx ON apps (owner_id)`;

  await db`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    status TEXT NOT NULL DEFAULT 'active',
    token_version INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
  )`;
  await db`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`;

  // 처음 한 번: 학급 가입 코드를 무작위로 만들어 둔다 (교사가 관리 화면에서 바꿀 수 있음)
  await db`INSERT INTO settings (key, value) VALUES ('signup_code', ${randomCode(6)}) ON CONFLICT (key) DO NOTHING`;

  // 관리자 계정이 하나도 없으면 환경변수(ADMIN_PASSWORD)로 처음 한 번 만든다
  const admins = await db`SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1`;
  const pw = env('ADMIN_PASSWORD');
  if (!admins.length && pw) {
    const username = (env('ADMIN_USERNAME') || 'admin').trim().toLowerCase();
    await db`INSERT INTO users (id, username, nickname, pw_hash, role)
      VALUES (${randomId('u')}, ${username}, ${'선생님'}, ${hashPassword(pw)}, 'admin')
      ON CONFLICT (username) DO NOTHING`;
  }
}

// ---- 설정값 ----
export const SETTING_DEFAULTS = {
  signup_open: '1',          // 학생 가입 허용
  signup_code: '',           // 가입 코드 (비우면 코드 없이 가입 가능)
  auto_publish: '0',         // 학생이 올린 앱을 승인 없이 바로 공개
  max_apps: '3',             // 학생 1명이 올릴 수 있는 앱 개수
  subjects: '그림책,국어,수학,사회,과학,환경,영어,기타',
};

export async function getSettings(db) {
  const rows = await db`SELECT key, value FROM settings`;
  const s = { ...SETTING_DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export const subjectList = (s) => String(s.subjects).split(',').map((x) => x.trim()).filter(Boolean);
