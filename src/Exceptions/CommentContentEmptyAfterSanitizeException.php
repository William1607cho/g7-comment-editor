<?php

namespace Plugins\G7\Comment\Editor\Exceptions;

use RuntimeException;

/**
 * 정제 결과에 보이는 내용이 없어 댓글 저장을 거부할 때 던진다 (1.2.0).
 *
 * HTTP 요청은 검증 규칙(R1)이 먼저 422 로 막으므로 여기까지 오지 않는다. 정제는 결정적이라
 * 규칙을 통과한 입력이 데이터 필터에서 비는 일은 없다. 이 예외는 FormRequest 를 거치지 않고
 * `CommentService` 를 직접 부르는 경로(내부 호출·다른 확장)를 위한 최종 관문이다 —
 * 원문을 그대로 두거나 빈 채로 저장하지 않는다.
 */
class CommentContentEmptyAfterSanitizeException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('g7-comment-editor: comment content is empty after sanitization; refusing to store it.');
    }
}
