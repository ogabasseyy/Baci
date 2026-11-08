'use client';

import { useEffect, useState } from 'react';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'file', 'date'].includes(target.type) && !target.readOnly;
}

export function useMobileKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onFocus = (event: FocusEvent) => setOpen(isTextEntry(event.target));
    const onBlur = (event: FocusEvent) => setOpen(isTextEntry(event.relatedTarget));
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, []);
  return open;
}
