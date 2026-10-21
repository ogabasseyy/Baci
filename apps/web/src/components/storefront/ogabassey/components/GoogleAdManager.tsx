'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export const GoogleAdManager = () => {
  const pathname = usePathname();

  useEffect(() => {
    void import('./google-ad-bootstrap').then(({ setGoogleAdManagerPath }) => {
      setGoogleAdManagerPath(pathname);
    });
  }, [pathname]);

  return null;
};
