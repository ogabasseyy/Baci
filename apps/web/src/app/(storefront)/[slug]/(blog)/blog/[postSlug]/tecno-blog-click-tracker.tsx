'use client';

import { useEffect } from 'react';
import { captureTecnoBlogClick } from '@/lib/posthog/capture-tecno-blog-click';

export function TecnoBlogClickTracker() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (anchor) captureTecnoBlogClick(anchor.href);
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('auxclick', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('auxclick', handleClick);
    };
  }, []);

  return null;
}
