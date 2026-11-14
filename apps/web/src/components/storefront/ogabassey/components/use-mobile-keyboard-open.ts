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
    let pointerDown = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const updateFocus = (target: EventTarget | null) => {
      if (isTextEntry(target)) setOpen(true);
      else if (!pointerDown) setOpen(false);
    };
    const onFocus = (event: FocusEvent) => updateFocus(event.target);
    const onBlur = (event: FocusEvent) => updateFocus(event.relatedTarget);
    const onPointerDown = () => { pointerDown = true; clearTimeout(releaseTimer); };
    const onPointerEnd = () => {
      pointerDown = false;
      // Wait for click to be dispatched before the fixed summary can cover it.
      releaseTimer = setTimeout(() => updateFocus(document.activeElement), 0);
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerEnd, true);
    document.addEventListener('pointercancel', onPointerEnd, true);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
    };
  }, []);
  return open;
}
