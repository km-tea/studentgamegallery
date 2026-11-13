/* 로그인·내 앱·관리 화면이 함께 쓰는 도우미 */
var $ = function (i) { return document.getElementById(i); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var STATUS = { published: '공개 중', pending: '승인 대기', rejected: '보완 필요', hidden: '숨김', active: '사용 중', disabled: '사용 중지' };
var ICON = { ok: '✅', warn: '⚠️', info: 'ℹ️', error: '⛔' };

// 서버에 요청 (로그인 쿠키는 브라우저가 알아서 보낸다). 실패하면 오류 메시지를 담은 Error를 던진다
function api(method, path, body) {
  return fetch(path, {
    method: method, credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'gallery' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) { var e = new Error(d.error || ('오류 ' + r.status)); e.status = r.status; e.data = d; throw e; }
      return d;
    });
  });
}
function me() { return api('GET', '/api/auth/me').then(function (d) { return d.user; }); }
function logout() { return api('POST', '/api/auth/logout', {}).then(function () { location.href = 'login.html'; }); }
function fmtDate(v) { if (!v) return '-'; var d = new Date(v); return isNaN(d) ? '-' : d.toLocaleDateString('ko-KR') + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
function showChecks(el, d) {
  var items = (d.checks || []).map(function (c) { return '<li>' + ICON[c.level] + ' ' + esc(c.text) + '</li>'; })
    .concat((d.fixes || []).map(function (t) { return '<li>🔧 자동 보정: ' + esc(t) + '</li>'; }));
  el.innerHTML = items.join('');
}
// 로그인 상태가 아니면 로그인 화면으로 보낸다 (role을 주면 그 역할이 아닐 때도)
function guard(role) {
  return me().then(function (u) {
    if (!u || (role && u.role !== role)) {
      location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html'));
      return new Promise(function () {});
    }
    return u;
  });
}
