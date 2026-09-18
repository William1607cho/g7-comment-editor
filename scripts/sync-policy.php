<?php

/**
 * 댓글 정제 정책 동기화 (1.2.0) — resources/sanitize-policy.json → 브라우저 정제기 사본.
 *
 * 사용:
 *   php scripts/sync-policy.php          JSON 으로 index.js 의 @sanitize-policy 구간을 다시 쓰고
 *                                        dist/js/plugin.iife.js 를 index.js 와 같게 맞춘다.
 *   php scripts/sync-policy.php --check  아무것도 쓰지 않고 검사만 한다. 하나라도 어긋나면 종료 코드 1.
 *
 * --check 검사 항목
 *   1. index.js 에 @sanitize-policy 구간이 정확히 1개
 *   2. 그 구간이 JSON 으로 생성한 내용과 바이트 단위로 같음 (ALLOWED_TAGS · UNWRAP_TAGS)
 *   3. dist/js/plugin.iife.js 가 index.js 와 바이트 단위로 같음 (빌드 도구가 없는 구조의 규칙)
 *   4. 브라우저 정제기의 규칙 리터럴이 JSON 에서 기대하는 문자열과 같음
 *      (looksLikeHtml · HTMLISH · safeHref · safeImgSrc · safeBlockStyle). 이 함수들의 본문은
 *      생성하지 않고 그대로 두며, 여기서 대조만 한다.
 *
 * 태그 아카이브(릴리스 zip)를 만들기 전에 --check 를 수동으로 실행한다. CI 에는 넣지 않는다.
 * 플러그인 코드가 아니라 개발 도구다(.gitattributes export-ignore).
 */

declare(strict_types=1);

const BEGIN_MARK = '/* @sanitize-policy:begin';
const END_MARK = '/* @sanitize-policy:end */';

$root = dirname(__DIR__);
$policyPath = $root.'/resources/sanitize-policy.json';
$srcPath = $root.'/resources/js/index.js';
$distPath = $root.'/dist/js/plugin.iife.js';
$checkOnly = in_array('--check', array_slice($argv, 1), true);

try {
    $policy = json_decode((string) file_get_contents($policyPath), true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    fwrite(STDERR, "FAIL  sanitize-policy.json 을 읽을 수 없음: {$e->getMessage()}\n");
    exit(1);
}

$src = (string) file_get_contents($srcPath);
$block = generateBlock($policy);
$pattern = '~^[ \t]*'.preg_quote(BEGIN_MARK, '~').'.*?'.preg_quote(END_MARK, '~').'[ \t]*$~ms';

if (! $checkOnly) {
    $count = preg_match_all($pattern, $src);
    if ($count !== 1) {
        fwrite(STDERR, "FAIL  index.js 의 @sanitize-policy 구간이 {$count}개입니다(1개여야 함).\n");
        exit(1);
    }
    $new = preg_replace_callback($pattern, fn () => $block, $src, 1);
    file_put_contents($srcPath, $new);
    file_put_contents($distPath, $new);
    echo "OK    index.js 구간을 다시 쓰고 dist/js/plugin.iife.js 를 맞췄습니다.\n";
    $src = $new;
}

$failures = 0;
$report = function (bool $ok, string $label) use (&$failures): void {
    echo ($ok ? 'PASS  ' : 'FAIL  ').$label."\n";
    if (! $ok) {
        $failures++;
    }
};

// 1·2. 생성 구간
$count = preg_match_all($pattern, $src, $m);
$report($count === 1, "@sanitize-policy 구간 1개 (발견 {$count}개)");
$report($count === 1 && $m[0][0] === $block, '구간 내용 == sanitize-policy.json 생성 결과 (ALLOWED_TAGS · UNWRAP_TAGS)');

// 3. dist == index.js
$dist = is_file($distPath) ? (string) file_get_contents($distPath) : '';
$report($dist === $src, 'dist/js/plugin.iife.js == resources/js/index.js (바이트 동일)');

// 4. 규칙 리터럴 대조
foreach (expectedLiterals($policy) as $label => $literal) {
    $report(substr_count($src, $literal) >= 1, "규칙 리터럴 {$label}: {$literal}");
}

echo $failures === 0 ? "\n모든 검사 통과\n" : "\n실패 {$failures}건\n";
exit($failures === 0 ? 0 : 1);

/**
 * index.js 에 들어갈 생성 구간(표시 줄 포함).
 *
 * @param  array<string, mixed>  $policy
 */
function generateBlock(array $policy): string
{
    $lines = [];
    $lines[] = '  '.BEGIN_MARK.' — 자동 생성 구간. 직접 고치지 말 것.';
    $lines[] = '   *  원본은 resources/sanitize-policy.json(서버 정제기와 같은 목록). 고친 뒤';
    $lines[] = '   *  `php scripts/sync-policy.php` 로 다시 만들고 `--check` 로 확인한다. */';
    $lines[] = '  var ALLOWED_TAGS = {';

    $tags = $policy['allowed_tags'];
    $i = 0;
    $n = count($tags);
    foreach ($tags as $tag => $attrs) {
        $i++;
        $quoted = array_map(fn ($a) => "'".$a."'", (array) $attrs);
        $lines[] = '    '.strtoupper((string) $tag).': ['.implode(', ', $quoted).']'.($i < $n ? ',' : '');
    }
    $lines[] = '  };';
    $lines[] = '';
    $lines[] = '  /** 허용 외 태그이지만 자식(텍스트 등)은 보존하고 래퍼만 벗기는 태그. */';
    $unwrap = array_map(fn ($t) => strtoupper((string) $t).': 1', $policy['unwrap_tags']);
    $lines[] = '  var UNWRAP_TAGS = { '.implode(', ', $unwrap).' };';
    $lines[] = '  '.END_MARK;

    return implode("\n", $lines);
}

/**
 * 브라우저 정제기 본문에 그대로 있어야 하는 규칙 리터럴.
 *
 * @param  array<string, mixed>  $policy
 * @return array<string, string>
 */
function expectedLiterals(array $policy): array
{
    $detect = tagGroup($policy['html_detect_tags']);
    $closing = tagGroup(array_values(array_diff($policy['html_detect_tags'], ['br', 'img'])));
    $bs = $policy['block_style'];
    $margins = array_map(fn ($p) => "prop === '".$p."'", $bs['margin_props']);

    return [
        'looksLikeHtml' => '/<('.$detect.')\b[^>]*>/i',
        'HTMLISH' => '/<('.$detect.')\b[^>]*>[\s\S]*<\/('.$closing.')>|<(br|img)\b[^>]*\/?>/i',
        'safeHref' => '/^('.hrefGroup($policy['href_prefixes']).')/i',
        'safeImgSrc' => '/^'.schemeGroup($policy['img_src_schemes']).':\/\/[^\s"\'<>]+$/i',
        'safeBlockStyle text-align 속성' => "prop === 'text-align'",
        'safeBlockStyle text-align 값' => '/^('.implode('|', $bs['text_align']).')$/i',
        'safeBlockStyle margin 속성' => '('.implode(' || ', $margins).')',
        'safeBlockStyle margin 형식' => '/^\d{1,'.(int) $bs['margin_px_max_digits'].'}px$/',
        'safeBlockStyle margin 상한' => 'n >= 0 && n <= '.(int) $bs['margin_px_max'],
    ];
}

/** 태그 목록 → JS 정규식 그룹 본문. h1~h6 이 모두 있으면 끝에 `h[1-6]` 하나로 묶는다. */
function tagGroup(array $tags): string
{
    $headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    $hasAllHeadings = count(array_intersect($headings, $tags)) === 6;
    $rest = $hasAllHeadings ? array_values(array_diff($tags, $headings)) : $tags;
    if ($hasAllHeadings) {
        $rest[] = 'h[1-6]';
    }

    return implode('|', $rest);
}

/** href 접두어 → JS 정규식 그룹 본문. http:// 와 https:// 가 함께 있으면 `https?:\/\/` 로 묶는다. */
function hrefGroup(array $prefixes): string
{
    $both = in_array('http://', $prefixes, true) && in_array('https://', $prefixes, true);
    $out = [];
    foreach ($prefixes as $p) {
        if ($both && ($p === 'http://' || $p === 'https://')) {
            if (! in_array('https?:\/\/', $out, true)) {
                $out[] = 'https?:\/\/';
            }

            continue;
        }
        $out[] = str_replace('/', '\/', $p);
    }

    return implode('|', $out);
}

/** 이미지 src 스킴 → JS 정규식 본문. http·https 둘이면 `https?`. */
function schemeGroup(array $schemes): string
{
    $sorted = $schemes;
    sort($sorted);
    if ($sorted === ['http', 'https']) {
        return 'https?';
    }

    return '(?:'.implode('|', $schemes).')';
}
