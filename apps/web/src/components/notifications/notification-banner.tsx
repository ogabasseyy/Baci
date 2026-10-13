'use client';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Info,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/use-notifications';
import { notificationActionUrl } from '@/lib/notification-action-url';
import { cn } from '@/lib/utils';
import type { ActiveBanner, NotificationType } from '@/types/notifications';

interface NotificationBannerProps {
  className?: string;
}

const bannerStyles: Record<
  NotificationType,
  {
    bg: string;
    border: string;
    icon: typeof Info;
    iconColor: string;
  }
> = {
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    border: 'border-blue-200 dark:border-blue-800',
    icon: Info,
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  success: {
    bg: 'bg-green-50 dark:bg-green-950/50',
    border: 'border-green-200 dark:border-green-800',
    icon: CheckCircle,
    iconColor: 'text-green-600 dark:text-green-400',
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/50',
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: AlertTriangle,
    iconColor: 'text-yellow-600 dark:text-yellow-400',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-950/50',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertCircle,
    iconColor: 'text-red-600 dark:text-red-400',
  },
};

/**
 * NotificationBanner - Displays the highest priority banner notification
 *
 * Features:
 * - Shows at top of dashboard content area
 * - Dismissible (persists dismissal)
 * - Auto-hides when expired
 * - Styled by notification type
 * - Smooth slide-in animation
 */
export function NotificationBanner({ className }: NotificationBannerProps) {
  const { activeBanners, dismissBanner, isLoading } = useNotifications();
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  // Get the highest priority banner
  const currentBanner = activeBanners[0];

  // Animate in when banner appears
  useEffect(() => {
    if (!currentBanner || isLoading) {
      return;
    }
    // Small delay for smooth animation
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => {
      clearTimeout(timer);
      // Reset visibility when the banner changes or is removed so the next
      // banner animates in from a hidden state.
      setIsVisible(false);
    };
  }, [currentBanner, isLoading]);

  const handleDismiss = async () => {
    if (!currentBanner) return;

    setIsDismissing(true);
    setIsVisible(false);

    // Wait for animation to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    await dismissBanner(currentBanner.id);
    setIsDismissing(false);
  };

  const handleAction = () => {
    notificationActionUrl.open(currentBanner?.action_url);
  };

  // Don't render if no banner or still loading
  if (!currentBanner || isLoading) {
    return null;
  }

  const style = bannerStyles[currentBanner.notification_type];
  const Icon = style.icon;
  const actionUrl = notificationActionUrl.parse(currentBanner.action_url);

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-300 ease-in-out',
        isVisible ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0',
        className
      )}
    >
      <div
        className={cn(
          'flex items-start gap-3 p-4 border rounded-lg mb-4',
          style.bg,
          style.border
        )}
        role="alert"
        aria-live="polite"
      >
        {/* Icon */}
        <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', style.iconColor)} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm">{currentBanner.title}</h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            {currentBanner.message}
          </p>

          {/* Action button */}
          {actionUrl && currentBanner.action_label && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 mt-2 text-sm"
              onClick={handleAction}
            >
              {currentBanner.action_label}
              <ExternalLink className="size-3 ml-1" />
            </Button>
          )}
        </div>

        {/* Dismiss button */}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 hover:bg-transparent"
          onClick={handleDismiss}
          disabled={isDismissing}
          aria-label="Dismiss notification"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * BannerStack - Shows multiple banners stacked (optional alternative)
 */
export function NotificationBannerStack({
  className,
  maxBanners = 3,
}: NotificationBannerProps & { maxBanners?: number }) {
  const { activeBanners, dismissBanner, isLoading } = useNotifications();
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const handleDismiss = async (banner: ActiveBanner) => {
    setDismissingIds((prev) => new Set(prev).add(banner.id));

    // Wait for animation
    await new Promise((resolve) => setTimeout(resolve, 300));

    await dismissBanner(banner.id);
    setDismissingIds((prev) => {
      const next = new Set(prev);
      next.delete(banner.id);
      return next;
    });
  };

  if (isLoading || activeBanners.length === 0) {
    return null;
  }

  const bannersToShow = activeBanners.slice(0, maxBanners);

  return (
    <div className={cn('space-y-2', className)}>
      {bannersToShow.map((banner) => {
        const style = bannerStyles[banner.notification_type];
        const Icon = style.icon;
        const isDismissing = dismissingIds.has(banner.id);
        const actionUrl = notificationActionUrl.parse(banner.action_url);

        return (
          <div
            key={banner.id}
            className={cn(
              'flex items-start gap-3 p-4 border rounded-lg transition-all duration-300',
              style.bg,
              style.border,
              isDismissing && 'opacity-0 -translate-x-4'
            )}
            role="alert"
          >
            <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', style.iconColor)} />

            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm">{banner.title}</h4>
              <p className="text-sm text-muted-foreground mt-0.5">
                {banner.message}
              </p>

              {actionUrl && banner.action_label && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 mt-2 text-sm"
                  onClick={() => notificationActionUrl.open(banner.action_url)}
                >
                  {banner.action_label}
                  <ExternalLink className="size-3 ml-1" />
                </Button>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 hover:bg-transparent"
              onClick={() => handleDismiss(banner)}
              disabled={isDismissing}
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
