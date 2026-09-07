'use client';

import { RefreshCw, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfirmedOffline } from './use-confirmed-offline';

export function OfflineNotice() {
  const isOffline = useConfirmedOffline();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isOffline) setDismissed(false);
  }, [isOffline]);

  if (!isOffline || dismissed) return null;

  return (
    <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-100 w-[90%] md:w-auto max-w-[calc(100%-2rem)] animate-in slide-in-from-bottom-5 duration-300">
      <div className="bg-store-background text-store-background-text px-4 py-3 rounded-xl shadow-2xl border border-store-primary/30 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-store-primary/20 flex items-center justify-center text-store-primary">
            <WifiOff size={18} />
          </div>
          <div>
            <p className="text-sm font-bold">No Internet Connection</p>
            <p className="text-xs text-store-background-text/70">
              Please check your network settings.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-store-primary/10 hover:bg-store-primary/20 p-2 rounded-lg transition-colors text-store-background-text"
          aria-label="Refresh page"
        >
          <RefreshCw size={18} />
        </button>
        <button
          type="button"
          aria-label="Dismiss connection notice"
          onClick={() => setDismissed(true)}
          className="p-2"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
