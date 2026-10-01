'use client';

import { useEffect } from 'react';

interface AppSansFontDocumentClassProps {
  className: string;
}

/** Mirror Inter onto `document.body` so Radix portals and the root toaster inherit it. */
export function AppSansFontDocumentClass({
  className,
}: AppSansFontDocumentClassProps) {
  useEffect(() => {
    const tokens = className.split(/\s+/).filter(Boolean);
    document.body.classList.add(...tokens);
    return () => {
      document.body.classList.remove(...tokens);
    };
  }, [className]);

  return null;
}
