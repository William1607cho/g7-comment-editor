<?php

namespace Plugins\G7\Comment\Editor\Tests\Unit;

require_once dirname(__DIR__, 2).'/src/Sanitizer/CommentHtmlSanitizer.php';

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Plugins\G7\Comment\Editor\Sanitizer\CommentHtmlSanitizer;

/**
 * 서버 측 댓글 정제기 (1.2.0)
 *
 * - 기대값은 설계안 검증 표(C 시리즈)와 같다. 브라우저 `sanitizeCommentHtml()` 과 같은 출력이 목표.
 * - 순수 PHP(라라벨 불필요). 플러그인 디렉터리에서 경로를 직접 지정해 실행한다.
 * - libxml(HTML4) 과 브라우저(HTML5) 의 트리 차이가 있을 수 있는 항목(표의 tbody, 깊은 중첩)은
 *   정확한 문자열 대신 불변 조건만 본다.
 */
class CommentHtmlSanitizerTest extends TestCase
{
    private function sanitizer(): CommentHtmlSanitizer
    {
        return new CommentHtmlSanitizer;
    }

    /**
     * @return array<string, array{0: string, 1: string, 2: string}>  [입력, 기대 저장값, 기대 경로]
     */
    public static function exactCases(): array
    {
        return [
            'C1 에디터 정상 산출물 불변' => ['<p>안녕 <strong>굵게</strong></p>', '<p>안녕 <strong>굵게</strong></p>', 'html'],
            'C2 script 제거' => ['<p>a</p><script>alert(1)</script>', '<p>a</p>', 'html'],
            'C3 on*·class 제거, style 은 정렬만' => ['<p onclick="x()" class="c" style="color:red;text-align:center">t</p>', '<p style="text-align:center">t</p>', 'html'],
            'C4 들여쓰기 상한' => ['<p style="margin-left:40px">a</p><p style="margin-left:900px">b</p>', '<p style="margin-left:40px">a</p><p>b</p>', 'html'],
            'C5 javascript: href 제거' => ['<a href="javascript:alert(1)">x</a><p>y</p>', '<a>x</a><p>y</p>', 'html'],
            'C6 a 속성 순서·rel 강제' => ['<p><a href="https://example.com" target="_blank" onclick="x()">x</a></p>', '<p><a href="https://example.com" rel="noopener noreferrer" target="_blank">x</a></p>', 'html'],
            'C7 data: 이미지 제거' => ['<p>t</p><img src="data:image/png;base64,AA" onerror="x()">', '<p>t</p>', 'html'],
            'C8 허용 태그 없는 페이로드 → 이스케이프' => ['<script>alert(1)</script>', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', 'tagged_text'],
            'C9 img 속성 순서·onerror 제거' => ['<p><img src="https://example.com/a.png" alt="x" onerror="x()"></p>', '<p><img src="https://example.com/a.png" alt="x" loading="lazy" referrerpolicy="no-referrer"></p>', 'html'],
            'C10 평문 문단 불변' => ["안녕하세요\n\n반갑습니다", "안녕하세요\n\n반갑습니다", 'plain'],
            'C11 부등호 평문 불변' => ['5 < 6 & 7 > 3', '5 < 6 & 7 > 3', 'plain'],
            'C12 태그 같은 평문' => ['a<b', '<p>a&lt;b</p>', 'tagged_text'],
            'C14 pre/code 벗기기 + p 감싸기' => ['<pre><code>x &lt; y</code></pre>', '<p>x &lt; y</p>', 'html'],
            'C15 정렬 소문자화' => ['<h2 style="text-align:CENTER">t</h2>', '<h2 style="text-align:center">t</h2>', 'html'],
            'C16 주석·svg 제거' => ['<p>a<!-- c --></p><svg onload="x()"><p>b</p></svg>', '<p>a</p>', 'html'],
            'C17 한글·이모지·nbsp 불변' => ['<p>한글 😀&nbsp;x</p>', '<p>한글 😀&nbsp;x</p>', 'html'],
            'C18 엔티티 텍스트 불변' => ['<p>&lt;script&gt;</p>', '<p>&lt;script&gt;</p>', 'html'],
            'T 경로 개행' => ["<x>\n줄\r\n\r\n문단", "<p>&lt;x&gt;<br>줄</p><p>문단</p>", 'tagged_text'],
            'mailto·앵커 href 유지' => ['<p><a href="mailto:a@example.com">m</a><a href="#top">t</a></p>', '<p><a href="mailto:a@example.com" rel="noopener noreferrer">m</a><a href="#top" rel="noopener noreferrer">t</a></p>', 'html'],
            'target 은 _blank 만' => ['<p><a href="/x" target="_self">x</a></p>', '<p><a href="/x" rel="noopener noreferrer">x</a></p>', 'html'],
            'href 앞뒤 공백(JS trim)' => ["<p><a href=\"\u{00A0} https://example.com \">x</a></p>", '<p><a href="https://example.com" rel="noopener noreferrer">x</a></p>', 'html'],
            '속성값 이스케이프' => ['<p><img src="https://example.com/a.png" alt="&quot;&lt;b&gt;&amp;"></p>', '<p><img src="https://example.com/a.png" alt="&quot;&lt;b&gt;&amp;" loading="lazy" referrerpolicy="no-referrer"></p>', 'html'],
        ];
    }

    #[DataProvider('exactCases')]
    public function test_exact_output(string $input, string $expected, string $path): void
    {
        $result = $this->sanitizer()->process($input);

        $this->assertSame($path, $result['path']);
        $this->assertSame($expected, $result['html']);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function invisibleCases(): array
    {
        return [
            'C20 script 만 든 문단' => ['<p><script>x</script></p>'],
            'C21 공백만' => ['<p>&nbsp;</p>'],
            '이미지 src 불합격만' => ['<p><img src="javascript:x" onerror="x()"></p>'],
            '평문 공백만' => ["  \u{3000}\n"],
        ];
    }

    #[DataProvider('invisibleCases')]
    public function test_invisible_result_is_flagged(string $input): void
    {
        $this->assertFalse($this->sanitizer()->process($input)['visible']);
    }

    public function test_image_only_is_visible(): void
    {
        $this->assertTrue($this->sanitizer()->process('<p><img src="https://example.com/a.png" alt=""></p>')['visible']);
    }

    public function test_table_keeps_cells_without_attributes(): void
    {
        // C13 — libxml 은 tbody 를 넣지 않을 수 있다(브라우저는 넣는다). 화면 결과는 같다.
        $html = $this->sanitizer()->sanitize('<figure class="table"><table border="1"><tr><td colspan="2">x</td></tr></table></figure>');

        $this->assertStringStartsWith('<table>', $html);
        $this->assertStringContainsString('<td>x</td>', $html);
        $this->assertStringNotContainsString('figure', $html);
        $this->assertStringNotContainsString('colspan', $html);
    }

    public function test_deep_nesting_does_not_throw(): void
    {
        // C24 — 결과 문자열만 확인(깊이 제한에 걸리면 빈 문자열일 수 있다 → 검증 규칙이 422)
        $input = str_repeat('<b>', 300).'x'.str_repeat('</b>', 300);

        $this->assertIsString($this->sanitizer()->sanitize($input));
    }

    public function test_output_contains_only_allowed_markup(): void
    {
        $vectors = [
            '<p><IMG SRC=JaVaScRiPt:alert(1)></p>',
            '<p><a href=" javascript:alert(1)">x</a></p>',
            '<p><a href="java&#x09;script:alert(1)">x</a></p>',
            '<p style="background:url(javascript:alert(1))">x</p>',
            '<p style="text-align:center;&#10;x:expression(alert(1))">x</p>',
            '<p><math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math></p>',
            '<p><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript></p>',
            '<p><textarea><img src=x onerror=alert(1)></textarea></p>',
            '<p><![CDATA[<img src=x onerror=alert(1)>]]></p>',
            '<p>a</div><script>alert(1)</script>b</p>',
        ];

        foreach ($vectors as $v) {
            $out = $this->sanitizer()->sanitize($v);
            $this->assertDoesNotMatchRegularExpression('~<(?!/?(p|br|strong|b|em|i|u|s|ul|ol|li|blockquote|h[1-6]|table|thead|tbody|tr|th|td|a|img)[\s>/])~i', $out, $v);
            // 이스케이프된 텍스트(&lt;…)에 남는 글자는 무해하므로 태그 안만 본다
            $this->assertDoesNotMatchRegularExpression('~<[^>]*\son[a-z]+\s*=~i', $out, $v);
            $this->assertDoesNotMatchRegularExpression('~<[^>]*javascript:~i', $out, $v);
            $this->assertDoesNotMatchRegularExpression('~<[^>]*expression\(~i', $out, $v);
        }
    }

    public function test_idempotent(): void
    {
        foreach (self::exactCases() as [$input]) {
            $once = $this->sanitizer()->sanitize($input);
            $this->assertSame($once, $this->sanitizer()->sanitize($once), $input);
        }
    }

    public function test_policy_sync_check_passes(): void
    {
        $root = dirname(__DIR__, 2);
        exec(escapeshellarg(PHP_BINARY).' '.escapeshellarg($root.'/scripts/sync-policy.php').' --check', $output, $code);

        $this->assertSame(0, $code, implode("\n", $output));
    }
}
