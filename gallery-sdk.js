/* 갤러리 공통 점수 기록 (1단계: 이 기기의 브라우저에 저장)
   나중에 Neon 연동할 때 이 파일의 내용만 바꾸면 학생 앱은 수정할 필요가 없어요. */
(function () {
  var KEY = 'gallery-progress-v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  window.GallerySDK = {
    // 게임이 한 판 끝날 때마다 호출: GallerySDK.reportScore('앱ID', 점수)
    reportScore: function (id, score) {
      var d = load(), p = d[id] || { best: 0, plays: 0 };
      p.plays += 1; p.last = score; p.best = Math.max(p.best, score); p.at = new Date().toISOString();
      d[id] = p; save(d); return p;
    },
    getProgress: function (id) { var d = load(); return id ? (d[id] || null) : d; },
    // 수료 조건: 최고 점수 ≥ pass, 플레이 횟수 ≥ minPlays(기본 1)
    isPassed: function (app) {
      var s = app.scoring; if (!s) return false;
      var p = load()[app.id];
      return !!p && p.best >= s.pass && p.plays >= (s.minPlays || 1);
    }
  };
})();
