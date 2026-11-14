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
    return () => {
      if (isCartOpenRef.current) {
        setIsCartOpenRef.current(false);
      }
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
