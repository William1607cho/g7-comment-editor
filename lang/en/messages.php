<?php

/**
 * Server-side translations (PHP __()).
 *
 * Since 1.2.0 the server-side comment sanitizer (CommentSanitizeListener) uses this file for its
 * validation message. Front-end strings live in resources/lang/{locale}.json.
 */
return [
    'name' => 'Comment Editor',
    'sanitize' => [
        'empty' => 'Nothing is left to save once disallowed formatting is removed.',
    ],
];
