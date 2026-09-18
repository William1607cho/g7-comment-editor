<?php

namespace Plugins\G7\Comment\Editor;

use App\Extension\AbstractPlugin;
use Plugins\G7\Comment\Editor\Listeners\CommentSanitizeListener;

/**
 * 댓글 에디터 플러그인 (g7-comment-editor) — 뼈대(scaffold) 빌드 0.1.0-dev.
 *
 * sirsoft-board 의 댓글 입력창은 기본 사양상 순수 텍스트 `<textarea>` 다(에디터 없음).
 * 이 플러그인은 **sirsoft-board · sirsoft-ckeditor5 · 방문자 템플릿(sirsoft-basic) 을 한 줄도
 * 수정하지 않고**, `loading.strategy = global` 로 전 페이지에 로드되는 `dist/js/plugin.iife.js`
 * 하나로 다음을 수행한다:
 *
 *  1. **에디터 부착** — 댓글/답글/댓글수정 textarea(`name` = `comment_content` /
 *     `reply_content` / `editing_comment_content`)를 감지해 CKEditor 5 ClassicEditor 인스턴스로
 *     교체한다(굵게·기울임·글머리표·번호목록·링크만). 원본 textarea 는 DOM 에 숨긴 채 남겨,
 *     에디터 내용을 되써넣고 `input` 이벤트를 디스패치해 템플릿 엔진 상태(`_local.*`)와
 *     동기화한다 — 그래야 기존 등록/저장 흐름이 그대로 HTML 을 전송한다. 답글·수정 폼이
 *     여러 개 열려도 각각 독립 인스턴스로 동작한다.
 *  2. **저장 HTML 렌더 승격** — sirsoft-basic 의 댓글 목록은 본문을 `text` 바인딩으로 그리므로
 *     HTML 이 이스케이프되어 태그가 그대로 보인다. 이 스크립트가 렌더된 댓글 본문 노드를
 *     스캔해, **화이트리스트 새니타이저**(허용 목록은 resources/sanitize-policy.json)를 거친 뒤
 *     실제 서식으로 승격한다.
 *  3. **서버 측 저장 직전 정제 (1.2.0)** — `CommentSanitizeListener` 가 sirsoft-board 댓글 입력
 *     훅(검증 규칙 2 + 데이터 필터 2)에 붙어, 같은 허용 목록으로 PHP 에서 한 번 더 정제한다.
 *     API 로 직접 POST 해 브라우저의 제출 직전 정제를 건너뛴 댓글도 DB 에는 정제본만 남는다.
 *     정제 결과에 보이는 내용이 없으면 422 로 거부한다.
 *
 * **정제는 두 층이다(중복이 아니라 방어 계층).** 서버 정제가 저장값을 깨끗하게 하고, 브라우저의
 * 렌더 시 정제는 DB 에 이미 들어가 있는 것(1.2.0 이전 댓글, 직접 DB 조작, 향후 정책 결함)에 대한
 * 마지막 방어선이다. **서버 정제가 있어도 브라우저 정제기를 제거하지 않는다.**
 *
 * CKEditor 5 본체(UMD)와 CSS 는 `sirsoft-ckeditor5` 가 동봉해 same-origin 으로 서빙하는
 * 자산(`/api/plugins/assets/sirsoft-ckeditor5/dist/vendor/ckeditor5/43.3.1/…`)을 재사용한다.
 * 그래서 이 플러그인은 `dependencies.plugins` 로 `sirsoft-ckeditor5 >= 1.0.3` 에 의존한다.
 *
 * 서버측 코드는 위 3번의 훅 리스너 하나다(라우트·마이그레이션·설정 없음). 비활성화하면 전역
 * 스크립트와 서버 정제가 함께 꺼져, 댓글창은 순수 textarea 로, 저장된 댓글은 이스케이프된
 * 텍스트로 되돌아간다. 이미 정제되어 저장된 값은 그대로 남는다(무해).
 */
class Plugin extends AbstractPlugin
{
    /**
     * 플러그인 메타데이터.
     *
     * @return array<string, mixed>
     */
    public function getMetadata(): array
    {
        return [
            'author' => 'William Cho',
            'license' => 'MIT',
            'keywords' => ['comment', 'ckeditor5', 'editor', 'wysiwyg', 'rich-text', 'sirsoft-board', 'sanitize'],
        ];
    }

    /**
     * 훅 리스너 — 댓글 저장 직전 서버 측 HTML 정제 (1.2.0).
     *
     * @return array<int, class-string>
     */
    public function getHookListeners(): array
    {
        return [
            CommentSanitizeListener::class,
        ];
    }
}
