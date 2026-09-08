'use client';

import { useEffect, useState } from 'react';

/** Browser network hints can report offline while the storefront is reachable. */
export function useConfirmedOffline() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let controller: AbortController | undefined;
    let disposed = false;
    const check = async () => {
      controller?.abort();
      controller = undefined;
      if (navigator.onLine) {
        setIsOffline(false);
        return;
      }
      const current = new AbortController();
      controller = current;
      const timeout = window.setTimeout(() => current.abort(), 5000);
      try {
        // Any HTTP response proves reachability, even a server error.
        await fetch('/placeholder.svg', {
          method: 'HEAD',
          cache: 'no-store',
          signal: current.signal,
        });
        if (!disposed && controller === current) setIsOffline(false);
      } catch {
        if (!disposed && controller === current) setIsOffline(true);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const onChange = () => void check();
    onChange();
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    const interval = window.setInterval(onChange, 30000);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);

  return isOffline;
}
