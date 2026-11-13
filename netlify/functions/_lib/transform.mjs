// 업로드된 게임 HTML을 검사(inspect)하고 갤러리용으로 자동 보정(transform)한다.
// DB 없이도 동작하는 순수 함수라서 따로 테스트할 수 있다.

export const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// 게임은 격리(sandbox)된 상태로 실행되고, 서버·DB로 데이터를 보내는 통신은 막는다.
export const CSP = [
  'sandbox allow-scripts allow-popups allow-pointer-lock',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  'worker-src blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// 게임 안에 넣는 코드: ① 저장소 보정 ② 갤러리로 점수 보내기
const bridge = (id) => `<script>/* gallery-bridge */(function(){
var APP=${JSON.stringify(id)};
function mem(){var m={};var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(m).length}});return s}
['localStorage','sessionStorage'].forEach(function(n){try{window[n].getItem('_')}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e2){}}});
window.GallerySDK={reportScore:function(_id,score){var n=Number(score);if(!isFinite(n))n=0;try{parent.postMessage({gallery:1,type:'score',app:APP,score:n},'*')}catch(e){}return null},getProgress:function(){return null},isPassed:function(){return false}};
})();</script>`;

export function transform(src, id) {
  const fixes = [];
  let html = String(src).replace(/^\uFEFF/, '');

  const dt = html.search(/<!doctype/i);
  if (dt > 0 && html.slice(0, dt).trim()) {
    html = html.slice(dt);
    fixes.push('파일 맨 앞에 섞여 있던 글자를 지웠어요');
  }

  const before = html;
  html = html.replace(/<script[^>]*src=["'][^"']*gallery-sdk\.js["'][^>]*>\s*<\/script>\s*/gi, '');
  if (html !== before) fixes.push('개발용 갤러리 연결 스크립트를 업로드용으로 교체했어요');

  let inject = '';
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    inject += '<meta name="viewport" content="width=device-width, initial-scale=1">';
    fixes.push('태블릿용 화면 설정(viewport)을 추가했어요');
  }
  inject += '<style>html{-webkit-text-size-adjust:100%}body{touch-action:manipulation;-webkit-tap-highlight-color:transparent}</style>';
  inject += bridge(id);
  fixes.push('점수 기록(랭킹·수료증) 연결과 저장소 보정 코드를 넣었어요');

  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + inject);
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + '<head>' + inject + '</head>');
  else html = '<!DOCTYPE html><html><head><meta charset="utf-8">' + inject + '</head><body>' + html + '</body></html>';

  return { html, fixes };
}

export function inspect(src) {
  const s = String(src);
  const checks = [];
  const add = (level, text) => checks.push({ level, text });
  const kb = Math.round(new TextEncoder().encode(s).length / 1024);

  if (!/<(html|body|canvas|div|script)\b/i.test(s)) {
    add('error', 'HTML 파일이 아닌 것 같아요');
    return { checks, blocked: true };
  }
  add('info', `파일 크기 ${kb}KB`);

  if (/reportScore\s*\(/.test(s)) add('ok', '점수 기록(reportScore) 호출이 있어요 → 랭킹·수료증을 쓸 수 있어요');
  else add('warn', 'reportScore 호출이 없어요 → 점수가 기록되지 않아 수료증을 받을 수 없어요 (게임 만들기 프롬프트를 맨 앞에 붙여서 다시 만들어 보세요)');

  const keyboard = /keydown|keyup|onkeydown/.test(s);
  const pointer = /touchstart|touchend|pointerdown|mousedown|onclick|addEventListener\(\s*['"]click/.test(s);
  if (keyboard && !pointer) add('warn', '키보드 입력만 있는 것 같아요 → 태블릿에서는 조작이 안 될 수 있어요');
  else if (/touchstart|pointerdown/.test(s) || /<button/i.test(s)) add('ok', '터치·버튼 조작이 있어요');
  else add('info', '터치 조작 여부를 확인하지 못했어요 → 태블릿에서 직접 해 보세요');

  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|firebase/i.test(s))
    add('warn', '외부 통신 코드가 있어요 → 보안 설정 때문에 갤러리에서는 작동하지 않아요 (랭킹·저장 서버 연결 불가)');

  if (/localStorage|sessionStorage/.test(s)) add('info', '브라우저 저장 기능을 써요 → 갤러리에서는 임시 저장소로 대신해서 창을 닫으면 사라져요');

  const hosts = new Set();
  const re = /(?:<(?:script|link)\b[^>]*\b(?:src|href)=|from\s+)["']https?:\/\/([^\/"']+)/gi;
  let m;
  while ((m = re.exec(s))) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) hosts.add(m[1]);
  if (hosts.size) add('warn', `허용되지 않은 외부 주소라 불러오지 못해요: ${[...hosts].join(', ')}`);

  if (/placeholder=["'][^"']*(이름|닉네임|별명)/.test(s)) add('info', '이름·닉네임 입력칸이 있어요 → 실명 대신 별명을 쓰도록 해 주세요');
  if (/<iframe\b/i.test(s)) add('warn', 'iframe(다른 화면 끼워 넣기)는 보안 설정으로 막혀요');

  return { checks, blocked: false };
}
