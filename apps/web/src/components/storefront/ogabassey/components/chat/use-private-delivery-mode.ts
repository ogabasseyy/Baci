'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

export function usePrivateDeliveryMode(eligible: boolean, setInput: (value: string) => void) {
  const [active, setActive] = useState(false);
  const [composerLocked, setComposerLocked] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (eligible || !active) return;
    setInput('');
    setActive(false);
    setComposerLocked(false);
    submitRef.current = null;
  }, [active, eligible, setInput]);

  return {
    active,
    start: () => setActive(true),
    close: () => {
      setInput('');
      setActive(false);
      setComposerLocked(false);
    },
    composerLocked,
    setComposerLocked,
    submitRef,
    handleComposerSubmit: (event: FormEvent, normalSubmit: (event: FormEvent) => void) => {
      if (!active) {
        normalSubmit(event);
        return;
      }
      event.preventDefault();
      submitRef.current?.();
    },
  };
}
