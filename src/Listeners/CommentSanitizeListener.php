<?php

namespace Plugins\G7\Comment\Editor\Listeners;

use App\Contracts\Extension\HookListenerInterface;
use Plugins\G7\Comment\Editor\Exceptions\CommentContentEmptyAfterSanitizeException;
use Plugins\G7\Comment\Editor\Sanitizer\CommentHtmlSanitizer;

/**
 * 댓글 저장 직전 서버 측 HTML 정제 (1.2.0).
 *
 * sirsoft-board 를 고치지 않고 댓글 입력 훅 4개에 붙는다. 사용자·관리자 컨트롤러가 같은
 * `StoreCommentRequest`/`UpdateCommentRequest` 와 같은 `CommentService` 를 쓰므로 모든 쓰기
 * 경로를 덮는다.
 *
 *  1. `sirsoft-board.comment.store_validation_rules` / `update_validation_rules` (filter)
 *     — `content` 규칙 배열에 클로저 규칙 하나를 **덧붙인다**(기존 규칙은 그대로).
 *       코어 검증(required·min·max·금지어)은 **원문** 기준이라, 정제로 내용이 사라지는 입력을
 *       여기서 422 로 돌려보낸다.
 *        R1. 정제 결과에 보이는 내용(공백 아닌 글자 또는 이미지)이 없으면 실패
 *        R2. 정제 결과 문자열 길이가 코어 규칙의 `min:N` 보다 짧으면 실패(같은 값·같은 단위)
 *       최대 길이는 다시 보지 않는다(정제로 조금 길어지는 건 사용자 책임이 아니고 컬럼은 TEXT).
 *
 *  2. `sirsoft-board.comment.filter_create_data` / `filter_update_data` (filter)
 *     — 실제로 정제한 값으로 `content` 를 바꾼다. 결과가 비면 예외를 던져 저장을 거부한다.
 *
 * 우선순위 1000: HookManager 는 필터를 우선순위 오름차순으로 실행한다. 가장 늦게 돌아
 * 다른 확장이 `content` 를 바꾸더라도 정제가 최종 관문이 되게 한다. (g7-forum-addon 잠금
 * 검사는 20 이라 먼저 돈다 — 잠긴 글에서는 정제 비용이 들지 않는다.)
 *
 * 브라우저 정제기(resources/js/index.js `sanitizeCommentHtml`)는 그대로 둔다. 렌더 시 정제는
 * DB 에 이미 들어가 있는 것에 대한 마지막 방어선이다 — 이 리스너가 있어도 제거하지 않는다.
 */
class CommentSanitizeListener implements HookListenerInterface
{
    public const PRIORITY = 1000;

    private static ?CommentHtmlSanitizer $sanitizer = null;

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function getSubscribedHooks(): array
    {
        return [
            'sirsoft-board.comment.store_validation_rules' => [
                'method' => 'addContentRules',
                'type' => 'filter',
                'priority' => self::PRIORITY,
            ],
            'sirsoft-board.comment.update_validation_rules' => [
                'method' => 'addContentRules',
                'type' => 'filter',
                'priority' => self::PRIORITY,
            ],
            'sirsoft-board.comment.filter_create_data' => [
                'method' => 'sanitizeData',
                'type' => 'filter',
                'priority' => self::PRIORITY,
            ],
            'sirsoft-board.comment.filter_update_data' => [
                'method' => 'sanitizeData',
                'type' => 'filter',
                'priority' => self::PRIORITY,
            ],
        ];
    }

    /**
     * `content` 규칙 배열 끝에 R1·R2 클로저 규칙을 덧붙인다.
     *
     * @param  array<string, mixed>  $rules  StoreCommentRequest/UpdateCommentRequest::rules() 결과
     * @param  mixed  ...$context  [FormRequest]
     * @return array<string, mixed>
     */
    public function addContentRules(array $rules, ...$context): array
    {
        if (! isset($rules['content']) || ! is_array($rules['content'])) {
            return $rules;
        }

        $min = self::extractMin($rules['content']);

        $rules['content'][] = function ($attribute, $value, $fail) use ($min): void {
            if (! is_string($value) || $value === '') {
                return; // required·string 은 코어 규칙이 판정한다
            }

            $result = self::sanitizer()->process($value);

            if (! $result['visible']) {
                $fail(__('g7-comment-editor::messages.sanitize.empty'));

                return;
            }

            if ($min !== null && mb_strlen($result['html']) < $min) {
                $fail(__('sirsoft-board::validation.comment.content.min', ['min' => $min]));
            }
        };

        return $rules;
    }

    /**
     * 저장 직전 `content` 를 정제본으로 바꾼다. 결과가 비면 저장을 거부한다.
     *
     * @param  array<string, mixed>  $data  생성/수정 데이터
     * @param  mixed  ...$context  생성: [$slug] / 수정: [$comment, $slug]
     * @return array<string, mixed>
     *
     * @throws CommentContentEmptyAfterSanitizeException
     */
    public function sanitizeData(array $data, ...$context): array
    {
        if (! array_key_exists('content', $data) || ! is_string($data['content'])) {
            return $data;
        }

        $result = self::sanitizer()->process($data['content']);

        if (! $result['visible']) {
            throw new CommentContentEmptyAfterSanitizeException;
        }

        $data['content'] = $result['html'];

        return $data;
    }

    /**
     * @inheritDoc
     */
    public function handle(...$args): void
    {
        // 이 리스너는 filter 훅만 구독한다.
    }

    private static function sanitizer(): CommentHtmlSanitizer
    {
        return self::$sanitizer ??= new CommentHtmlSanitizer;
    }

    /**
     * 코어 규칙 배열에서 `min:N` 값을 읽는다(게시판 설정 `min_comment_length`). 없으면 null.
     *
     * @param  array<int|string, mixed>  $contentRules
     */
    private static function extractMin(array $contentRules): ?int
    {
        foreach ($contentRules as $rule) {
            if (is_string($rule) && preg_match('~\Amin:(\d+)\z~', $rule, $m) === 1) {
                return (int) $m[1];
            }
        }

        return null;
    }
}
