import type { EditorInstance } from 'novel';
import { useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export function useBlogContentUpdates(
  onChange: (html: string) => void,
  onContentDirty?: () => void
) {
  const debouncedUpdates = useDebouncedCallback(
    (editor: Pick<EditorInstance, 'getHTML'>) => onChange(editor.getHTML()),
    500
  );
  useEffect(() => () => debouncedUpdates.cancel(), [debouncedUpdates]);

  return (editor: Pick<EditorInstance, 'getHTML'>) => {
    onContentDirty?.();
    debouncedUpdates(editor);
  };
}
