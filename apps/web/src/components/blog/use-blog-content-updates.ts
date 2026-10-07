import type { EditorInstance } from 'novel';
import { type RefObject, useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export function useBlogContentUpdates(
  onChange: (html: string) => void,
  onContentDirty?: () => void,
  contentGenerationRef?: RefObject<number>
) {
  const scheduledGenerationRef = useRef(contentGenerationRef?.current);
  const debouncedUpdates = useDebouncedCallback(
    (editor: Pick<EditorInstance, 'getHTML'>) => {
      // A reset applied after this edit was scheduled (e.g. a handoff
      // import whose remount cleanup can lose the race with an
      // already-due timer) invalidates the callback: drop it instead of
      // overwriting the new body with abandoned editor HTML.
      if (
        contentGenerationRef &&
        scheduledGenerationRef.current !== contentGenerationRef.current
      ) {
        return;
      }
      onChange(editor.getHTML());
    },
    500
  );
  useEffect(() => () => debouncedUpdates.cancel(), [debouncedUpdates]);

  return (editor: Pick<EditorInstance, 'getHTML'>) => {
    onContentDirty?.();
    scheduledGenerationRef.current = contentGenerationRef?.current;
    debouncedUpdates(editor);
  };
}
