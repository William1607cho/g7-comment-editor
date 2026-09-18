<?php

namespace Plugins\G7\Comment\Editor\Sanitizer;

use DOMDocument;
use DOMNode;
use RuntimeException;

/**
 * 댓글 HTML 서버 측 정제기 (1.2.0) — 브라우저 `sanitizeCommentHtml()` 의 PHP 대응본.
 *
 * ── 왜 두 층인가 ──────────────────────────────────────────────
 * 브라우저 정제기(resources/js/index.js)는 **제출 직전**과 **화면에 그릴 때** 두 번 돈다.
 * API 로 댓글을 직접 POST 하면 제출 직전 정제를 건너뛰므로, 이 클래스가 저장 직전에
 * 같은 정책으로 한 번 더 정제한다(sirsoft-board 의 댓글 입력 필터 훅에서 호출).
 * 브라우저 쪽 렌더 시 정제는 DB 에 **이미 들어가 있는 것**에 대한 마지막 방어선이라
 * 이 클래스가 있어도 **제거하면 안 된다**(중복이 아니라 방어 계층).
 *
 * ── 정책 ──────────────────────────────────────────────────────
 * 허용 목록은 resources/sanitize-policy.json 한 곳에 있다. 브라우저 정제기는 같은 파일에서
 * 생성한 사본을 쓰고, `php scripts/sync-policy.php --check` 가 두 쪽이 같은지 검사한다.
 *
 * ── 입력 분기(브라우저 판정과 맞춤) ───────────────────────────
 *  - H (html)        : 허용 태그가 `<태그…>` 형태로 있음(looksLikeHtml) → 허용 목록 정제
 *  - T (tagged_text) : H 가 아니지만 `<` 뒤에 영문자·`/`·`!`·`?` 가 옴 → 평문으로 보고
 *                      `<p>`/`<br>` + 이스케이프 HTML 로 변환(허용 태그를 안 쓴 페이로드가
 *                      원문 그대로 DB 에 남지 않게 한다)
 *  - P (plain)       : 그 밖 → 그대로 둔다(폴백 textarea 로 쓴 평문의 저장 형식 유지)
 *
 * ── 구현 전략 ─────────────────────────────────────────────────
 * libxml 로 파싱만 하고, 허용된 요소·검증된 속성·이스케이프된 텍스트로 **문자열을 새로
 * 조립**한다(원본 노드·속성을 옮기지 않는다). 출력 변환에 `saveHTML()` 을 쓰지 않는 이유:
 * 비ASCII 엔티티화·빈 요소 표기 차이 때문에 에디터가 만든 정상 댓글의 저장값이 바뀔 수 있다.
 * 직렬화 규칙과 속성 순서는 브라우저 `innerHTML` 과 같게 맞췄다(정상 댓글은 저장값 불변).
 * 정규식의 공백·줄끝·앵커 의미도 JS 와 같게 맞췄다(`\s`/`trim()` 집합, `.`, `^`/`$`).
 *
 * Laravel 에 의존하지 않는다(순수 PHP — 단위 테스트에서 그대로 쓴다).
 */
final class CommentHtmlSanitizer
{
    public const PATH_HTML = 'html';

    public const PATH_TAGGED_TEXT = 'tagged_text';

    public const PATH_PLAIN = 'plain';

    /**
     * JS `\s` 와 `String.prototype.trim()` 이 공백으로 보는 문자 집합 (PCRE /u 문자 클래스 본문).
     * PHP `trim()`·PCRE `\s` 는 이보다 좁아(U+00A0·U+3000 등 제외) 그대로 쓰면 판정이 어긋난다.
     */
    private const JS_WS = '\t\n\x{0B}\f\r \x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    /** JS 정규식 `.` 이 매칭하지 않는 줄 끝 문자 (PCRE `.` 은 `\r` 을 매칭하므로 따로 적는다) */
    private const JS_LINE_TERMINATORS = '\n\r\x{2028}\x{2029}';

    /** 자식이 없는 요소 — 닫는 태그를 쓰지 않는다 */
    private const VOID_TAGS = ['BR' => true, 'IMG' => true];

    /** @var array<string, mixed>|null 정책 파일 캐시 (프로세스 단위) */
    private static ?array $policyCache = null;

    /** @var array{input: string, result: array{path: string, html: string, visible: bool}}|null 직전 결과 (검증 규칙·데이터 필터가 같은 입력을 두 번 넘긴다) */
    private ?array $memo = null;

    /** @var array<string, array<int, string>> 대문자 태그 → 허용 속성 */
    private array $allowedTags;

    /** @var array<string, true> */
    private array $unwrapTags;

    /** @var array<int, string> */
    private array $textAlign;

    /** @var array<int, string> */
    private array $marginProps;

    private int $marginDigits;

    private int $marginMax;

    /** @var array<int, string> */
    private array $hrefPrefixes;

    private string $imgSrcPattern;

    private string $htmlDetectPattern;

    /**
     * @param  array<string, mixed>|null  $policy  테스트용 주입. null 이면 정책 파일을 읽는다.
     */
    public function __construct(?array $policy = null)
    {
        $p = $policy ?? self::loadPolicy();

        $this->allowedTags = [];
        foreach ($p['allowed_tags'] as $tag => $attrs) {
            $this->allowedTags[strtoupper((string) $tag)] = array_values(array_map('strval', (array) $attrs));
        }

        $this->unwrapTags = [];
        foreach ($p['unwrap_tags'] as $tag) {
            $this->unwrapTags[strtoupper((string) $tag)] = true;
        }

        $this->textAlign = array_map('strtolower', array_map('strval', $p['block_style']['text_align']));
        $this->marginProps = array_map('strtolower', array_map('strval', $p['block_style']['margin_props']));
        $this->marginDigits = (int) $p['block_style']['margin_px_max_digits'];
        $this->marginMax = (int) $p['block_style']['margin_px_max'];
        $this->hrefPrefixes = array_map('strval', $p['href_prefixes']);

        $schemes = implode('|', array_map(fn ($s) => preg_quote((string) $s, '~'), $p['img_src_schemes']));
        $this->imgSrcPattern = '~\A(?:'.$schemes.')://[^'.self::JS_WS.'"\'<>]+\z~iu';

        $tags = implode('|', array_map(fn ($t) => preg_quote((string) $t, '~'), $p['html_detect_tags']));
        $this->htmlDetectPattern = '~<('.$tags.')\b[^>]*>~i';
    }

    public static function policyPath(): string
    {
        return dirname(__DIR__, 2).'/resources/sanitize-policy.json';
    }

    /**
     * 정책 파일을 읽는다. 읽지 못하면 예외 — 정제 없이 저장되는 일이 없도록 닫힌 쪽으로 실패한다.
     *
     * @return array<string, mixed>
     */
    public static function loadPolicy(): array
    {
        if (self::$policyCache !== null) {
            return self::$policyCache;
        }

        $raw = @file_get_contents(self::policyPath());
        if ($raw === false) {
            throw new RuntimeException('g7-comment-editor: sanitize-policy.json 을 읽을 수 없습니다.');
        }

        $policy = json_decode($raw, true);
        foreach (['allowed_tags', 'unwrap_tags', 'block_style', 'href_prefixes', 'img_src_schemes', 'html_detect_tags'] as $key) {
            if (! is_array($policy) || ! isset($policy[$key]) || ! is_array($policy[$key])) {
                throw new RuntimeException('g7-comment-editor: sanitize-policy.json 형식 오류 ('.$key.')');
            }
        }

        return self::$policyCache = $policy;
    }

    /**
     * 정제 결과 문자열만 필요할 때.
     */
    public function sanitize(string $content): string
    {
        return $this->process($content)['html'];
    }

    /**
     * 입력을 분기해 정제하고, 저장할 값과 "보이는 내용이 있는가"를 함께 돌려준다.
     *
     * @return array{path: string, html: string, visible: bool}
     */
    public function process(string $content): array
    {
        if ($this->memo !== null && $this->memo['input'] === $content) {
            return $this->memo['result'];
        }

        if (preg_match($this->htmlDetectPattern, $content) === 1) {
            $path = self::PATH_HTML;
            $html = $this->sanitizeHtml($content);
        } elseif (preg_match('~<[a-zA-Z/!?]~', $content) === 1) {
            $path = self::PATH_TAGGED_TEXT;
            $html = $this->plainTextToHtml($content);
        } else {
            $path = self::PATH_PLAIN;
            $html = $content;
        }

        $result = [
            'path' => $path,
            'html' => $html,
            'visible' => $path === self::PATH_PLAIN ? $this->hasVisibleText($html) : $this->htmlHasVisibleContent($html),
        ];

        $this->memo = ['input' => $content, 'result' => $result];

        return $result;
    }

    /**
     * H 경로 — 허용 목록 정제. 브라우저 `sanitizeCommentHtml()` 과 같은 규칙.
     */
    private function sanitizeHtml(string $dirty): string
    {
        // NUL 은 브라우저 파서도 텍스트로 살리지 않는다. libxml 에 그대로 넘기지 않는다.
        $dirty = str_replace("\0", '', $dirty);

        $doc = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);

        try {
            $loaded = $doc->loadHTML(
                '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>'
                .$dirty.'</body></html>',
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING
            );
        } catch (\ValueError) {
            $loaded = false;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }

        if (! $loaded) {
            return '';
        }

        $body = $doc->getElementsByTagName('body')->item(0);
        if ($body === null) {
            return '';
        }

        // 브라우저는 `div#g7ce-root` 안만 보지만, 여기서는 body 전체를 본다 — 원문의 떠돌이
        // `</div>` 뒤 내용도 버리지 않는다. 저장값에는 떠돌이 태그가 남지 않으므로 화면 결과는 같다.
        $emittedElement = false;
        $html = $this->walk($body, $emittedElement);

        // 요소가 하나도 남지 않으면 `<p>` 로 감싼다. 감싸지 않으면 저장값(텍스트+엔티티)을
        // 브라우저가 HTML 로 인식하지 못해 `&lt;` 같은 엔티티가 글자로 보인다. 감싼 결과를 다시
        // 정제해도 같으므로 멱등이다. 에디터 산출물은 항상 블록 요소가 있어 이 분기를 타지 않는다.
        if ($html !== '' && ! $emittedElement) {
            $html = '<p>'.$html.'</p>';
        }

        return $html;
    }

    /**
     * 허용된 요소를 새로 조립한다. 허용 외 태그는 자식까지 버리고(브라우저와 동일),
     * UNWRAP 태그는 태그만 벗겨 자식을 상위에 합류시킨다. 주석·CDATA·처리명령은 버린다.
     */
    private function walk(DOMNode $from, bool &$emittedElement): string
    {
        $html = '';

        foreach ($from->childNodes as $node) {
            if ($node->nodeType === XML_TEXT_NODE) {
                $html .= $this->escapeText((string) $node->nodeValue);

                continue;
            }

            if ($node->nodeType !== XML_ELEMENT_NODE) {
                continue;
            }

            /** @var \DOMElement $node */
            $tag = strtoupper($node->nodeName);

            if (isset($this->unwrapTags[$tag])) {
                $html .= $this->walk($node, $emittedElement);

                continue;
            }

            if (! array_key_exists($tag, $this->allowedTags)) {
                continue; // 허용 외 태그(script/style/iframe/div/span/svg/…) → 자식째 버림
            }

            if ($tag === 'IMG') {
                $src = $this->safeImgSrc($node->getAttribute('src'));
                if ($src !== null) {
                    // 속성 순서는 브라우저 정제기와 같다: src → alt → loading → referrerpolicy
                    $html .= '<img src="'.$this->escapeAttr($src).'" alt="'.$this->escapeAttr($node->getAttribute('alt'))
                        .'" loading="lazy" referrerpolicy="no-referrer">';
                    $emittedElement = true;
                }

                continue; // src 가 부적합하면 이미지 자체를 버린다
            }

            $attrs = '';
            if ($tag === 'A') {
                $href = $this->safeHref($node->getAttribute('href'));
                if ($href !== null) {
                    // 속성 순서는 브라우저 정제기와 같다: href → rel → target
                    $attrs .= ' href="'.$this->escapeAttr($href).'" rel="noopener noreferrer"';
                    if ($node->getAttribute('target') === '_blank') {
                        $attrs .= ' target="_blank"';
                    }
                }
            } elseif (in_array('style', $this->allowedTags[$tag], true)) {
                $style = $this->safeBlockStyle($node->getAttribute('style'));
                if ($style !== null) {
                    $attrs .= ' style="'.$this->escapeAttr($style).'"';
                }
            }

            $name = strtolower($tag);
            $emittedElement = true;

            if (isset(self::VOID_TAGS[$tag])) {
                $html .= '<'.$name.$attrs.'>';

                continue;
            }

            $html .= '<'.$name.$attrs.'>'.$this->walk($node, $emittedElement).'</'.$name.'>';
        }

        return $html;
    }

    /**
     * T 경로 — 브라우저 `plainTextToHtml()` 과 같은 변환(빈 줄=문단, 한 줄 개행=`<br>`).
     * 멱등성을 위해 두 가지만 다르다(화면 결과는 같음): 줄끝 CR 을 LF 로 맞추고,
     * U+00A0 을 `&nbsp;` 로 쓴다(H 경로 재정제 결과와 바이트가 같아지도록).
     */
    private function plainTextToHtml(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $blocks = preg_split('~\n{2,}~', $text);
        if ($blocks === false) {
            $blocks = [$text];
        }

        $html = '';
        foreach ($blocks as $block) {
            $html .= '<p>'.str_replace("\n", '<br>', $this->escapeText($block)).'</p>';
        }

        return $html;
    }

    /** 텍스트 직렬화 — 브라우저 innerHTML 과 같다(& · U+00A0 · < · >). */
    private function escapeText(string $s): string
    {
        return str_replace(['&', "\u{00A0}", '<', '>'], ['&amp;', '&nbsp;', '&lt;', '&gt;'], $s);
    }

    /** 속성값 직렬화 — 브라우저 innerHTML 과 같다(& · U+00A0 · " · < · >). */
    private function escapeAttr(string $s): string
    {
        return str_replace(['&', "\u{00A0}", '"', '<', '>'], ['&amp;', '&nbsp;', '&quot;', '&lt;', '&gt;'], $s);
    }

    /** JS `String.prototype.trim()` 과 같은 공백 집합으로 양끝을 자른다. */
    private function jsTrim(string $s): string
    {
        $trimmed = preg_replace('~\A['.self::JS_WS.']+|['.self::JS_WS.']+\z~u', '', $s);

        return $trimmed ?? trim($s);
    }

    /** 브라우저 `safeHref()` — 허용 접두어(대소문자 무시)로 시작할 때만 통과. */
    private function safeHref(string $raw): ?string
    {
        $v = $this->jsTrim($raw);
        foreach ($this->hrefPrefixes as $prefix) {
            if (strncasecmp($v, $prefix, strlen($prefix)) === 0) {
                return $v;
            }
        }

        return null;
    }

    /** 브라우저 `safeImgSrc()` — 절대 http(s) URL 만. data:·상대·javascript: 거부. */
    private function safeImgSrc(string $raw): ?string
    {
        $v = $this->jsTrim($raw);

        return preg_match($this->imgSrcPattern, $v) === 1 ? $v : null;
    }

    /**
     * 브라우저 `safeBlockStyle()` — text-align 정렬 키워드, margin-left/right 0~800px 정수만
     * 값 검증 후 `prop:value` 로 다시 조립한다. 그 외 선언은 버린다.
     */
    private function safeBlockStyle(string $raw): ?string
    {
        $ws = self::JS_WS;
        $declPattern = '~\A['.$ws.']*([a-zA-Z-]+)['.$ws.']*:['.$ws.']*([^'.self::JS_LINE_TERMINATORS.']+?)['.$ws.']*\z~u';
        $marginPattern = '~\A[0-9]{1,'.$this->marginDigits.'}px\z~';

        $out = [];
        foreach (explode(';', $raw) as $decl) {
            if (preg_match($declPattern, $decl, $m) !== 1) {
                continue;
            }

            $prop = strtolower($m[1]);
            $val = $this->jsTrim($m[2]);

            if ($prop === 'text-align' && in_array(strtolower($val), $this->textAlign, true)) {
                $out[] = 'text-align:'.strtolower($val);
            } elseif (in_array($prop, $this->marginProps, true) && preg_match($marginPattern, $val) === 1) {
                $n = (int) $val;
                if ($n >= 0 && $n <= $this->marginMax) {
                    $out[] = $prop.':'.$n.'px';
                }
            }
        }

        return $out === [] ? null : implode(';', $out);
    }

    /** 평문에 공백이 아닌 글자가 있는가. */
    private function hasVisibleText(string $text): bool
    {
        $stripped = preg_replace('~['.self::JS_WS.']+~u', '', $text);

        return ($stripped ?? trim($text)) !== '';
    }

    /** 정제된 HTML 에 보이는 내용(공백 아닌 글자 또는 이미지)이 있는가. */
    private function htmlHasVisibleContent(string $html): bool
    {
        if (preg_match('~<img\b~i', $html) === 1) {
            return true;
        }

        return $this->hasVisibleText(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
}
