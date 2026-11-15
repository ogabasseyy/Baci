'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { attachSearchDocking } from './access-search-docking';

export function AccessSearchDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return attachSearchDocking(
      ref.current,
      document.querySelector<HTMLElement>('.ogabassey-navbar')
    );
  }, []);
  return <div ref={ref} className="oa-search-slot">{children}</div>;
}
