import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { orderedList } from './ordered-list';

const editors: Editor[] = [];

function mount(content: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    extensions: [StarterKit.configure({ orderedList: false }), orderedList],
    content,
  });
  // The constructor leaves the view unmounted; explicit mount is
  // the supported attach path.
  editor.mount(element);
  editors.push(editor);
  return editor;
}

function renderedMarker(editor: Editor): string {
  return editor.view.dom.querySelector('ol')?.getAttribute('class') ?? '';
}

describe('orderedList', () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) {
      editor.destroy();
    }
    document.body.innerHTML = '';
  });

  it('renders imported alphabetic lists alphabetically and keeps the type through an edit', () => {
    const editor = mount('<ol type="A"><li>One</li></ol>');
    expect(renderedMarker(editor)).toContain('list-[upper-alpha]');

    editor.chain().focus('end').insertContent('<li>Two</li>').run();

    const serialized = editor.getHTML();
    expect(serialized).toContain('type="A"');
    expect(serialized).toContain('Two');
    expect(renderedMarker(editor)).toContain('list-[upper-alpha]');
  });

  it('renders default lists decimal', () => {
    const editor = mount('<ol><li>One</li></ol>');
    expect(renderedMarker(editor)).toContain('list-decimal');
    expect(editor.getHTML()).not.toContain('type=');
  });

  it('falls back to decimal for invalid types, like the browser', () => {
    const editor = mount('<ol type="bogus"><li>One</li></ol>');
    expect(renderedMarker(editor)).toContain('list-decimal');
  });
});
