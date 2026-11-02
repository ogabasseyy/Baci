'use client';

import { Bell } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const NavbarNotificationsPanel = lazy(async () => {
  const module = await import('./navbar-notifications-panel');
  return { default: module.NavbarNotificationsPanel };
});

function NotificationsPanelLoading() {
  return (
    <div
      role="status"
      aria-label="Loading notifications"
      className="absolute top-full right-0 mt-4 block w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-store-border bg-store-background p-4 shadow-xl md:w-80"
    >
      <div className="h-4 w-28 animate-pulse rounded-full bg-store-background-text/15" />
    </div>
  );
}

interface NavbarNotificationsProps {
  basePath: string;
}

export function NavbarNotifications({
  basePath,
}: NavbarNotificationsProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotifications) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  return (
    <div className="flex items-center md:relative" ref={notificationRef}>
      <button
        onClick={() => setShowNotifications((current) => !current)}
        aria-label="Toggle notifications"
        aria-expanded={showNotifications}
        type="button"
        className={`ogabassey-navbar__icon-link relative flex items-center justify-center transition-colors ${showNotifications ? 'text-white' : ''}`}
      >
        <Bell size={22} />
      </button>

      {showNotifications ? (
        <Suspense fallback={<NotificationsPanelLoading />}>
          <NavbarNotificationsPanel
            basePath={basePath}
            onClose={() => setShowNotifications(false)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
