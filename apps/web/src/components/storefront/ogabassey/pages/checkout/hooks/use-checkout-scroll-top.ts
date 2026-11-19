'use client';
import { useEffect } from 'react';
/** Begin each mounted checkout at the top of the page. */
export function useCheckoutScrollTop() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}
