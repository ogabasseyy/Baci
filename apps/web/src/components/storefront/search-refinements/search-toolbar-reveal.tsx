'use client';
import { type ReactNode, useEffect, useState } from 'react';
import { useOgabasseyScrollVisibility } from '../ogabassey/scroll-visibility-store';

/** Share the navbar's direction listener; keep desktop filters and focused controls visible. */
export function SearchToolbarReveal({
  pinned,
  children,
}: {
  pinned: boolean;
  children: ReactNode;
}) {
  const scrollingVisible = useOgabasseyScrollVisibility();
  const [desktop, setDesktop] = useState(false);
  const [focused, setFocused] = useState(false);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1024px)');
    const updateDesktop = () => setDesktop(media?.matches ?? false);
    updateDesktop();
    media?.addEventListener('change', updateDesktop);
    const navbar = document.querySelector('.ogabassey-navbar');
    const updateTop = () => setTop(navbar?.getBoundingClientRect().height ?? 0);
    updateTop();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateTop);
    if (navbar) observer?.observe(navbar);
    return () => {
      media?.removeEventListener('change', updateDesktop);
      observer?.disconnect();
    };
  }, []);
  const hidden = !desktop && !pinned && !focused && !scrollingVisible;
  return (
    <div
      data-testid="search-toolbar-reveal"
      aria-hidden={hidden || undefined}
      inert={hidden}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
      style={{ top }}
      className={`sticky z-40 bg-store-background pb-2 transition-[transform,opacity] duration-150 motion-reduce:transition-none lg:static lg:pb-0 ${hidden ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}
    >
      {children}
    </div>
  );
}
