# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
