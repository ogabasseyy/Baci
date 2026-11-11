'use client';
import { useEffect, useRef } from 'react';
import type { PresentedCanonicalLink } from './experience-navigation-open';
export function ExperienceNavigationPresentation({
  link,
  onCancel,
  onSameTab,
}: {
  link: PresentedCanonicalLink | null;
  onCancel: () => void;
  onSameTab: (href: string) => void;
}) {
  const anchor = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!link) return;
    const previous = document.activeElement;
    anchor.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [link]);
  if (!link) return null;
  return (
    <aside role="dialog" aria-label="Open storefront page">
      <p role="status">Your link is ready.</p>
      <a
        ref={anchor}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in new tab
      </a>
      <a
        href={link.href}
        onClick={(event) => {
          event.preventDefault();
          onSameTab(link.href);
        }}
      >
        Open here
      </a>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </aside>
  );
}
