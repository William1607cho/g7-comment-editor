<?php

namespace Plugins\G7\Comment\Editor\Providers;

use App\Extension\BasePluginServiceProvider;

/**
 * 댓글 에디터 플러그인 서비스 프로바이더.
 *
 * 이 플러그인은 순수 프론트엔드(global JS)라 컨테이너 바인딩·라우트·마이그레이션이 없다.
 * 코어 `PluginServiceProvider` 가 `src/Providers/*ServiceProvider.php` 를 자동 발견해
 * 등록하며, 식별자만 지정한다.
 */
class CommentEditorServiceProvider extends BasePluginServiceProvider
{
    protected string $pluginIdentifier = 'g7-comment-editor';
}
