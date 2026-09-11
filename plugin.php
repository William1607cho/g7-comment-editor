<?php

namespace Plugins\G7\Comment\Editor;

use App\Extension\AbstractPlugin;

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
 *     스캔해, **허용 태그(p·br·strong/b·em/i·u·s·ul·ol·li·a[href]) 만 남기는 화이트리스트
 *     새니타이저**를 거친 뒤 실제 서식으로 승격한다. 서버는 댓글 HTML 을 그대로 저장/반환하고
 *     (검열 없음), 승격 시 이스케이프가 풀리므로 **XSS 방어는 이 새니타이저가 전담**한다.
 *
 * CKEditor 5 본체(UMD)와 CSS 는 `sirsoft-ckeditor5` 가 동봉해 same-origin 으로 서빙하는
 * 자산(`/api/plugins/assets/sirsoft-ckeditor5/dist/vendor/ckeditor5/43.3.1/…`)을 재사용한다.
 * 그래서 이 플러그인은 `dependencies.plugins` 로 `sirsoft-ckeditor5 >= 1.0.3` 에 의존한다.
 *
 * 서버측 코드(라우트·마이그레이션·설정·훅)는 없다. 비활성화하면 전역 스크립트가 더 이상
 * 로드되지 않아 댓글창은 순수 textarea 로, 저장된 댓글은 이스케이프된 텍스트로 되돌아간다.
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
            'keywords' => ['comment', 'ckeditor5', 'editor', 'wysiwyg', 'rich-text', 'sirsoft-board'],
        ];
    }
}
