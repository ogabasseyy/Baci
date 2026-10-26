'use client';

import { Cookie, Settings2, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { ThemedButton } from '@/components/themed';
import { Button } from '@/components/ui/button';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCookieConsentController } from './use-cookie-consent-controller';

export { isCookieAllowed } from './is-cookie-allowed';
export { useCookieConsent } from './use-cookie-consent';

export function CookieConsent() {
  const {
    isVisible,
    isClosing,
    showDetails,
    setShowDetails,
    hasStorageError,
    preferences,
    setPreferences,
    acceptAll,
    acceptNecessary,
    savePreferences,
  } = useCookieConsentController();
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath || '';
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isVisible) {
      const activeElement = document.activeElement;
      const chatAnchor =
        activeElement instanceof HTMLElement
          ? activeElement.closest('.ogabassey-chat-anchor')
          : null;
      const chatIsOpen = Boolean(
        chatAnchor?.querySelector('.ogabassey-chat-window')
      );
      if (activeElement instanceof HTMLElement && chatAnchor && !chatIsOpen) {
        restoreFocusRef.current = activeElement;
        dialogRef.current
          ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          ?.focus();
      }
      return;
    }

    const previousFocus = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'storefront-cookie-consent fixed bottom-4 left-4 right-4 z-[100] md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-5xl w-auto md:w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto',
        isClosing
          ? 'animate-out fade-out slide-out-to-bottom-4 duration-200'
          : 'animate-in slide-in-from-bottom-4 duration-500',
        'will-change-transform'
      )}
      style={{
        contain: 'layout style paint',
      }}
      role="dialog"
      aria-label="Cookie consent"
      ref={dialogRef}
    >
      <div
        className={cn(
          'bg-background backdrop-blur-xl border border-border/50 shadow-2xl rounded-2xl p-4',
          'transition-all duration-300 ease-in-out'
        )}
      >
        {hasStorageError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Unable to save your cookie preferences. Please try again. Optional
            tracking remains disabled.
          </p>
        )}
        {!showDetails ? (
          // Simple View - Horizontal Floating Bar
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
            <div className="flex items-center gap-4 flex-1 w-full md:w-auto">
              <div className="hidden sm:flex items-center justify-center size-10 rounded-full bg-primary/10 shrink-0">
                <Cookie className="size-5 text-primary" />
              </div>

              <div className="flex-1 space-y-1">
                <h3 className="font-semibold text-sm">We value your privacy</h3>
                <p className="text-sm text-muted-foreground leading-snug">
                  We use cookies to improve your experience. By using our store,
                  you agree to our{' '}
                  <Link
                    href={asRoute(`${basePath}/privacy`)}
                    className="underline underline-offset-4 hover:text-white"
                  >
                    Read our policy
                  </Link>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(true)}
                className="text-muted-foreground hover:text-foreground h-9"
                type="button"
              >
                Customize
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={acceptNecessary}
                className="h-9"
              >
                Necessary Only
              </Button>
              <ThemedButton
                colorRole="primary"
                size="sm"
                onClick={acceptAll}
                className="h-9 px-6 shadow-sm"
              >
                Accept All
              </ThemedButton>
            </div>
          </div>
        ) : (
          // Detailed View - Expanded
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center justify-center size-10 rounded-full bg-primary/10 shrink-0">
                  <Settings2 className="size-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Cookie Preferences</h3>
                  <p className="text-sm text-muted-foreground">
                    Manage your cookie settings below. Necessary cookies are
                    always enabled.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
                aria-label="Close details"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 max-h-[60vh] overflow-y-auto pr-2">
              {/* Necessary Cookies */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                <div className="flex items-center justify-center size-8 rounded-lg bg-green-500/10 shrink-0">
                  <Shield className="size-4 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">Necessary</span>
                    <span className="text-xs text-green-600 font-medium bg-green-500/10 px-2 py-0.5 rounded-full">
                      Required
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Essential for the website to function properly. Cannot be
                    disabled.
                  </p>
                </div>
              </div>

              {/* Functional Cookies */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                <input
                  type="checkbox"
                  id="functional"
                  checked={preferences.functional}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      functional: e.target.checked,
                    }))
                  }
                  className="mt-1 size-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label
                  htmlFor="functional"
                  className="flex-1 cursor-pointer select-none"
                >
                  <span className="font-medium text-sm">Functional</span>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Remember your preferences and settings for a better
                    experience.
                  </p>
                </label>
              </div>

              {/* Analytics Cookies */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                <input
                  type="checkbox"
                  id="analytics"
                  checked={preferences.analytics}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      analytics: e.target.checked,
                    }))
                  }
                  className="mt-1 size-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label
                  htmlFor="analytics"
                  className="flex-1 cursor-pointer select-none"
                >
                  <span className="font-medium text-sm">Analytics</span>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Help us improve our site by understanding how you use it.
                  </p>
                </label>
              </div>

              {/* Marketing Cookies */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                <input
                  type="checkbox"
                  id="marketing"
                  checked={preferences.marketing}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      marketing: e.target.checked,
                    }))
                  }
                  className="mt-1 size-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label
                  htmlFor="marketing"
                  className="flex-1 cursor-pointer select-none"
                >
                  <span className="font-medium text-sm">Marketing</span>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Allow us to show you relevant content and promotions.
                  </p>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/50 mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(false)}
                className="text-muted-foreground h-9"
              >
                Cancel
              </Button>
              <ThemedButton
                colorRole="primary"
                size="sm"
                onClick={savePreferences}
                className="h-9 px-6"
              >
                Save Preferences
              </ThemedButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
