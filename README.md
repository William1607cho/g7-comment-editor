# g7-comment-editor

[![Release](https://img.shields.io/github/v/release/William1607cho/g7-comment-editor?sort=semver)](https://github.com/William1607cho/g7-comment-editor/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A standalone [Gnuboard7](https://sir.kr/) plugin that mounts **CKEditor 5** on the
comment / reply / comment-edit textareas of `sirsoft-board`, so visitors can write
comments with basic rich-text formatting instead of plain text.

`sirsoft-board`, `sirsoft-ckeditor5` and the visitor template (`sirsoft-basic`) are
**never modified**. One globally-loaded script (`loading.strategy: "global"`) swaps
comment textareas for an editor and upgrades stored HTML comments on the visitor page
through an allow-list sanitizer. Since 1.2.0 the same allow-list is also enforced
**on the server** right before a comment is stored, through `sirsoft-board`'s comment
input hooks.

- **[사용법 (한국어) 아래로 이동](#사용법-한국어)**

## How it works

1. **Editor mount.** The script finds the comment / reply / comment-edit
   `<textarea>` elements and replaces each with a CKEditor 5 `ClassicEditor`.
   The toolbar matches the Gnuboard7 post-body editor (`sirsoft-ckeditor5`)
   exactly, minus image upload: **heading (Paragraph / Heading 1-3) · bold ·
   italic · underline · strikethrough · alignment · link · block quote ·
   bulleted list · numbered list · indent/outdent · table**. Heading options
   are CKEditor 5's own defaults (same `<h2>`/`<h3>`/`<h4>` mapping as the
   post-body editor), and the UI translation for the current locale is loaded
   so labels match it as well. Every plugin these buttons need is already
   inside the CKEditor 5 UMD single-package bundle that `sirsoft-ckeditor5`
   serves same-origin, so nothing extra is loaded — the toolbar just exposes
   what is there. `buildToolbar()` assembles defensively: a plugin that is
   somehow missing from the bundle is skipped together with its toolbar item
   and a warning is logged. The table's own contextual toolbar is
   intentionally reduced to add/remove column/row — no cell merging, no
   per-cell or per-table style editor — to keep the sanitizer's attack
   surface small (see Security below).

   The original textarea stays in the DOM (hidden) so the editor can write its value
   back and dispatch an `input` event, keeping the existing submit / save flow in
   sync. That dispatch is debounced by 50 ms — dispatching synchronously inside a
   CKEditor command / autolink transaction would re-enter the template engine's state
   queue. Pending sync is flushed immediately on submit intent (document-capture
   `pointerdown`, a keystroke outside the editor, editor blur) so the last character
   is never lost. Reply and edit forms each run as an independent instance.

   `Autoformat` is deliberately **not** enabled — there is no "type `>` to get a
   block quote" behaviour, which keeps the input path free of the state-queue
   re-entrancy that inline typed-URL autolinking once hit.

2. **Stored-HTML render upgrade.** `sirsoft-basic` renders the comment body with a
   `text` binding, so raw HTML shows up as escaped tags. The script scans the
   rendered body and promotes it to real formatting through a **whitelist-rebuild
   sanitizer** — allowed tags are
   `p br strong b em i u s ul ol li a[href] img[src][alt] blockquote h1–h6 table thead tbody tr th td`,
   everything else (tag, all attributes, event handlers) is dropped. Most allowed
   tags carry **zero attributes**: `walk()` rebuilds each element with
   `createElement` and copies only whitelisted attributes, so `class`, `id` and
   `on*` never survive anywhere. The one exception is `<p>`/`<h1>`–`<h6>`, which
   may keep a `style` attribute — but only after it is rebuilt from scratch: every
   declaration is parsed and only `text-align: left|right|center|justify` and
   `margin-left`/`margin-right: 0–800px` (from the alignment and indent/outdent
   buttons) survive, so a `style` attribute is never copied verbatim. `<pre>`,
   `<code>` (from a removed earlier release) and CKEditor's own `<figure>` table
   wrapper are not in the allow-list, but they are **unwrapped** rather than
   dropped outright — their children (plain text, or the `<table>` itself) join
   the parent, so a comment written with the old code-block feature keeps its
   text instead of vanishing. Text nodes go through `createTextNode`.

3. **External-link rendering.** After the sanitize pass the promoted body is
   post-processed so a URL that was pasted as plain text becomes visual content
   (no upload involved):

   - **SNS embeds** (only a link alone on its own block): YouTube, X / Twitter,
     Instagram, TikTok. **Facebook is excluded** — it stays a plain link. YouTube
     uses a `youtube-nocookie.com` iframe; the others upgrade a `<blockquote>` with
     the platform's official widget script.
   - **Image URLs** (http/https ending in `.jpg .jpeg .png .gif .webp .avif .bmp`)
     become an `<img>` hot-link (`loading="lazy"`, `referrerpolicy="no-referrer"`,
     `max-width:100%`). A broken link just falls back to the browser default.
   - **Any other URL** is linkified as a plain `<a>` with `overflow-wrap:anywhere`
     word-breaking (long URLs never break the layout). It is **not** turned into a
     card.
   - SNS detection wins over image detection. Each platform and the image renderer
     can be turned off individually via plugin settings
     (`window.G7Config.plugins['g7-comment-editor']`:
     `embed_youtube`, `embed_twitter`, `embed_instagram`, `embed_tiktok`,
     `render_image` — all on by default).
   - The SNS-embed pattern was **re-implemented independently** after studying
     `g7-ckeditor5-superpack`; this plugin does not depend on it or load its code.

## Requirements

- Gnuboard7 `>= 7.0.10`
- Plugin `sirsoft-ckeditor5 >= 1.0.3` — **a dependency.** CKEditor 5 (UMD) and its
  CSS are bundled and served same-origin by `sirsoft-ckeditor5`; this plugin reuses
  those assets.
  - ⚠️ The CKEditor UMD is loaded with the **same script id `ckeditor5_script`**
    that the `sirsoft-ckeditor5` layout (`html-editor.json` `scripts[]`) uses, via
    the core asset loader (`G7Core.asset.loadScript`). Injecting a raw `<script>`
    with a different id makes the core layout loader inject `ckeditor5.umd.js` a
    second time on the write / edit screen → `ckeditor-duplicated-modules` → the
    post-body editor breaks. If `sirsoft-ckeditor5` ever changes that id, change
    `CKE_JS_ID` here to match.

## Installation

### From GitHub (CLI)

```bash
# install the dependency first, if it isn't already
php artisan plugin:install sirsoft-ckeditor5
php artisan plugin:activate sirsoft-ckeditor5

# drop this repo into plugins/g7-comment-editor of your Gnuboard7 site, then:
php artisan plugin:install g7-comment-editor
php artisan plugin:activate g7-comment-editor
php artisan cache:clear
```

### From the admin UI

Admin → Plugins → g7-comment-editor → Install → Activate. The install modal offers
to install `sirsoft-ckeditor5` alongside if it is missing.

## Security (XSS)

Comment HTML is sanitized in **two layers** that share one allow-list
(`resources/sanitize-policy.json`):

1. **Server, before storing (1.2.0).** `CommentSanitizeListener` hooks into
   `sirsoft-board`'s comment input filters and rebuilds the HTML in PHP
   (`CommentHtmlSanitizer`) before it reaches the database — so a comment POSTed
   straight to the API, bypassing the browser editor, is stored clean too.
2. **Browser, before submitting and when rendering** (`sanitizeCommentHtml`).
   `sirsoft-basic` escapes comment bodies; this plugin un-escapes them during the
   render upgrade, and re-sanitizes every time.

**The browser layer is not redundant and must not be removed.** The server layer only
covers comments written or edited from 1.2.0 on. The render-time pass is the last line
of defence for whatever is *already* in the database — comments stored before 1.2.0,
rows changed directly in the database, or a future gap in the server policy.

Both layers apply the same rules:

- Tags outside the allow-list (`script style iframe object embed div span`, …) are
  **removed together with their children**.
- All attributes are removed, except: `<a>` `href` (only `http(s)`, `//`, `/`, `#`,
  `mailto:`), `target="_blank"`, a forced `rel="noopener noreferrer"`; `<img>` `src`
  (only an absolute `http(s)://` URL) and `alt`, with forced `loading="lazy"` and
  `referrerpolicy="no-referrer"`.
- `blockquote table thead tbody tr th td h1–h6` allow **no attributes at all** —
  `class`, `style`, `id`, `colspan`/`rowspan` are all dropped.
- `<p>` and `<h1>`–`<h6>` allow a `style` attribute, but never verbatim: each
  `property: value` declaration is parsed independently and only
  `text-align: left|right|center|justify` and `margin-left`/`margin-right`
  (digits + `px`, capped at 800) pass through. Anything else — colors,
  `position`, `expression(...)`, `url(javascript:...)`, a declaration crafted to
  break out of the attribute — is dropped, one declaration at a time, with no
  path to smuggle a raw string into the output.
- `on*` handler attributes are never in the allow-list, so they are always removed.
- Parsing uses `DOMParser` in the browser (inert document — scripts do not run) and
  libxml in PHP. Neither copies nodes or attributes over: output is rebuilt from
  allowed elements, validated attributes and escaped text only.

### Server-side sanitizing (1.2.0)

- **Hooks** (priority 1000, i.e. last): `sirsoft-board.comment.store_validation_rules`
  / `update_validation_rules` add two rules to `content`; `filter_create_data` /
  `filter_update_data` replace `content` with the sanitized result. User and admin
  endpoints share these request classes and the same service, so every write path is
  covered.
- **Empty after sanitizing → 422.** Core validation (`required`, `min`, `max`, blocked
  keywords) runs on the *raw* input, before sanitizing. So the plugin re-checks the
  sanitized result: it is rejected if nothing visible is left (no non-whitespace text
  and no image), or if it is shorter than the board's `min_comment_length`. This also
  rejects a whitespace-only comment such as `<p>&nbsp;</p>`, which was accepted before
  1.2.0. `max` is not re-checked — sanitizing can add a few characters
  (`rel="noopener noreferrer"`, escaping) that are not the writer's fault.
- **Input kinds**, matching the browser's own decision:
  - contains an allowed tag (`looksLikeHtml`) → allow-list sanitizing;
  - no allowed tag, but `<` followed by a letter, `/`, `!` or `?` (e.g.
    `<script>alert(1)</script>`) → treated as plain text and stored as escaped
    `<p>`/`<br>` HTML, so a payload that avoids every allowed tag does not reach the
    database verbatim (it still shows as the same literal text);
  - anything else → stored unchanged (plain text from the fallback textarea).
- **Editor output is stored byte-for-byte unchanged.** The PHP serializer mirrors the
  browser's `innerHTML` (escaping, `&nbsp;`, attribute order), and the regexes mirror
  JS semantics (`\s`/`trim()` whitespace set, `.` and anchors).
- Existing comments are **not migrated**; they are still protected by the render-time
  pass.

### Maintaining the allow-list

`resources/sanitize-policy.json` is the single source. The PHP sanitizer reads it at
runtime; the browser sanitizer carries a generated copy (`ALLOWED_TAGS` /
`UNWRAP_TAGS`, between the `@sanitize-policy` markers in `resources/js/index.js`).
After editing the JSON:

```bash
php scripts/sync-policy.php          # regenerate the JS copy, sync dist/
php scripts/sync-policy.php --check  # verify: generated block, dist == source, rule literals
```

`--check` also compares the browser's rule literals (`safeHref`, `safeImgSrc`,
`safeBlockStyle`, `looksLikeHtml`, `HTMLISH`) against the JSON — those functions are
not generated, so a change to a rule means editing both the JSON and the function,
and `--check` fails until they agree. Run it before building a release archive.

### Embed security

`<iframe>` / `<blockquote class="twitter-tweet">` and similar embed markup is **not**
in the sanitizer allow-list. It is built by `enrichComment()` on top of a DOM that
already passed the sanitizer. Embed URLs are never parsed from user input: an **id**
is extracted from the URL by regex (`youtube` `[\w-]{6,}`, `twitter` / `tiktok`
`\d+`, `instagram` `[\w-]+`) and a trusted embed URL is assembled from a
**hard-coded** domain (`youtube-nocookie.com` / `x.com` / `instagram.com` /
`tiktok.com`), then the assembled result is re-validated by regex. There is no code
path that produces an arbitrary-domain iframe.

Deactivating the plugin stops the render upgrade and the server-side sanitizing —
comments go back to escaped text and the input goes back to a plain textarea. Values
already stored sanitized stay as they are.

## Known limitations

- **No image upload.** Images are only rendered from external URLs pasted as text
  (hot-linking). There is no image button on the toolbar — this is the only
  toolbar difference from the post-body editor.
- **No code block or inline code** on the toolbar (removed in 1.1.0) — the
  post-body editor doesn't have them either, so this release drops them for
  parity. Existing comments written with them still render (as plain text,
  unwrapped — see above), no migration needed.
- **No cell merging or per-cell/table style editing** for tables — only
  insert-table and add/remove column/row, to keep the sanitizer's `style`
  allow-list minimal. Headings are limited to **Heading 1-3** (page-level H1
  is excluded, same as the post-body editor).
- **No media embed or horizontal rule** on the toolbar — out of scope for a
  comment.
- **No OpenGraph link cards.** External-link rendering covers SNS embeds + image
  URLs + word-breaking only.
- SNS embeds load each platform's official widget script from an external domain —
  the site's CSP (if any) must allow those domains.
- The comment body shares the board's `max_comment_length` limit (default 1000),
  and HTML markup counts toward the length.
- No routes, migrations or settings tables. Server-side code is one hook listener
  (sanitizing, 1.2.0); everything else is one global script.
- Server-side parsing uses libxml's HTML4 parser (PHP 8.2 has no HTML5 parser), while
  the browser uses HTML5. For editor output the stored value is identical; for
  hand-crafted API input the two can place content slightly differently (e.g. the
  browser adds `<tbody>` to a table), but only allowed, validated markup is ever
  emitted, so this affects layout, not safety.
- Extremely deeply nested HTML (beyond libxml's parser depth limit, about 256 levels)
  can sanitize to nothing on the server and is then rejected with 422.

## <a name="사용법-한국어"></a>사용법 (한국어)

`sirsoft-board` 의 댓글·답글·댓글수정 입력창은 기본이 순수 텍스트 `<textarea>` 입니다.
이 플러그인은 **sirsoft-board · sirsoft-ckeditor5 · 방문자 템플릿(sirsoft-basic) 을 전혀
수정하지 않고**, 전 페이지에 로드되는 스크립트 하나로 그 입력창을 CKEditor 5 로 바꾸고,
저장된 HTML 댓글을 방문자 화면에서 허용 태그만 남겨 렌더합니다.

**툴바**: 게시글 본문 에디터(sirsoft-ckeditor5)와 이미지 업로드만 빼고 완전히 동일합니다 —
제목(문단/제목1/제목2/제목3) · 굵게 · 기울임 · 밑줄 · 취소선 · 정렬 · 링크 · 인용구 ·
글머리표 목록 · 번호 목록 · 들여쓰기/내어쓰기 · 표(칸/행 추가·삭제만, 셀 병합·스타일 편집 없음).
제목 옵션은 CKEditor5 기본값 그대로라 본문과 태그·라벨이 동일하고, 에디터 UI 번역도
현재 로케일로 로드됩니다. 인라인 코드·코드블록은 1.1.0 에서 제거했습니다(본문에 없던
기능). 이미지 업로드·미디어·구분선은 없습니다.

**외부 링크 렌더링**: 댓글에 텍스트로 붙여넣은 URL 을 렌더 시점에 시각 콘텐츠로 바꿉니다.
한 블록에 단독으로 놓인 링크만 SNS 임베드(YouTube · X · Instagram · TikTok,
**Facebook 제외**), 이미지 확장자 URL 은 `<img>` 핫링크, 그 외 URL 은 카드화 없이 링크화 +
자동 줄바꿈. 플랫폼별·이미지 개별 on/off 는 플러그인 설정으로 조정합니다.

**보안**: 정제는 두 층이고 허용 목록(`resources/sanitize-policy.json`)을 함께 씁니다.
1.2.0 부터 **서버**가 댓글 저장 직전에 PHP 로 한 번 정제하므로(sirsoft-board 댓글 입력 훅),
API 로 직접 POST 한 댓글도 DB 에는 정제본만 남습니다. 정제 뒤 보이는 내용이 없으면(공백만 있는
`<p>&nbsp;</p>` 포함) 422 로 거부합니다. **브라우저**는 제출 직전과 화면에 그릴 때 다시 정제합니다.
렌더 시 정제는 DB 에 이미 들어가 있는 것(1.2.0 이전 댓글 등)에 대한 마지막 방어선이라
**서버 정제가 있어도 제거하지 않습니다**(중복이 아니라 방어 계층). 허용 목록을 고치면
`php scripts/sync-policy.php` 후 `--check` 로 확인합니다. 허용 태그 외 전부 제거, `blockquote/table 계열/h1~h6` 는 속성
허용 0, `on*`·`javascript:`·임의 도메인 iframe 은 생성 경로가 없습니다. `p`/`h1~h6` 의
`style` 만 예외적으로 허용하되 통짜 복사가 아니라 `text-align`(4개 키워드)·
`margin-left/right`(0~800px 숫자)만 값까지 검증해 재조립합니다 — 그 외 프로퍼티/값은
전부 버려집니다. 폐지된 `pre`/`code`, CKEditor 표 래퍼 `figure` 는 통째로 버리지 않고
태그만 벗겨 텍스트/표 본체는 보존합니다(기존 코드블록 댓글도 텍스트로 남음).

**설치**: 의존 플러그인 `sirsoft-ckeditor5 (>= 1.0.3)` 를 먼저 설치·활성화한 뒤 이 저장소를
`plugins/g7-comment-editor/` 에 두고 `php artisan plugin:install g7-comment-editor` →
`plugin:activate g7-comment-editor` → `cache:clear`. 관리자 UI 설치도 지원합니다.

## Acknowledgments

- CKEditor 5 — © CKSource, GPL-2.0-or-later. Bundled and served by
  `sirsoft-ckeditor5`; this plugin only references those assets.
- The SNS-embed approach was studied from `g7-ckeditor5-superpack` and
  re-implemented from scratch; no code is copied and there is no runtime dependency.

## License

MIT © 2026 William Cho. See [LICENSE](LICENSE).
