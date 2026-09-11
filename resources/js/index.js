/**
 * g7-comment-editor — 프론트 엔트리 (loading.strategy = global, 전 페이지 로드)
 *
 * sirsoft-board 댓글 입력창은 기본 사양상 순수 텍스트 <textarea> 다. 이 스크립트가
 * sirsoft-board · sirsoft-ckeditor5 · sirsoft-basic 을 **한 줄도 수정하지 않고**:
 *
 *  1. 댓글/답글/댓글수정 textarea 를 감지해 CKEditor 5 ClassicEditor 로 교체한다
 *     (제목(H2/H3/H4)·굵게·기울임·취소선·인라인코드·글머리목록·번호목록·인용구·코드블록·링크).
 *     필요한 플러그인은 sirsoft-ckeditor5 가 동봉한 CKEditor 5 UMD 단일 패키지 번들에 이미
 *     들어 있어 툴바 노출만 한다(별도 번들 로드 없음). 원본 textarea 는 숨긴 채 DOM 에 남겨,
 *     에디터 내용을 되써넣고 bubbling `input` 이벤트를 디스패치한다 → 템플릿 엔진의
 *     `actions:[{type:"input",handler:"setState"}]` 가 발화해 `_local.*` 상태가 갱신되고,
 *     기존 등록/저장 apiCall 이 그대로 HTML 을 전송한다.
 *  2. 저장된 HTML 댓글을 방문자 목록에서 승격한다. sirsoft-basic 은 댓글 본문을 `text`
 *     바인딩으로 그려 HTML 이 이스케이프되므로(태그가 그대로 보임), 렌더된 본문 노드를
 *     스캔해 **화이트리스트 새니타이저**(p·br·strong/b·em/i·u·s·ul·ol·li·a[href]·img[src][alt]·
 *     blockquote·pre·code·h1~h6 만 허용, 그 외 태그·모든 속성·이벤트 핸들러 제거)를 거쳐
 *     실제 서식으로 바꾼다.
 *
 * 서버는 댓글 HTML 을 검열 없이 저장/반환하고, 승격 시 이스케이프가 풀리므로 **XSS 방어는
 * 아래 sanitizeCommentHtml() 이 전담**한다. CKEditor 5 본체/CSS 는 sirsoft-ckeditor5 가
 * 동봉한 same-origin 자산을 재사용한다(그래서 그 플러그인에 의존).
 *
 * 설계 원칙: 멱등(처리 표시), SPA 대응(DOMContentLoaded + 지연 재스캔 + body MutationObserver),
 * 조용히 깨지지 않음(에디터 로드 실패 시 순수 textarea 로 폴백).
 */
(function () {
  'use strict';

  var IDENTIFIER = 'g7-comment-editor';
  var CKE_DEP = 'sirsoft-ckeditor5';
  var CKE_VER = '43.3.1';

  /* 댓글 입력 textarea (신규/답글/수정) — sirsoft-basic 파셜의 name 속성 */
  var TEXTAREA_SELECTOR =
    'textarea[name="comment_content"],' +
    'textarea[name="reply_content"],' +
    'textarea[name="editing_comment_content"]';

  var STYLE_ID = 'g7ce-style';
  var CKE_CSS_ID = 'g7ce-ckeditor5-css';
  // ⚠️ sirsoft-ckeditor5 의 레이아웃 scripts[] (`resources/extensions/html-editor.json`) 가
  //    쓰는 것과 **같은 script id**. 코어의 레이아웃 스크립트 로더(TemplateApp.loadLayoutScripts)
  //    는 `document.getElementById(script.id)` 로만 중복을 거른다. id 가 다르면 우리가 먼저
  //    넣어도 코어가 글쓰기/수정 화면에서 ckeditor5.umd.js 를 한 번 더 주입 → 두 번 실행 →
  //    `CKEditorError: ckeditor-duplicated-modules` → `window.CKEDITOR.ClassicEditor` 소실 →
  //    게시글 에디터가 임시 입력창으로 폴백된다. 같은 id 를 쓰면 누가 먼저 넣든 태그 하나로 수렴.
  var CKE_JS_ID = 'ckeditor5_script';

  var logger =
    (window.G7Core && window.G7Core.createLogger && window.G7Core.createLogger('Plugin:' + IDENTIFIER)) || {
      log: function () {},
      warn: function () {},
      error: function () {}
    };

  /* ================================================================ *
   *  설정 / 유틸
   * ================================================================ */

  function asBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') return value !== 'false' && value !== '0';
    return Boolean(value);
  }

  function readSettings() {
    var s = (window.G7Config && window.G7Config.plugins && window.G7Config.plugins[IDENTIFIER]) || {};
    return {
      enabled: asBool(s.enabled, true),
      // 외부 링크 렌더링 (렌더 승격 후 후처리). 기본 전부 ON. 설정 UI 는 없으며
      // G7Config 로 주입되면 개별 비활성 가능 (Facebook 은 프로젝트 방침상 항상 제외).
      embedYoutube: asBool(s.embed_youtube, true),
      embedTwitter: asBool(s.embed_twitter, true),
      embedInstagram: asBool(s.embed_instagram, true),
      embedTiktok: asBool(s.embed_tiktok, true),
      renderImage: asBool(s.render_image, true)
    };
  }

  function t(key, fallback) {
    var fn = window.G7Core && window.G7Core.t;
    if (typeof fn !== 'function') return fallback;
    var full = IDENTIFIER + '.' + key;
    var r = fn(full);
    return r && r !== full ? r : fallback;
  }

  /** 코어 자산 URL API 로 sirsoft-ckeditor5 동봉 자산 경로를 해석 (없으면 직접 조립). */
  function depAssetUrl(relPath) {
    var api = window.G7Core && window.G7Core.asset;
    if (api && typeof api.plugin === 'function') {
      try {
        return api.plugin(CKE_DEP, relPath);
      } catch (e) {
        /* fall through */
      }
    }
    return '/api/plugins/assets/' + CKE_DEP + '/' + relPath;
  }

  /* ================================================================ *
   *  CKEditor 5 지연 로더 (댓글 textarea 를 실제로 발견했을 때만)
   * ================================================================ */

  var _ckePromise = null;

  function loadCKEditor() {
    if (window.CKEDITOR && window.CKEDITOR.ClassicEditor) return Promise.resolve(window.CKEDITOR);
    if (_ckePromise) return _ckePromise;

    // CSS (한 번). 에디터 UI 스타일 — 실패해도 CKEditor 자체는 뜨므로 결과를 기다리지 않는다.
    if (!document.getElementById(CKE_CSS_ID)) {
      var link = document.createElement('link');
      link.id = CKE_CSS_ID;
      link.rel = 'stylesheet';
      link.href = depAssetUrl('dist/vendor/ckeditor5/' + CKE_VER + '/ckeditor5.css');
      document.head.appendChild(link);
    }

    _ckePromise = loadCkeditorUmd(depAssetUrl('dist/vendor/ckeditor5/' + CKE_VER + '/ckeditor5.umd.js'))
      .then(function () {
        if (window.CKEDITOR && window.CKEDITOR.ClassicEditor) return window.CKEDITOR;
        throw new Error('CKEDITOR global missing after UMD load');
      })
      .catch(function (err) {
        _ckePromise = null; // 다음 시도 때 재로드 허용
        throw err;
      });

    return _ckePromise;
  }

  /**
   * ckeditor5.umd.js 를 로드한다.
   *
   * **반드시 sirsoft-ckeditor5 레이아웃과 같은 script id(`CKE_JS_ID` = `ckeditor5_script`)로**
   * 넣는다 — 코어 로더/우리 중 누가 먼저 넣든 태그 하나로 수렴해 UMD 가 한 번만 실행된다
   * (`ckeditor-duplicated-modules` 방지). 가능하면 코어 자산 로더(`G7Core.asset.loadScript`)를
   * 사용 — 재시도·in-flight 공유·실패 표면화 계층을 함께 얻고 코어 스크립트 레지스트리에 등록된다.
   */
  function loadCkeditorUmd(src) {
    if (window.CKEDITOR && window.CKEDITOR.ClassicEditor) return Promise.resolve();

    var api = window.G7Core && window.G7Core.asset;
    if (api && typeof api.loadScript === 'function') {
      return api.loadScript(src, { id: CKE_JS_ID }, { label: 'ckeditor5 UMD (g7-comment-editor)' });
    }

    // 폴백: 코어 로더가 없을 때만 직접 주입 — id 는 동일하게 유지해 중복 방지.
    return new Promise(function (resolve, reject) {
      var existing = document.getElementById(CKE_JS_ID);
      if (existing) {
        if (window.CKEDITOR) {
          resolve();
          return;
        }
        existing.addEventListener('load', function () {
          resolve();
        });
        existing.addEventListener('error', function () {
          reject(new Error('CKEditor UMD script failed'));
        });
        return;
      }
      var script = document.createElement('script');
      script.id = CKE_JS_ID;
      script.src = src;
      script.async = true;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error('CKEditor UMD script failed to load'));
      };
      document.head.appendChild(script);
    });
  }

  /* ================================================================ *
   *  화이트리스트 새니타이저 (저장 HTML 렌더 승격 시 XSS 방어 전담)
   *
   *  1차 툴바가 만들 수 있는 태그만 허용하고, 그 외 태그·전체 속성·이벤트 핸들러를
   *  모두 제거한다. 허용 외 태그는 통째로 버린다(자식도 함께). DOMParser 로 파싱하므로
   *  파서 단계에서 스크립트는 실행되지 않는다.
   * ================================================================ */

  // 허용 태그 → 허용 속성
  //  IMG 는 "외부 링크 렌더링" 기능이 추가되며 허용 목록에 들어갔다. src 는 절대 http(s)
  //  URL 만(아래 safeImgSrc), 복제 속성은 src/alt 둘뿐이라 on* 이벤트 속성은 자동 탈락한다.
  //  BLOCKQUOTE/PRE/CODE/H1~H6 은 "툴바 확장"(인용구·코드블록·인라인코드·제목)으로 추가.
  //  전부 **속성 0** — walk() 가 새 엘리먼트를 createElement 로 다시 만들고 허용 속성만
  //  복제하므로 class(코드블록 language-*)·style·id·on* 은 전부 탈락한다. 스타일 인젝션·
  //  이벤트 핸들러 경로 없음. 텍스트는 createTextNode 로 이스케이프되어 pre 안 개행도 안전.
  var ALLOWED_TAGS = {
    P: [],
    BR: [],
    STRONG: [],
    B: [],
    EM: [],
    I: [],
    U: [],
    S: [],
    UL: [],
    OL: [],
    LI: [],
    BLOCKQUOTE: [],
    PRE: [],
    CODE: [],
    H1: [],
    H2: [],
    H3: [],
    H4: [],
    H5: [],
    H6: [],
    A: ['href', 'target', 'rel'],
    IMG: ['src', 'alt']
  };

  function safeHref(raw) {
    var v = String(raw || '').trim();
    // 허용: http(s), 프로토콜 상대(//), 루트 상대(/), 앵커(#), mailto
    if (/^(https?:\/\/|\/\/|\/|#|mailto:)/i.test(v)) return v;
    return null;
  }

  /** 이미지 src — 외부 핫링크만 허용(절대 http/https URL). data:·상대·javascript: 전부 거부. */
  function safeImgSrc(raw) {
    var v = String(raw || '').trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return v;
    return null;
  }

  function sanitizeCommentHtml(dirty) {
    var doc;
    try {
      doc = new DOMParser().parseFromString('<body><div id="g7ce-root">' + dirty + '</div></body>', 'text/html');
    } catch (e) {
      return '';
    }
    var src = doc.getElementById('g7ce-root');
    if (!src) return '';

    var out = document.createElement('div');

    function walk(from, to) {
      var node = from.firstChild;
      while (node) {
        if (node.nodeType === 3) {
          // 텍스트 노드 — 그대로 (createTextNode 가 이스케이프 처리)
          to.appendChild(document.createTextNode(node.nodeValue));
        } else if (node.nodeType === 1) {
          var tag = node.tagName;
          var allowedAttrs = Object.prototype.hasOwnProperty.call(ALLOWED_TAGS, tag) ? ALLOWED_TAGS[tag] : null;
          if (allowedAttrs) {
            if (tag === 'IMG') {
              var isrc = safeImgSrc(node.getAttribute('src'));
              if (isrc) {
                var im = document.createElement('img');
                im.setAttribute('src', isrc);
                im.setAttribute('alt', String(node.getAttribute('alt') || ''));
                im.setAttribute('loading', 'lazy');
                im.setAttribute('referrerpolicy', 'no-referrer');
                to.appendChild(im);
              }
              // src 가 부적합하면 이미지 자체를 버린다 (자식 없음)
            } else {
              var el = document.createElement(tag.toLowerCase());
              if (tag === 'A') {
                var href = safeHref(node.getAttribute('href'));
                if (href) {
                  el.setAttribute('href', href);
                  el.setAttribute('rel', 'noopener noreferrer');
                  if (node.getAttribute('target') === '_blank') el.setAttribute('target', '_blank');
                }
              }
              walk(node, el);
              to.appendChild(el);
            }
          }
          // 허용 외 태그(script/style/iframe/div/span/…) → 통째로 버림
        }
        node = node.nextSibling;
      }
    }

    walk(src, out);
    return out.innerHTML;
  }

  /* ================================================================ *
   *  텍스트 ↔ HTML 변환 (에디터 초기값 / 폼 seed 처리)
   * ================================================================ */

  function looksLikeHtml(v) {
    return /<(p|br|strong|b|em|i|u|s|ul|ol|li|a|img|blockquote|pre|code|h[1-6])\b[^>]*>/i.test(String(v || ''));
  }

  /** 순수 텍스트 → 문단 HTML (빈 줄로 문단 분리, 단일 개행은 <br>). 에디터 초기값 변환과 동일 규칙. */
  function plainTextToHtml(v) {
    var s = String(v == null ? '' : v);
    if (s.trim() === '') return '';
    return s.split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeText(block).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function escapeText(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** textarea 원시값 → 에디터에 넣을 HTML */
  function valueToEditorHtml(v) {
    var s = String(v == null ? '' : v);
    if (s.trim() === '') return '';
    if (looksLikeHtml(s)) return sanitizeCommentHtml(s);
    // 순수 텍스트: 빈 줄로 문단 분리, 단일 개행은 <br>
    var blocks = s.split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeText(block).replace(/\n/g, '<br>') + '</p>';
    });
    return blocks.join('');
  }

  /* ================================================================ *
   *  CKEditor 툴바 구성
   *
   *  1차 5개(굵게·기울임·글머리목록·번호목록·링크)에 인용구·코드블록·인라인 코드·
   *  제목(H2/H3/H4)·취소선을 더한다. 필요한 플러그인은 전부 sirsoft-ckeditor5 가
   *  same-origin 으로 동봉한 CKEditor 5 UMD 단일 패키지 번들(`window.CKEDITOR`)에 이미
   *  들어 있다 — 툴바에 노출만 하면 된다(별도 번들 로드 없음 = UMD 중복 로딩 위험 없음).
   *
   *  방어적으로 조립한다: 번들에 없는 플러그인은 해당 툴바 항목과 함께 건너뛰고
   *  경고를 남긴다(연속 구분자는 정리). 구분선(HorizontalLine)·이미지·표·미디어는
   *  댓글 맥락에서 제외.
   *
   *  코드블록의 언어 선택 드롭다운은 `codeBlock.languages` 를 Plain text 하나로
   *  제한한다 — 게시글 본문 에디터에 언어 선택 UI 가 없어 댓글도 맞춘다.
   * ================================================================ */

  function buildToolbar(CK) {
    // [툴바 항목, 필요 플러그인(없으면 항목 스킵)] — 구분자는 '|'
    var spec = [
      ['heading', CK.Heading],
      '|',
      ['bold', CK.Bold],
      ['italic', CK.Italic],
      ['strikethrough', CK.Strikethrough],
      ['code', CK.Code],
      '|',
      ['bulletedList', CK.List],
      ['numberedList', CK.List],
      '|',
      ['blockQuote', CK.BlockQuote],
      ['codeBlock', CK.CodeBlock],
      '|',
      ['link', CK.Link]
    ];

    var pluginSet = [CK.Essentials, CK.Paragraph];
    var seen = [];
    var missing = [];
    var items = [];

    for (var i = 0; i < spec.length; i++) {
      var e = spec[i];
      if (e === '|') {
        if (items.length && items[items.length - 1] !== '|') items.push('|');
        continue;
      }
      var name = e[0];
      var plugin = e[1];
      if (!plugin) {
        missing.push(name);
        continue;
      }
      if (seen.indexOf(plugin) < 0) {
        pluginSet.push(plugin);
        seen.push(plugin);
      }
      items.push(name);
    }
    // 꼬리 구분자 정리
    while (items.length && items[items.length - 1] === '|') items.pop();
    while (items.length && items[0] === '|') items.shift();

    if (missing.length) {
      logger.warn('CKEditor UMD 번들에 없는 플러그인 — 툴바에서 제외: ' + missing.join(', '));
    }

    var heading;
    if (CK.Heading) {
      // 댓글 맥락 — h1 은 페이지용이라 제외, h5/h6 은 거의 안 쓰임. H2/H3/H4 만.
      heading = {
        options: [
          { model: 'paragraph', title: t('editor.heading.paragraph', '본문'), class: 'ck-heading_paragraph' },
          { model: 'heading2', view: 'h2', title: t('editor.heading.h2', '제목 (큰)'), class: 'ck-heading_heading2' },
          { model: 'heading3', view: 'h3', title: t('editor.heading.h3', '제목 (중)'), class: 'ck-heading_heading3' },
          { model: 'heading4', view: 'h4', title: t('editor.heading.h4', '제목 (작은)'), class: 'ck-heading_heading4' }
        ]
      };
    }

    var codeBlock;
    if (CK.CodeBlock) {
      // 코드블록 언어 선택 UI 축소 — Plain text 하나만 남긴다. 게시글 본문
      // 에디터(sirsoft-ckeditor5)엔 언어 선택 UI 자체가 없어 댓글도 그에 맞춘다.
      // CKEditor CodeBlock 은 `languages` 가 비면 안 되므로 최소 1개(plaintext)는 유지 —
      // 드롭다운에 "Plain text" 하나만 떠서 선택 자체가 무의미해진다.
      // 새니타이저가 `<code>` 의 `class="language-*"` 를 어차피 제거하므로 렌더 결과는
      // 언어 무관하게 동일하다. 기존에 다른 언어로 저장된 댓글도 그대로 렌더된다.
      codeBlock = {
        languages: [
          { language: 'plaintext', label: t('editor.codeblock.plaintext', 'Plain text') }
        ]
      };
    }

    return { plugins: pluginSet, items: items, heading: heading, codeBlock: codeBlock };
  }

  /* ================================================================ *
   *  React 제어 textarea 값 되써넣기 (native setter + input 이벤트)
   * ================================================================ */

  var _nativeTextareaSetter = (function () {
    try {
      return Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    } catch (e) {
      return null;
    }
  })();

  function setTextareaValue(ta, value) {
    if (_nativeTextareaSetter) {
      _nativeTextareaSetter.call(ta, value);
    } else {
      ta.value = value;
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ================================================================ *
   *  에디터 → textarea 동기화 스케줄러 (디바운스 + 제출 직전 flush)
   *
   *  왜 디바운스인가: `change:data` 콜백에서 곧바로 `input` 이벤트를 디스패치하면,
   *  CKEditor 의 AutoLink 커맨드가 URL 을 링크로 바꾸는 `model.change()` 트랜잭션 도중
   *  (그 트랜잭션이 동기적으로 발화시킨 `change:data` 안에서) g7 코어의 상태 액션이
   *  중첩 실행되어 "Failed to execute action: setState" 토스트가 뜬다. 디스패치를
   *  짧게(50ms) 미뤄 CKEditor 트랜잭션 밖의 별도 태스크에서 실행되게 한다.
   *
   *  최신성 보장: 사용자가 타이핑 직후 바로 "등록" 을 눌러도 마지막 글자가 누락되지
   *  않도록, 제출 의도(문서 캡처 `pointerdown` / 에디터 밖 `keydown` / 에디터 blur)에
   *  대기 중인 동기화를 즉시 flush 한다. flush 는 CKEditor 트랜잭션 밖이라 안전하다.
   * ================================================================ */

  var SYNC_DEBOUNCE_MS = 50;

  /** 대기 타이머를 취소하고 지금 즉시 에디터 내용을 textarea 로 밀어넣는다. */
  function flushSyncNow(rec) {
    if (!rec) return;
    if (rec.syncTimer) {
      window.clearTimeout(rec.syncTimer);
      rec.syncTimer = null;
    }
    if (!rec.ta || !rec.ta.isConnected || !rec.editor) return;
    var clean;
    try {
      clean = sanitizeCommentHtml(rec.editor.getData());
    } catch (e) {
      return;
    }
    rec.selfWrite = true;
    try {
      setTextareaValue(rec.ta, clean);
    } catch (e) {
      /* 파괴 직전 레이스 — 무시 */
    }
    rec.lastSeenTaValue = rec.ta.value;
    rec.selfWrite = false;
  }

  /** change:data 마다 호출 — 이미 예약돼 있으면 그대로 두고(최대 50ms 지연), 발화 시 최신 내용을 읽는다. */
  function scheduleSync(rec) {
    if (!rec || rec.syncTimer) return;
    rec.syncTimer = window.setTimeout(function () {
      rec.syncTimer = null;
      flushSyncNow(rec);
    }, SYNC_DEBOUNCE_MS);
  }

  /** 대기 중인 모든 인스턴스의 동기화를 즉시 flush (제출 직전 등). */
  function flushAllPendingSync() {
    var list;
    try {
      list = document.querySelectorAll(TEXTAREA_SELECTOR);
    } catch (e) {
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var rec = instances.get(list[i]);
      if (rec && rec.syncTimer) flushSyncNow(rec);
    }
  }

  var _flushListenersBound = false;
  function bindFlushListeners() {
    if (_flushListenersBound) return;
    _flushListenersBound = true;
    // 캡처 단계 — 등록 버튼 클릭(그 click 을 처리하는 React 핸들러)보다 먼저 실행된다.
    document.addEventListener('pointerdown', flushAllPendingSync, true);
    document.addEventListener(
      'keydown',
      function (e) {
        var ae = document.activeElement;
        // 에디터 안에서 타이핑 중이면 디바운스에 맡긴다. 밖(버튼 포커스 등)에서의 키입력은 즉시 flush.
        if (ae && ae.closest && ae.closest('.ck-editor__editable')) return;
        flushAllPendingSync();
      },
      true
    );
  }

  /* ================================================================ *
   *  에디터 인스턴스 관리 (댓글 textarea 당 1개, 다중 인스턴스 OK)
   * ================================================================ */

  var instances = new WeakMap(); // textarea -> record

  function attachEditors(root) {
    var list = (root || document).querySelectorAll(TEXTAREA_SELECTOR);
    for (var i = 0; i < list.length; i++) attachOne(list[i]);
  }

  function attachOne(ta) {
    if (!ta || ta.__g7ceBusy || instances.has(ta)) return;
    if (!ta.isConnected) return;
    ta.__g7ceBusy = true;

    loadCKEditor()
      .then(function (CK) {
        if (!ta.isConnected || instances.has(ta)) {
          ta.__g7ceBusy = false;
          return;
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'g7ce-wrapper';
        var host = document.createElement('div');
        wrapper.appendChild(host);
        ta.parentNode.insertBefore(wrapper, ta.nextSibling);

        // 원본 textarea 는 값 동기화용으로 DOM 에 남기되 화면에서만 숨긴다
        ta.classList.add('g7ce-hidden-textarea');

        var tb = buildToolbar(CK);
        var config = {
          plugins: tb.plugins,
          toolbar: { items: tb.items },
          heading: tb.heading,
          codeBlock: tb.codeBlock,
          // Autoformat 은 일부러 넣지 않는다 — "> " → 인용구, "```" → 코드블록 같은
          // 입력 중 자동 변환을 켜지 않아 (자동링크 때 겪은) 상태 액션 경합 표면을
          // 늘리지 않는다. 툴바 버튼은 editor.execute() → 일반 change:data → 기존
          // scheduleSync(50ms 디바운스) 로 처리된다.
          link: {
            defaultProtocol: 'https://',
            decorators: {
              openInNewTab: {
                mode: 'automatic',
                callback: function (url) {
                  return /^https?:\/\//i.test(url || '');
                },
                attributes: { target: '_blank', rel: 'noopener noreferrer' }
              }
            }
          },
          placeholder: ta.getAttribute('placeholder') || t('editor.placeholder', ''),
          initialData: valueToEditorHtml(ta.value)
        };

        CK.ClassicEditor.create(host, config)
          .then(function (editor) {
            var rec = {
              editor: editor,
              wrapper: wrapper,
              ta: ta,
              lastEditorData: editor.getData(),
              lastSeenTaValue: ta.value,
              selfWrite: false,
              poller: null,
              syncTimer: null
            };
            instances.set(ta, rec);

            // 에디터 → textarea. `input` 디스패치는 CKEditor 트랜잭션 밖에서 돌도록 디바운스한다
            // (동기 디스패치 시 AutoLink 커맨드 도중 g7 상태 액션 중첩 → "setState" 토스트).
            editor.model.document.on('change:data', function () {
              rec.lastEditorData = editor.getData();
              scheduleSync(rec);
            });

            // 포커스가 에디터를 떠날 때(예: 등록 버튼 클릭) 대기 중 동기화를 즉시 반영.
            try {
              editor.editing.view.document.on('blur', function () {
                flushSyncNow(rec);
              });
            } catch (e) {
              /* 뷰 접근 불가 시 무시 — pointerdown/keydown 캡처가 백업 */
            }

            // textarea → 에디터 (등록 성공 후 _local 초기화, 수정폼 seed 등 외부 변경 감지)
            rec.poller = window.setInterval(function () {
              if (!ta.isConnected) {
                teardownOne(ta);
                return;
              }
              // 우리가 곧 밀어넣을 값이 대기 중이면 ta.value 는 아직 옛 값 → 외부 변경으로 오인 금지
              if (rec.selfWrite || rec.syncTimer) return;
              var v = ta.value;
              if (v === rec.lastSeenTaValue) return;
              rec.lastSeenTaValue = v;
              // 우리가 방금 밀어넣은 값과 같으면 무시
              var current = editor.getData();
              if (v === current || v === rec.lastEditorData) return;
              // 외부에서 바뀜 → 에디터 반영
              try {
                editor.setData(valueToEditorHtml(v));
                rec.lastEditorData = editor.getData();
              } catch (e) {
                /* 파괴 직전 레이스 — 무시 */
              }
            }, 350);

            ta.__g7ceBusy = false;
          })
          .catch(function (err) {
            logger.error('ClassicEditor.create 실패', err);
            ta.classList.remove('g7ce-hidden-textarea');
            try {
              wrapper.remove();
            } catch (e) {}
            ta.__g7ceBusy = false;
            notifyLoadFailure();
          });
      })
      .catch(function (err) {
        logger.error('CKEditor 로드 실패', err);
        ta.__g7ceBusy = false;
        notifyLoadFailure();
      });
  }

  function teardownOne(ta) {
    var rec = instances.get(ta);
    if (!rec) return;
    instances['delete'](ta);
    // 대기 중 동기화가 있으면 파괴 전에 마지막 값을 반영 (수정폼 등에서 내용 유실 방지)
    try {
      if (rec.syncTimer) flushSyncNow(rec);
    } catch (e) {}
    try {
      if (rec.poller) window.clearInterval(rec.poller);
    } catch (e) {}
    try {
      rec.editor.destroy();
    } catch (e) {}
    try {
      rec.wrapper.remove();
    } catch (e) {}
    try {
      ta.classList.remove('g7ce-hidden-textarea');
    } catch (e) {}
  }

  var _notifiedLoadFailure = false;
  function notifyLoadFailure() {
    if (_notifiedLoadFailure) return;
    _notifiedLoadFailure = true;
    logger.warn(t('editor.load_failed', 'Comment editor failed to load; falling back to plain textarea.'));
  }

  /* ================================================================ *
   *  외부 링크 렌더링 (SNS 임베드 · 이미지 · 자동 줄바꿈)
   *
   *  렌더 승격이 끝난(= 새니타이즈된) 댓글 본문을 후처리한다:
   *   - 한 블록에 단독으로 놓인 SNS 링크(YouTube/X/Instagram/TikTok) → 플랫폼 임베드
   *   - 이미지 확장자로 끝나는 URL → <img> (외부 핫링크, 업로드 아님)
   *   - 그 외 URL → <a> 로 링크화 + 자동 줄바꿈
   *  Facebook 은 프로젝트 방침상 임베드하지 않는다(일반 링크로 남음).
   *
   *  ★ 보안: 임베드 마크업은 사용자 입력을 절대 파싱하지 않는다. URL 에서 정규식으로
   *    ID(youtube=[\w-]{6,}, twitter/tiktok=\d+, instagram=[\w-]+) 만 뽑아 esc() 한 뒤,
   *    도메인이 하드코딩된 신뢰 임베드 URL 을 우리가 조립한다(embedMarkup 이 조립 결과를
   *    다시 정규식으로 재검증). g7-ckeditor5-superpack 의 SNS 임베드 패턴을 참고해
   *    독립 재구현했다 — 슈퍼팩 코드/자산을 import/require 하거나 런타임 로드하지 않는다.
   * ================================================================ */

  var EMBED_WRAP = 'g7ce-embed';
  var IMG_WRAP = 'g7ce-img';
  var IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp)(?:[?#][^\s]*)?$/i;
  var URL_TOKEN_RE = /https?:\/\/[^\s<>"'\]]+/gi;
  var SNS_LABEL = { youtube: 'YouTube', twitter: 'X', instagram: 'Instagram', tiktok: 'TikTok' };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function bareUrl(u) {
    return String(u).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  }

  function detectPlatform(rawUrl) {
    var u = bareUrl(rawUrl);
    if (/^(youtube\.com\/(watch\?|shorts\/|embed\/|live\/|v\/)|youtu\.be\/|m\.youtube\.com\/)/i.test(u)) return 'youtube';
    if (/^(twitter\.com|x\.com)\/[A-Za-z0-9_]{1,20}\/status(?:es)?\/\d+/i.test(u)) return 'twitter';
    if (/^instagram\.com\/(p|reel|reels|tv)\/[\w-]+/i.test(u)) return 'instagram';
    if (/^(?:vm|vt)\.tiktok\.com\/[\w.-]+/i.test(u) || /^tiktok\.com\/(@[\w.-]+\/video\/\d+|t\/|embed\/)/i.test(u)) return 'tiktok';
    return 'unknown';
  }

  function platformOn(cfg, platform) {
    return platform === 'youtube' ? cfg.embedYoutube
      : platform === 'twitter' ? cfg.embedTwitter
      : platform === 'instagram' ? cfg.embedInstagram
      : platform === 'tiktok' ? cfg.embedTiktok
      : false;
  }

  function youtubeId(rawUrl) {
    var u = bareUrl(rawUrl);
    var m = u.match(/^youtu\.be\/([\w-]{6,})/i)
      || u.match(/[?&]v=([\w-]{6,})/i)
      || u.match(/^(?:m\.)?youtube\.com\/(?:shorts|embed|live|v)\/([\w-]{6,})/i);
    return m ? m[1] : null;
  }

  /** 임베드용 정규 URL — 추적/동의 파라미터 제거. 실패 시 null. */
  function canonicalSnsUrl(rawUrl, platform) {
    var path = String(rawUrl).trim().split('#')[0].split('?')[0];
    var b = bareUrl(path), m;
    if (platform === 'twitter') {
      m = b.match(/^(twitter\.com|x\.com)\/([A-Za-z0-9_]{1,20})\/status(?:es)?\/(\d+)/i);
      return m ? 'https://' + m[1].toLowerCase() + '/' + m[2] + '/status/' + m[3] : null;
    }
    if (platform === 'instagram') {
      m = b.match(/^instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i);
      return m ? 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2] + '/' : null;
    }
    if (platform === 'tiktok') {
      m = b.match(/^tiktok\.com\/(@[\w.-]+)\/video\/(\d+)/i);
      return m ? 'https://www.tiktok.com/' + m[1] + '/video/' + m[2] : null;
    }
    if (platform === 'youtube') {
      var id = youtubeId(rawUrl);
      return id ? 'https://www.youtube.com/watch?v=' + id : null;
    }
    return null;
  }

  /* --- 외부 임베드 스크립트 로더 (X/IG/TikTok). YouTube 는 순수 iframe 이라 불필요. ---
   *  queueSnsProcess(platform): 스크립트 로드를 보장 + DOM 안착 후 재처리를 예약한다.
   *  임베드 노드를 DOM 에 넣은 "뒤에" 호출해야 한다(스크립트가 스캔 시점에 blockquote 를 봐야 함).
   *  슈퍼팩과 무관하게 우리 ID(g7ce-embed-*)로 로드한다. window.twttr/instgrm 은 라이브러리가
   *  전역에 심는 것이라 이미 있으면 재사용(스크립트 중복 로드 회피).
   */
  var SNS_SCRIPT = {
    twitter: {
      id: 'g7ce-embed-twitter', src: 'https://platform.twitter.com/widgets.js',
      ready: function () { return !!(window.twttr && window.twttr.widgets && window.twttr.widgets.load); },
      run: function () { window.twttr.widgets.load(); }
    },
    instagram: {
      id: 'g7ce-embed-instagram', src: 'https://www.instagram.com/embed.js',
      ready: function () { return !!(window.instgrm && window.instgrm.Embeds && window.instgrm.Embeds.process); },
      run: function () { window.instgrm.Embeds.process(); }
    },
    tiktok: {
      // embed.js 는 로드 시점에 1회 스캔만 하고 이후 재처리 API 가 없다 → 미변환 blockquote 가
      // 남아 있으면 스크립트를 재삽입한다.
      id: 'g7ce-embed-tiktok', src: 'https://www.tiktok.com/embed.js',
      ready: function () { return false; }, run: function () {}
    }
  };
  var _snsState = {}; // platform -> 'loading' | 'ready' | 'error'
  var _snsProcTimer = {};

  function loadSnsScript(platform) {
    var spec = SNS_SCRIPT[platform];
    if (!spec || spec.ready() || _snsState[platform] === 'loading') return;
    if (document.getElementById(spec.id)) { _snsState[platform] = 'ready'; return; }
    _snsState[platform] = 'loading';
    var s = document.createElement('script');
    s.id = spec.id;
    s.async = true;
    s.src = spec.src;
    s.onload = function () { _snsState[platform] = 'ready'; };
    s.onerror = function () {
      _snsState[platform] = 'error';
      logger.warn('임베드 스크립트 로드 실패 (' + platform + ') — 링크로 표시됩니다.');
    };
    (document.body || document.head).appendChild(s);
  }

  function tiktokPending() {
    var bqs = document.querySelectorAll('blockquote.tiktok-embed');
    for (var i = 0; i < bqs.length; i++) {
      if (!bqs[i].querySelector('iframe')) return true;
    }
    return false;
  }

  function reinjectTiktok() {
    if (!tiktokPending()) return;
    var spec = SNS_SCRIPT.tiktok;
    var old = document.getElementById(spec.id);
    if (old) old.remove();
    var s = document.createElement('script');
    s.id = spec.id;
    s.async = true;
    s.src = spec.src;
    (document.body || document.head).appendChild(s);
  }

  /** 임베드 노드를 DOM 에 넣은 뒤 호출 — 스크립트 로드 보장 + 재처리 예약(디바운스+재시도). */
  function queueSnsProcess(platform) {
    if (platform === 'youtube') return;
    loadSnsScript(platform);
    if (_snsProcTimer[platform]) return;
    var attempt = 0;
    var tick = function () {
      _snsProcTimer[platform] = null;
      if (platform === 'tiktok') {
        if (_snsState.tiktok === 'ready' || document.getElementById(SNS_SCRIPT.tiktok.id)) reinjectTiktok();
        else if (attempt < 40) { attempt++; _snsProcTimer[platform] = window.setTimeout(tick, 300); }
        return;
      }
      var spec = SNS_SCRIPT[platform];
      if (spec.ready()) {
        try { spec.run(); } catch (e) { logger.warn('임베드 처리 오류 (' + platform + ')', e); }
        return;
      }
      if (attempt < 40) { attempt++; _snsProcTimer[platform] = window.setTimeout(tick, 300); }
    };
    _snsProcTimer[platform] = window.setTimeout(tick, 120);
  }

  /* --- 임베드 마크업 (우리가 조립 · 사용자 입력 미파싱 · 조립 결과 재검증) --- */
  function snsFootLink(url, platform) {
    var tpl = t('content.view_on', '{platform}에서 보기');
    var lbl = SNS_LABEL[platform] ? tpl.replace('{platform}', SNS_LABEL[platform]) : t('content.open_link', '링크 열기');
    return '<span class="g7ce-embed__foot"><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(lbl) + '</a></span>';
  }

  function embedMarkup(platform, canonUrl, rawUrl) {
    if (platform === 'youtube') {
      var id = youtubeId(rawUrl);
      if (!id || !/^[\w-]{6,}$/.test(id)) return null;
      var shorts = /\/shorts\//i.test(rawUrl) ? ' g7ce-embed__yt--shorts' : '';
      return '<span class="g7ce-embed__yt' + shorts + '">'
        + '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(id) + '" title="YouTube video" '
        + 'loading="lazy" frameborder="0" '
        + 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
        + 'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></span>'
        + snsFootLink(canonUrl, platform);
    }
    if (platform === 'twitter') {
      if (!/^https:\/\/(twitter\.com|x\.com)\/[A-Za-z0-9_]{1,20}\/status\/\d+$/i.test(canonUrl)) return null;
      return '<blockquote class="twitter-tweet" data-dnt="true"><a href="' + esc(canonUrl) + '"></a></blockquote>'
        + snsFootLink(canonUrl, platform);
    }
    if (platform === 'instagram') {
      if (!/^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[\w-]+\/$/i.test(canonUrl)) return null;
      return '<blockquote class="instagram-media" data-instgrm-permalink="' + esc(canonUrl) + '" data-instgrm-version="14" '
        + 'style="max-width:540px;width:100%;margin:0 auto;"><a href="' + esc(canonUrl) + '"></a></blockquote>'
        + snsFootLink(canonUrl, platform);
    }
    if (platform === 'tiktok') {
      var tm = canonUrl.match(/\/video\/(\d+)$/);
      if (!tm) return null;
      return '<blockquote class="tiktok-embed" cite="' + esc(canonUrl) + '" data-video-id="' + esc(tm[1]) + '" '
        + 'style="max-width:605px;min-width:325px;margin:0 auto;"><a href="' + esc(canonUrl) + '"></a></blockquote>'
        + snsFootLink(canonUrl, platform);
    }
    return null;
  }

  /* --- DOM 요소 생성 --- */
  function makeLink(url) {
    var a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.className = 'g7ce-autolink';
    a.textContent = url;
    return a;
  }

  function makeImageBlock(url) {
    var wrap = document.createElement('div');
    wrap.className = IMG_WRAP;
    wrap.appendChild(makeImgEl(url));
    return wrap;
  }

  function makeImgEl(url) {
    var img = document.createElement('img'); // src 는 safeImgSrc 로 검증된 http(s) URL
    img.setAttribute('src', url);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    return img;
  }

  function makeEmbed(platform, rawUrl) {
    var canon = canonicalSnsUrl(rawUrl, platform);
    if (!canon) return null;
    var markup = embedMarkup(platform, canon, rawUrl);
    if (!markup) return null;
    var wrap = document.createElement('div');
    wrap.className = EMBED_WRAP;
    wrap.setAttribute('data-g7ce-embed', platform);
    wrap.innerHTML = markup; // 우리가 조립한 신뢰 마크업 (사용자 입력 아님)
    return wrap;
  }

  /** 블록 하나가 "단독 URL" 이면 그 URL 을, 아니면 null 을 반환. */
  function soleUrlOfBlock(block) {
    var elKids = [];
    for (var n = block.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if ((n.nodeValue || '').trim() !== '') { elKids = null; break; }
      } else if (n.nodeType === 1) {
        if (n.tagName === 'BR') continue;
        elKids.push(n);
      }
    }
    if (elKids && elKids.length === 1 && elKids[0].tagName === 'A') {
      var href = elKids[0].getAttribute('href') || '';
      var txt = (elKids[0].textContent || '').trim();
      if (/^https?:\/\//i.test(href) && (txt === href || txt === href.replace(/\/+$/, ''))) return href;
    }
    var only = (block.textContent || '').trim();
    if (/^https?:\/\/[^\s]+$/i.test(only) && !block.querySelector('*:not(br)')) return only;
    return null;
  }

  /**
   * 승격된 댓글 본문 <p data-g7ce="r"> 를 후처리해 외부 링크를 렌더한다.
   * 멱등: 이미 만든 래퍼(.g7ce-embed / .g7ce-img / a.g7ce-autolink)는 다시 안 건드린다.
   */
  function enrichComment(pEl, cfg) {
    if (!pEl || !pEl.querySelectorAll) return;

    var blocks = pEl.querySelectorAll(':scope > p, :scope > div, :scope > li');
    var list = blocks.length ? Array.prototype.slice.call(blocks) : [pEl];

    /* 1) 블록 단독 URL → SNS 임베드 / 이미지 / (일반이면 링크 유지). SNS 판정이 이미지보다 우선. */
    for (var bi = 0; bi < list.length; bi++) {
      var block = list[bi];
      if (block.closest('.' + EMBED_WRAP + ',.' + IMG_WRAP)) continue;
      if (block.querySelector && block.querySelector('.' + EMBED_WRAP + ',.' + IMG_WRAP + ',a.g7ce-autolink')) continue;
      var raw = soleUrlOfBlock(block);
      if (!raw) continue;

      var platform = detectPlatform(raw);
      var repl = null;
      if (platform !== 'unknown' && platformOn(cfg, platform)) {
        repl = makeEmbed(platform, raw);
      }
      if (!repl && platform === 'unknown' && cfg.renderImage && IMAGE_EXT_RE.test(raw) && safeImgSrc(raw)) {
        repl = makeImageBlock(raw);
      }
      if (!repl) {
        // 일반 URL(또는 임베드 실패): <a> 보장 + 자동 줄바꿈.
        var firstEl = block.firstElementChild;
        if (firstEl && firstEl.tagName === 'A') {
          firstEl.classList.add('g7ce-autolink');
          firstEl.setAttribute('target', '_blank');
          firstEl.setAttribute('rel', 'noopener noreferrer');
        } else if (block === pEl) {
          pEl.innerHTML = '';
          pEl.appendChild(makeLink(raw));
        } else {
          block.textContent = '';
          block.appendChild(makeLink(raw));
        }
        continue;
      }
      if (block === pEl) { pEl.innerHTML = ''; pEl.appendChild(repl); }
      else block.replaceWith(repl);
      // 임베드 노드가 DOM 에 안착한 "뒤"에 스크립트 로드/재처리를 예약한다.
      if (repl.classList && repl.classList.contains(EMBED_WRAP)) {
        queueSnsProcess(repl.getAttribute('data-g7ce-embed'));
      }
    }

    /* 2) 인라인 URL(문장 속) → 링크화(자동 줄바꿈), 이미지 확장자면 <img>. */
    var walker = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT, null);
    var textNodes = [];
    var tn;
    while ((tn = walker.nextNode())) {
      var val = tn.nodeValue || '';
      if (val.indexOf('http') < 0 || !/https?:\/\//i.test(val)) continue;
      if (tn.parentNode && tn.parentNode.closest('a,.' + EMBED_WRAP + ',.' + IMG_WRAP)) continue;
      textNodes.push(tn);
    }
    for (var ti = 0; ti < textNodes.length; ti++) linkifyTextNode(textNodes[ti], cfg);
  }

  function linkifyTextNode(node, cfg) {
    var text = node.nodeValue;
    URL_TOKEN_RE.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var last = 0, m, any = false;
    while ((m = URL_TOKEN_RE.exec(text))) {
      var url = m[0].replace(/[.,;:!?)\]]+$/, ''); // 문장부호 꼬리 제외
      if (url.length < 8) continue;
      var start = m.index;
      any = true;
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
      if (cfg.renderImage && detectPlatform(url) === 'unknown' && IMAGE_EXT_RE.test(url) && safeImgSrc(url)) {
        var im = makeImgEl(url);
        im.className = 'g7ce-img-inline';
        frag.appendChild(im);
      } else {
        frag.appendChild(makeLink(url));
      }
      last = start + url.length;
    }
    if (!any) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  /* ================================================================ *
   *  저장 HTML 댓글 렌더 승격
   *
   *  sirsoft-basic 댓글 본문 노드: <p class="text-gray-700 dark:text-gray-300">…</p>
   *  (읽기 모드 / 삭제·블라인드 "원문 보기" 펼침 포함). 엔진이 text 바인딩으로 그려
   *  HTML 이 이스케이프되어 있으므로, textContent 를 새니타이즈해 innerHTML 로 승격한다.
   * ================================================================ */

  var HTMLISH = /<(p|br|strong|b|em|i|u|s|ul|ol|li|a|img|blockquote|pre|code|h[1-6])\b[^>]*>[\s\S]*<\/(p|strong|b|em|i|u|s|ul|ol|li|a|blockquote|pre|code|h[1-6])>|<(br|img)\b[^>]*\/?>/i;
  var HAS_URL = /\bhttps?:\/\/[^\s<>"']+/i;

  function upgradeRenderedComments(root) {
    var cfg = readSettings();
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll('p.text-gray-700');
    for (var i = 0; i < nodes.length; i++) {
      var p = nodes[i];

      var cls = p.getAttribute('class') || '';
      if (cls.indexOf('dark:text-gray-300') < 0) continue; // 댓글 본문 클래스 조합만

      // 우리가 승격 + 외부링크 후처리까지 끝냈고 렌더 자식이 살아있으면 완전 스킵.
      if (p.getAttribute('data-g7ce-x') === '1' && p.children.length > 0) continue;

      // 승격은 됐으나(구버전 포함) 외부링크 후처리는 안 된 상태 + 자식 살아있음
      //  → 재승격 없이 enrich 만 얹는다(서식 보존).
      if (p.getAttribute('data-g7ce') === 'r' && p.children.length > 0) {
        try { enrichComment(p, cfg); } catch (e) { logger.error('enrichComment 오류', e); }
        p.setAttribute('data-g7ce-x', '1');
        continue;
      }

      // 우리가 만든 자식이 아니고(다른 코드가 넣은 엘리먼트) 자식이 있으면 손대지 않는다.
      if (p.children.length > 0) continue;

      // 여기부터: 자식 0 (엔진이 text 바인딩으로 그린 직후, 또는 자가치유 재진입).
      var raw = p.textContent;
      if (!raw || raw.length > 20000) continue;

      var htmlish = HTMLISH.test(raw);
      var hasUrl = HAS_URL.test(raw);
      if (!htmlish && !hasUrl) continue; // 순수 텍스트(URL 없음) 댓글은 그대로 둔다

      var clean = looksLikeHtml(raw) ? sanitizeCommentHtml(raw) : plainTextToHtml(raw);
      if (!clean) continue;

      // 이미 이 HTML 로 렌더돼 있고 후처리도 끝났으면(재실행) 아무것도 안 함.
      if (clean === p.innerHTML && p.getAttribute('data-g7ce-x') === '1') continue;

      p.innerHTML = clean;
      p.setAttribute('data-g7ce', 'r');
      try { enrichComment(p, cfg); } catch (e) { logger.error('enrichComment 오류', e); }
      p.setAttribute('data-g7ce-x', '1');
    }
  }

  /* ================================================================ *
   *  스타일
   * ================================================================ */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.g7ce-hidden-textarea{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important;}',
      '.g7ce-wrapper{margin-top:.25rem;}',
      '.g7ce-wrapper .ck-editor__editable{min-height:96px;}',
      '.g7ce-wrapper .ck.ck-editor__main>.ck-editor__editable{border-radius:.5rem;}',
      // 승격된 댓글 본문 — Tailwind preflight 로 죽은 목록 마커/링크 스타일 복구
      'p[data-g7ce="r"]{white-space:normal;}',
      'p[data-g7ce="r"] ul{list-style:disc;padding-left:1.5em;margin:.25em 0;}',
      'p[data-g7ce="r"] ol{list-style:decimal;padding-left:1.5em;margin:.25em 0;}',
      'p[data-g7ce="r"] li{margin:.125em 0;}',
      'p[data-g7ce="r"] a{color:#2563eb;text-decoration:underline;}',
      'html.dark p[data-g7ce="r"] a{color:#60a5fa;}',
      'p[data-g7ce="r"] strong,p[data-g7ce="r"] b{font-weight:600;}',
      'p[data-g7ce="r"] p{margin:.25em 0;}',
      // 툴바 확장 — 인용구·코드·제목·취소선(승격된 본문). sirsoft-ckeditor5 .ck-content 스타일 참고, 필요한 만큼만.
      'p[data-g7ce="r"] blockquote{border-left:3px solid #d1d5db;padding:.1em 0 .1em .9em;margin:.4em 0;color:#4b5563;}',
      'html.dark p[data-g7ce="r"] blockquote{border-left-color:#4b5563;color:#9ca3af;}',
      'p[data-g7ce="r"] pre{background:#f3f4f6;border-radius:6px;padding:.6em .8em;margin:.4em 0;overflow-x:auto;font-size:.9em;line-height:1.45;}',
      'html.dark p[data-g7ce="r"] pre{background:#1f2937;}',
      'p[data-g7ce="r"] pre code{display:block;background:transparent;padding:0;border:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;color:inherit;}',
      'p[data-g7ce="r"] code{background:#f3f4f6;border-radius:4px;padding:.1em .35em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;}',
      'html.dark p[data-g7ce="r"] code{background:#374151;}',
      'p[data-g7ce="r"] h2{font-size:1.3em;font-weight:700;line-height:1.3;margin:.55em 0 .3em;}',
      'p[data-g7ce="r"] h3{font-size:1.15em;font-weight:700;line-height:1.3;margin:.5em 0 .3em;}',
      'p[data-g7ce="r"] h4{font-size:1.02em;font-weight:700;line-height:1.3;margin:.45em 0 .3em;}',
      'p[data-g7ce="r"] s{text-decoration:line-through;}',
      // 에디터 안(.ck-content) — CKEditor 기본 CSS 로 대부분 커버되나 스코프 보정
      '.g7ce-wrapper .ck-content blockquote{border-left:3px solid #d1d5db;}',
      '.g7ce-wrapper .ck-content pre{max-width:100%;overflow-x:auto;}',
      // 외부 링크 렌더링 — 자동 줄바꿈(긴 URL 이 레이아웃 안 깨도록)
      'p[data-g7ce="r"]{overflow-wrap:anywhere;}',
      'p[data-g7ce="r"] a.g7ce-autolink{word-break:break-all;overflow-wrap:anywhere;}',
      // 이미지 (외부 핫링크)
      '.g7ce-img{display:block;margin:.5em 0;}',
      '.g7ce-img>img{max-width:100%;height:auto;border-radius:6px;display:block;}',
      'img.g7ce-img-inline{max-width:100%;height:auto;border-radius:6px;vertical-align:middle;}',
      // SNS 임베드
      '.g7ce-embed{display:block;margin:.7em 0;max-width:100%;text-align:center;}',
      '.g7ce-embed__yt{position:relative;display:block;width:100%;max-width:560px;margin:0 auto;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;}',
      '.g7ce-embed__yt--shorts{max-width:280px;aspect-ratio:9/16;}',
      '.g7ce-embed__yt>iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}',
      '.g7ce-embed>iframe,.g7ce-embed .twitter-tweet,.g7ce-embed blockquote{margin-left:auto!important;margin-right:auto!important;}',
      '.g7ce-embed blockquote{border:0!important;background:transparent!important;}',
      '.g7ce-embed__foot{display:block;margin-top:.45em;line-height:1;text-align:center;}',
      '.g7ce-embed__foot a{display:inline-block;padding:4px 13px;border-radius:9999px;font-size:.78rem;font-weight:600;text-decoration:none!important;background:#e5e7eb;color:#1f2937!important;}',
      '.g7ce-embed__foot a:hover{background:#d1d5db;}',
      'html.dark .g7ce-embed__foot a{background:#374151;color:#f3f4f6!important;}',
      'html.dark .g7ce-embed__foot a:hover{background:#4b5563;}'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ================================================================ *
   *  스캔 + SPA 대응
   * ================================================================ */

  function scan(root) {
    try {
      attachEditors(root);
    } catch (e) {
      logger.error('attachEditors 오류', e);
    }
    try {
      upgradeRenderedComments(root);
    } catch (e) {
      logger.error('upgradeRenderedComments 오류', e);
    }
  }

  var _rescanTimer = null;
  function scheduleRescan() {
    if (_rescanTimer) return;
    _rescanTimer = window.setTimeout(function () {
      _rescanTimer = null;
      scan(document);
    }, 80);
  }

  function startObserver() {
    if (!document.body) return;
    var mo = new MutationObserver(function (mutations) {
      var added = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.removedNodes && m.removedNodes.length) {
          for (var j = 0; j < m.removedNodes.length; j++) {
            var rn = m.removedNodes[j];
            if (rn.nodeType !== 1) continue;
            if (rn.matches && rn.matches(TEXTAREA_SELECTOR)) teardownOne(rn);
            if (rn.querySelectorAll) {
              var inner = rn.querySelectorAll(TEXTAREA_SELECTOR);
              for (var k = 0; k < inner.length; k++) teardownOne(inner[k]);
            }
          }
        }
        if (m.addedNodes && m.addedNodes.length) added = true;
      }
      if (added) scheduleRescan();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ================================================================ *
   *  부트
   * ================================================================ */

  function boot() {
    if (!readSettings().enabled) {
      logger.log('비활성화됨 (설정) — 건너뜀');
      return;
    }
    injectStyle();
    bindFlushListeners();
    scan(document);
    startObserver();
    // SPA 하이드레이션 타이밍 대비 지연 재스캔
    [250, 800, 2000].forEach(function (d) {
      window.setTimeout(function () {
        scan(document);
      }, d);
    });
    logger.log('초기화 완료');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 디버그 훅
  if (typeof window !== 'undefined') {
    window.__G7CommentEditor = {
      identifier: IDENTIFIER,
      rescan: function () {
        scan(document);
      },
      sanitize: sanitizeCommentHtml,
      detectPlatform: detectPlatform,
      canonicalSnsUrl: canonicalSnsUrl
    };
  }
})();
