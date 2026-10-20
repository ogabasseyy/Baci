'use client';
import { useEffect, useRef, useState } from 'react';
export function useBottomToolbarSpace() {
  const toolbar = useRef<HTMLDivElement>(null);
  const [bottomSpace, setBottomSpace] = useState(0);
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBottomSpace(
        rect.height
          ? rect.height + Math.max(0, window.innerHeight - rect.bottom) + 16
          : 0
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return { toolbar, bottomSpace };
}
