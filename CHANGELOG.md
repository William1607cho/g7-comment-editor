# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-11

### Changed

- Toolbar now matches the post-body editor (`sirsoft-ckeditor5`) exactly, image
  upload aside: heading (Paragraph / Heading 1-3, same default mapping to
  `<h2>`/`<h3>`/`<h4>`), bold, italic, underline, strikethrough, alignment,
  link, block quote, bulleted list, numbered list, indent/outdent, table
  (insert + add/remove column/row). Underline, alignment, indent/outdent and
  table are new; inline code and code block (added in a prior release) are
  removed — they were never part of the body editor's toolbar.
- Heading options are no longer custom-labelled ("H2/H3/H4"); they now use
  CKEditor 5's own defaults, so the dropdown reads "Paragraph / Heading 1/2/3"
  (localized) exactly like the body editor.
- The editor now loads the CKEditor 5 UI translation for the current locale
  (previously always English) and passes `language` to `ClassicEditor.create`,
  reusing the same asset id as `sirsoft-ckeditor5` so both editors share one
  script tag on pages where both appear.

### Security

- The whitelist sanitizer now allows `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th>`/`<td>`
  (no attributes) and, on `<p>`/`<h1>`-`<h6>` only, a strictly validated `style`
  attribute limited to `text-align: left|right|center|justify` and
  `margin-left`/`margin-right: 0-800px` — every other property/value is dropped.
  Table-cell attributes (`colspan`, `onmouseover`, inline `style`, etc.) are
  stripped entirely; only the reduced content-toolbar (add/remove column/row)
  is exposed, not cell merging or per-cell/table style editing.
- `<pre>`/`<code>` (removed from the toolbar) and CKEditor's `<figure>` table
  wrapper are unwrapped rather than dropped outright, so comments written with
  the previous release's code-block feature keep their text (as plain text,
  no code styling) instead of disappearing.
- Re-verified against `style="...url(javascript:...)"`, `position:fixed`,
  `expression(...)`, CSS-declaration break-out (`;} body{...`), out-of-range
  `margin-left` values, `<table>`/`<td>` event-handler attributes, and the
  existing vector set from 1.0.0 — all still blocked.

## [1.0.0] - 2026-09-11

### Added

- Initial public release. A standalone Gnuboard7 plugin that mounts CKEditor 5 on
  the comment / reply / comment-edit textareas of `sirsoft-board` **without
  modifying `sirsoft-board`, `sirsoft-ckeditor5` or the template**. One
  globally-loaded script (`loading.strategy: "global"`) does all the work; there is
  no server-side code.

- **Editor mount** — comment / reply / comment-edit `<textarea>` elements are
  swapped for a CKEditor 5 `ClassicEditor`. Toolbar: heading (H2 / H3 / H4), bold,
  italic, strikethrough, inline code, bulleted list, numbered list, block quote,
  code block, link. All required plugins already live in the CKEditor 5 UMD
  single-package bundle served by `sirsoft-ckeditor5`, so nothing extra is loaded;
  `buildToolbar()` assembles the toolbar defensively. `Autoformat` is intentionally
  not enabled. The hidden original textarea is kept in sync via a native value
  setter + a 50 ms-debounced `input` event, with an immediate flush on submit
  intent (`pointerdown` capture, keystroke outside the editor, editor blur) so no
  trailing character is lost. Reply and edit forms run as independent instances.

- **Code block language picker reduced to "Plain text" only** (`codeBlock.languages`
  is a single entry). The post-body editor has no language UI, and the sanitizer
  strips the `language-*` class, so the choice is meaningless.

- **Stored-HTML render upgrade** — because `sirsoft-basic` renders the comment body
  escaped, the script promotes it to real formatting through a whitelist-rebuild
  sanitizer. Allowed: `p br strong b em i u s ul ol li a[href] img[src][alt]
  blockquote pre code h1–h6`; everything else (tag, all attributes, `on*`) is
  removed. `blockquote / pre / code / h1–h6` allow no attributes at all. Parsing is
  done with an inert `DOMParser`.

- **External-link rendering** — a URL pasted as plain text becomes visual content on
  the visitor page (no upload):
  - SNS embeds for a link alone on its own block: YouTube (`youtube-nocookie.com`
    iframe), X / Twitter, Instagram, TikTok (official widget scripts). **Facebook is
    excluded.**
  - An image-extension URL becomes an `<img>` hot-link
    (`loading="lazy"`, `referrerpolicy="no-referrer"`).
  - Any other URL is linkified with `overflow-wrap:anywhere`; it is not card-ified.
  - Per-platform and per-image on/off via `window.G7Config`. SNS detection wins over
    image detection.
  - Embed markup is built by the plugin from a regex-extracted id + a hard-coded
    trusted domain, re-validated after assembly — never parsed from user input. The
    SNS-embed pattern was re-implemented independently from `g7-ckeditor5-superpack`
    with no code copied and no runtime dependency.

### Security

- XSS defence is entirely the plugin's whitelist sanitizer, since stored comment
  HTML is not filtered server-side. Verified against `<script>`, `<img onerror>`,
  `javascript:` hrefs, `<blockquote onclick style>`, `<pre><code><script>`,
  `<h2 onmouseover id>`, `<code style="url(javascript:…)">`, `<svg onload>`,
  non-allowed tags with handlers, and YouTube-id break-out attempts.
