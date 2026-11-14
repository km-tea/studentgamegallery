/* 폴더로 올린 게임(2026/… 같은 폴더 앱) 화면에 「← 갤러리」 버튼을 달아 줘요.
   새 폴더 게임에도 body 끝 바로 앞에 back-to-gallery.js 스크립트 한 줄만 넣으면 돼요.
   (현재 폴더 게임 5개는 이 코드가 각 index.html 안에 직접 들어 있어요) */
(function () {
  if (document.getElementById('gallery-back')) return;
  function add() {
    var a = document.createElement('a');
    a.id = 'gallery-back'; a.href = '/'; a.textContent = '← 갤러리';
    a.setAttribute('aria-label', '갤러리로 돌아가기');
    a.style.cssText = 'position:fixed;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));z-index:2147483000;'
      + 'background:rgba(20,33,61,.88);color:#FFD66B;border:1.5px solid #FFD66B;border-radius:999px;padding:6px 14px;'
      + 'font:700 15px/1.3 "Gowun Dodum","Noto Sans KR",system-ui,sans-serif;text-decoration:none;cursor:pointer;opacity:.92;touch-action:manipulation';
    a.onclick = function (e) {
      if (!confirm('게임에서 나가 갤러리로 돌아갈까요?\n(진행 중인 판은 사라져요)')) e.preventDefault();
    };
    document.body.appendChild(a);
  }
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();
