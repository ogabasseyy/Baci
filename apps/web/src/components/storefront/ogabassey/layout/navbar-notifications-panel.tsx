'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { EmptyState } from '../components/empty-state';

interface NavbarNotificationsPanelProps {
  basePath: string;
  onClose: () => void;
}

export function NavbarNotificationsPanel({
  basePath,
  onClose,
}: NavbarNotificationsPanelProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <section
      className="absolute top-full right-0 z-50 mt-4 w-[min(20rem,calc(100vw-2rem))] animate-in overflow-hidden rounded-xl border border-store-border bg-store-background py-0 shadow-xl fade-in slide-in-from-top-2 md:w-80"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between border-store-border border-b bg-store-background-text/5 px-4 py-3">
        <h3 className="font-bold text-sm text-store-background-text">
          Notifications
        </h3>
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        <EmptyState
          variant="notifications"
          title="No Notifications"
          description="You have no unread notifications at this time."
          compact
        />
      </div>
      <div className="border-store-border border-t bg-store-background-text/5 p-2 text-center">
        <Link
          href={`${basePath}/account` as `/${string}`}
          prefetch={false}
          onClick={onClose}
          className="block py-1 font-bold text-store-background-text/70 text-xs hover:text-store-background-text"
        >
          View All
        </Link>
      </div>
    </section>
  );
}
