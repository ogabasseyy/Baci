'use client';

import type { MouseEvent, ReactNode } from 'react';

function preventsLinkNavigation(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a[href]') !== null;
}

function interceptPreviewNavigation(event: MouseEvent<HTMLElement>): void {
  if (!preventsLinkNavigation(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
}

export function PreviewNavigationGuard({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="builder-preview-navigation-guard"
      inert
      onAuxClickCapture={interceptPreviewNavigation}
      onClickCapture={interceptPreviewNavigation}
    >
      {children}
    </div>
  );
}
