'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function useCartDrawerLifecycle({
  isCartOpen,
  setIsCartOpen,
}: {
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
}) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const pathname = usePathname();
  const lastPathnameRef = useRef(pathname);
  const isCartOpenRef = useRef(isCartOpen);
  const setIsCartOpenRef = useRef(setIsCartOpen);
  const isCheckoutLoadingRef = useRef(isCheckoutLoading);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isCheckoutLoadingRef.current = isCheckoutLoading;
  }, [isCheckoutLoading]);

  useEffect(() => {
    isCartOpenRef.current = isCartOpen;
    setIsCartOpenRef.current = setIsCartOpen;
  }, [isCartOpen, setIsCartOpen]);

  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname;
      setIsCheckoutLoading(false);
      setCheckoutError(null);
      if (isCartOpen) {
        setIsCartOpen(false);
      }
    }
  }, [pathname, isCartOpen, setIsCartOpen]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Defer close past the synchronous React Strict Mode setup->cleanup->setup
      // replay so dynamically mounting the drawer while open does not close it.
      queueMicrotask(() => {
        if (!isMountedRef.current && isCartOpenRef.current) {
          setIsCartOpenRef.current(false);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!isCartOpen) {
      setIsCheckoutLoading(false);
      setCheckoutError(null);
    }
  }, [isCartOpen]);

  return {
    isCheckoutLoading,
    setIsCheckoutLoading,
    isCheckoutLoadingRef,
    checkoutError,
    setCheckoutError,
  };
}
