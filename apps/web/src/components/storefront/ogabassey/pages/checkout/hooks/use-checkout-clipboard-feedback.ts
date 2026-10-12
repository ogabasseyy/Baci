'use client';

import { useEffect, useRef, useState } from 'react';

const COPIED_FEEDBACK_DURATION_MS = 2000;

export function useCheckoutClipboardFeedback() {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(false);

  const copyToClipboard = async (text: string) => {
    const requestId = ++requestRef.current;
    try {
      await navigator.clipboard.writeText(text);
      if (!mountedRef.current || requestId !== requestRef.current) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setCopiedText(text);
      timeoutRef.current = setTimeout(() => {
        setCopiedText(null);
        timeoutRef.current = null;
      }, COPIED_FEEDBACK_DURATION_MS);
    } catch (error) {
      console.error('Clipboard API not available:', error);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { copiedText, copyToClipboard };
}
