<?php

/**
 * 서버측 번역 (PHP __()).
 *
 * 1.2.0 부터 서버 측 댓글 정제(CommentSanitizeListener)가 검증 오류 문구로 이 파일을 참조한다.
 * 프론트 문구는 resources/lang/{locale}.json 을 본다.
 */
return [
    'name' => '댓글 에디터',
    'sanitize' => [
        'empty' => '허용되지 않는 서식만 있어 저장할 내용이 없습니다.',
    ],
];
