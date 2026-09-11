# g7-comment-editor

[![Release](https://img.shields.io/github/v/release/William1607cho/g7-comment-editor?sort=semver)](https://github.com/William1607cho/g7-comment-editor/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A standalone [Gnuboard7](https://sir.kr/) plugin that mounts **CKEditor 5** on the
comment / reply / comment-edit textareas of `sirsoft-board`, so visitors can write
comments with basic rich-text formatting instead of plain text.

`sirsoft-board`, `sirsoft-ckeditor5` and the visitor template (`sirsoft-basic`) are
**never modified**. Everything is done by one globally-loaded script
(`loading.strategy: "global"`) that swaps comment textareas for an editor and
upgrades stored HTML comments on the visitor page through an allow-list sanitizer.

- **[사용법 (한국어) 아래로 이동](#사용법-한국어)**

## How it works

1. **Editor mount.** The script finds the comment / reply / comment-edit
   `<textarea>` elements and replaces each with a CKEditor 5 `ClassicEditor`.
   Toolbar: **heading (H2 / H3 / H4) · bold · italic · strikethrough · inline code ·
   bulleted list · numbered list · block quote · code block · link**. Every plugin
   these buttons need is already inside the CKEditor 5 UMD single-package bundle that
   `sirsoft-ckeditor5` serves same-origin, so nothing extra is loaded — the toolbar
   just exposes what is there. `buildToolbar()` assembles defensively: a plugin that
   is somehow missing from the bundle is skipped together with its toolbar item and a
   warning is logged.

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
   `p br strong b em i u s ul ol li a[href] img[src][alt] blockquote pre code h1–h6`,
   everything else (tag, all attributes, event handlers) is dropped. `blockquote`,
   `pre`, `code` and `h1–h6` allow **zero attributes**: `walk()` rebuilds each
   element with `createElement` and copies only whitelisted attributes, so `class`
   (e.g. a code block's `language-*`), `style`, `id` and `on*` never survive. Text
   nodes — including newlines inside `<pre>` — go through `createTextNode`.

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

`sirsoft-board` stores and returns comment HTML **without filtering**, and it is
normally safe because the visitor page escapes it. This plugin un-escapes it during
the render upgrade, so **XSS defence is entirely the plugin's whitelist sanitizer**
(`sanitizeCommentHtml`):

- Tags outside the allow-list (`script style iframe object embed div span`, …) are
  **removed together with their children**.
- All attributes are removed, except: `<a>` `href` (only `http(s)`, `//`, `/`, `#`,
  `mailto:`), `target="_blank"`, a forced `rel="noopener noreferrer"`; `<img>` `src`
  (only an absolute `http(s)://` URL) and `alt`, with forced `loading="lazy"` and
  `referrerpolicy="no-referrer"`.
- `blockquote pre code h1–h6` allow **no attributes at all** — a code block's
  `class="language-*"`, `style`, `id` are all dropped. Newlines inside `<pre>` are
  escaped via `createTextNode`.
- `on*` handler attributes are never in the allow-list, so they are always removed.
- Parsing uses `DOMParser` (inert document — scripts do not run).

### Embed security

`<iframe>` / `<blockquote class="twitter-tweet">` and similar embed markup is **not**
in the sanitizer allow-list. It is built by `enrichComment()` on top of a DOM that
already passed the sanitizer. Embed URLs are never parsed from user input: an **id**
is extracted from the URL by regex (`youtube` `[\w-]{6,}`, `twitter` / `tiktok`
`\d+`, `instagram` `[\w-]+`) and a trusted embed URL is assembled from a
**hard-coded** domain (`youtube-nocookie.com` / `x.com` / `instagram.com` /
`tiktok.com`), then the assembled result is re-validated by regex. There is no code
path that produces an arbitrary-domain iframe.

Deactivating the plugin stops the render upgrade — comments go back to escaped text
and the input goes back to a plain textarea.

## Known limitations

- **No image upload.** Images are only rendered from external URLs pasted as text
  (hot-linking). There is no image button on the toolbar.
- **The code block has no language picker.** The language dropdown is limited to a
  single "Plain text" entry — the post-body editor has no language UI either, and
  the sanitizer strips the `language-*` class anyway, so the choice is meaningless.
- **No table, media embed or horizontal rule** on the toolbar — out of scope for a
  comment. Headings are limited to **H2 / H3 / H4** (page-level H1 is excluded).
- **No OpenGraph link cards.** External-link rendering covers SNS embeds + image
  URLs + word-breaking only.
- SNS embeds load each platform's official widget script from an external domain —
  the site's CSP (if any) must allow those domains.
- The comment body shares the board's `max_comment_length` limit (default 1000),
  and HTML markup counts toward the length.
- No server-side code (no routes, migrations, settings tables). One global script.

## <a name="사용법-한국어"></a>사용법 (한국어)

`sirsoft-board` 의 댓글·답글·댓글수정 입력창은 기본이 순수 텍스트 `<textarea>` 입니다.
이 플러그인은 **sirsoft-board · sirsoft-ckeditor5 · 방문자 템플릿(sirsoft-basic) 을 전혀
수정하지 않고**, 전 페이지에 로드되는 스크립트 하나로 그 입력창을 CKEditor 5 로 바꾸고,
저장된 HTML 댓글을 방문자 화면에서 허용 태그만 남겨 렌더합니다.

**툴바**: 제목(H2/H3/H4) · 굵게 · 기울임 · 취소선 · 인라인 코드 · 글머리표 목록 ·
번호 목록 · 인용구 · 코드블록 · 링크. 코드블록의 언어 선택은 "Plain text" 하나로
축소되어 있습니다(선택이 무의미). 이미지 업로드·표·미디어·구분선은 없습니다.

**외부 링크 렌더링**: 댓글에 텍스트로 붙여넣은 URL 을 렌더 시점에 시각 콘텐츠로 바꿉니다.
한 블록에 단독으로 놓인 링크만 SNS 임베드(YouTube · X · Instagram · TikTok,
**Facebook 제외**), 이미지 확장자 URL 은 `<img>` 핫링크, 그 외 URL 은 카드화 없이 링크화 +
자동 줄바꿈. 플랫폼별·이미지 개별 on/off 는 플러그인 설정으로 조정합니다.

**보안**: 저장 HTML 은 서버에서 검열되지 않으므로 XSS 방어는 플러그인의 화이트리스트
새니타이저가 전담합니다. 허용 태그 외 전부 제거, `blockquote/pre/code/h1~h6` 는 속성
허용 0, `on*`·`javascript:`·임의 도메인 iframe 은 생성 경로가 없습니다.

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
