/* 댓글(피드백) 창 — 플레이 화면·내 앱·교사 화면이 함께 쓴다.
   Comments.mount(요소, { appId: '앱id', loginUrl: 'login.html?next=…', onChange: function(){} })        */
(function () {
  var LABEL = { request: '수정 요청', question: '질문', cheer: '칭찬·응원', reply: '제작자 답글' };
  var CSS = '.cm{--i:var(--ink,#14213D);--s:var(--sub,#5B6784);--l:var(--line,#D9E0EC);--c:var(--card,#fff);--f:var(--field,#fff);--b:var(--blue,#2459D6);--ob:var(--onblue,#fff);--t:var(--track,#E6ECF6);--okb:var(--okbg,#E3F5EA);--ok:var(--ok,#1E7A46);--wb:var(--warnbg,#FFF3D6);--w:var(--warn,#8A5A00);--rb:var(--redbg,#FDE7E4);--r:var(--red,#C0392B);color:var(--i);font:inherit;line-height:1.55}' +
    '.cm *{box-sizing:border-box}.cm-guide{background:var(--t);border-radius:10px;padding:9px 12px;margin:0 0 12px;font-size:.9rem}' +
    '.cm-list{display:flex;flex-direction:column;gap:10px;margin:0 0 14px}.cm-empty{color:var(--s);text-align:center;padding:14px 0}' +
    '.cm-item{background:var(--c);border:1.5px solid var(--l);border-radius:12px;padding:10px 12px}.cm-item.reply{border-color:var(--b)}.cm-item.done{opacity:.8}' +
    '.cm-head{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:.85rem;color:var(--s)}.cm-head b{color:var(--i)}' +
    '.cm-badge{border-radius:99px;padding:0 9px;font-size:.78rem;background:var(--t);color:var(--i);white-space:nowrap}.cm-badge.request{background:var(--wb);color:var(--w)}.cm-badge.cheer,.cm-badge.done{background:var(--okb);color:var(--ok)}.cm-badge.reply{background:var(--b);color:var(--ob)}.cm-badge.tag{background:transparent;border:1px solid var(--l)}' +
    '.cm-body{margin:5px 0 0;white-space:pre-wrap;word-break:break-word}.cm-act{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
    '.cm button{font:inherit;font-size:.85rem;border:1.5px solid var(--b);background:var(--b);color:var(--ob);border-radius:9px;padding:3px 12px;cursor:pointer}.cm button.ghost{background:transparent;color:var(--b)}.cm button.danger{background:transparent;color:var(--r);border-color:var(--r)}.cm button:disabled{opacity:.55}' +
    '.cm-form{display:flex;flex-direction:column;gap:8px}.cm-form select,.cm-form textarea{width:100%;font:inherit;padding:8px 10px;border:1.5px solid var(--l);border-radius:10px;background:var(--f);color:var(--i)}.cm-form textarea{min-height:84px;resize:vertical}' +
    '.cm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.cm-count{font-size:.8rem;color:var(--s)}.cm-err{color:var(--r);font-weight:700;font-size:.9rem;min-height:1.2em}.cm a{color:var(--b)}' +
    '.cm button:focus-visible,.cm select:focus-visible,.cm textarea:focus-visible{outline:3px solid #FFC83D;outline-offset:2px}';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(v) {
    var d = new Date(v), s = (Date.now() - d) / 1000;
    if (isNaN(s)) return ''; if (s < 60) return '방금 전'; if (s < 3600) return Math.floor(s / 60) + '분 전'; if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전'; return d.toLocaleDateString('ko-KR');
  }
  function api(method, path, body) {
    return fetch(path, { method: method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'gallery' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || ('오류 ' + r.status)); e.status = r.status; throw e; } return d; }); });
  }
  function injectCss() { if (document.getElementById('cm-css')) return; var s = document.createElement('style'); s.id = 'cm-css'; s.textContent = CSS; document.head.appendChild(s); }

  function mount(el, opt) {
    injectCss(); el.classList.add('cm');
    var state = null;
    function load() {
      return api('GET', '/api/comments?app=' + encodeURIComponent(opt.appId)).then(function (d) { state = d; draw(); if (opt.onChange) opt.onChange(d); })
        .catch(function (e) {
          if (e.status === 401) el.innerHTML = '<div class="cm-guide">💬 의견을 읽고 남기려면 <a href="' + esc(opt.loginUrl || 'login.html') + '">로그인</a>이 필요해요. 아직 계정이 없다면 <a href="login.html?tab=signup">회원가입</a>을 해 주세요.</div>';
          else el.innerHTML = '<div class="cm-err">' + esc(e.message) + '</div>';
        });
    }
    function draw() {
      var me = state.me, list = state.comments;
      var guide = me.isOwner
        ? '친구들이 남긴 의견이에요. <b>고쳤다면 「반영했어요」</b>를 눌러 알려 주고, 답글도 남길 수 있어요.'
        : '친구가 만든 앱이에요. 고치면 좋을 점은 <b>정중하게, 구체적으로</b> 써 주세요. (어디가 · 어떻게 · 왜) 선생님도 볼 수 있어요.';
      var items = list.length ? list.map(function (c) {
        var who = '<b>' + esc(c.author) + '</b>' + (c.byTeacher ? ' <span class="cm-badge tag">선생님</span>' : c.byMaker ? ' <span class="cm-badge tag">제작자</span>' : '');
        var done = c.kind === 'request' && c.resolved;
        var acts = (c.canResolve ? '<button class="ghost" data-act="res" data-id="' + esc(c.id) + '" data-v="' + (done ? '0' : '1') + '">' + (done ? '다시 열기' : '✓ 반영했어요') + '</button>' : '')
          + (c.canDelete ? '<button class="danger" data-act="del" data-id="' + esc(c.id) + '">삭제</button>' : '');
        return '<div class="cm-item ' + esc(c.kind) + (done ? ' done' : '') + '"><div class="cm-head"><span class="cm-badge ' + esc(c.kind) + '">' + esc(LABEL[c.kind] || c.kind) + '</span>' + (done ? '<span class="cm-badge done">반영됨</span>' : '') + who + '<span>· ' + esc(ago(c.created_at)) + '</span></div><div class="cm-body">' + esc(c.body) + '</div>' + (acts ? '<div class="cm-act">' + acts + '</div>' : '') + '</div>';
      }).join('') : '<div class="cm-empty">아직 의견이 없어요. 첫 의견을 남겨 보세요!</div>';
      var kindSel = me.isOwner ? '<div class="cm-count">제작자 답글로 남겨져요</div>'
        : '<select data-f="kind" aria-label="의견 종류"><option value="request">🛠 수정 요청 (고쳐 주세요)</option><option value="question">❓ 질문</option><option value="cheer">👏 칭찬·응원</option></select>';
      el.innerHTML = '<div class="cm-guide">' + guide + '</div><div class="cm-list">' + items + '</div>'
        + '<form class="cm-form">' + kindSel + '<textarea data-f="body" maxlength="300" placeholder="' + (me.isOwner ? '답글을 써 주세요' : '예) 3번 문제의 정답이 잘못된 것 같아요. 보기 ②가 맞아요.') + '" aria-label="의견 내용"></textarea>'
        + '<div class="cm-row"><span class="cm-count"><span data-f="n">0</span>/300</span><button type="submit">보내기</button></div><div class="cm-err" role="alert"></div></form>';
      var ta = el.querySelector('[data-f=body]');
      ta.oninput = function () { el.querySelector('[data-f=n]').textContent = ta.value.length; };
      el.querySelector('form').onsubmit = function (e) {
        e.preventDefault(); var btn = this.querySelector('button'), err = el.querySelector('.cm-err'); err.textContent = ''; btn.disabled = true;
        var ks = el.querySelector('[data-f=kind]');
        api('POST', '/api/comments', { app: opt.appId, kind: ks ? ks.value : 'reply', body: ta.value })
          .then(load).catch(function (er) { err.textContent = er.message; btn.disabled = false; });
      };
    }
    el.onclick = function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      if (b.dataset.act === 'del') { if (confirm('이 의견을 지울까요?')) api('DELETE', '/api/comments/' + encodeURIComponent(b.dataset.id)).then(load).catch(function (er) { alert(er.message); }); }
      if (b.dataset.act === 'res') api('PATCH', '/api/comments/' + encodeURIComponent(b.dataset.id), { resolved: b.dataset.v === '1' }).then(load).catch(function (er) { alert(er.message); });
    };
    el.innerHTML = '<div class="cm-empty">불러오는 중…</div>';
    return load();
  }
  window.Comments = { mount: mount };
})();
