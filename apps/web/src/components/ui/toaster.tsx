'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';

const TOAST_DURATION = 2000;

type ToastModule = typeof import('@/components/ui/toast');

let cachedToastModule: ToastModule | null = null;
let pendingToastModulePromise: Promise<ToastModule> | null = null;

function loadToastModule(): Promise<ToastModule> {
  if (!pendingToastModulePromise) {
    pendingToastModulePromise = (async () => {
      try {
        const mod = await import('@/components/ui/toast');
        cachedToastModule = mod;
        return mod;
      } catch (error) {
        pendingToastModulePromise = null;
        throw error;
      }
    })();
  }
  return pendingToastModulePromise;
}

export function Toaster() {
  const { toasts } = useToast();
  const [toastModule, setToastModule] = useState<ToastModule | null>(
    () => cachedToastModule
  );
  const activeToastKey = toasts
    .map((item) => `${item.id}:${String(item.open ?? true)}`)
    .join('|');

  useEffect(() => {
    if (toastModule || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    const preloadOnInteraction = () => {
      void (async () => {
        try {
          const mod = await loadToastModule();
          if (!cancelled) {
            setToastModule(() => mod);
          }
        } catch {
          // Ignore interaction-preload errors; toast dispatch will retry.
        }
      })();
    };

    window.addEventListener('pointerdown', preloadOnInteraction, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', preloadOnInteraction, {
      once: true,
      passive: true,
    });

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', preloadOnInteraction);
      window.removeEventListener('keydown', preloadOnInteraction);
    };
  }, [toastModule]);

  useEffect(() => {
    if (!activeToastKey || toastModule) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const mod = await loadToastModule();
        if (!cancelled) {
          setToastModule(() => mod);
        }
      } catch {
        // Leave toastModule null so a subsequent toast or replacement can retry.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeToastKey, toastModule]);

  if (!toastModule) {
    if (toasts.length === 0) {
      return null;
    }

    return (
      <div
        aria-live="polite"
        className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]"
      >
        {toasts
          .filter((item) => item.open !== false)
          .map(({ id, title, description, action }) => (
            <output
              className="pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border bg-background p-6 pr-8 text-foreground shadow-lg"
              key={id}
            >
              <div className="grid gap-1">
                {title && <div className="text-sm font-semibold">{title}</div>}
                {description && (
                  <div className="text-sm opacity-90">{description}</div>
                )}
              </div>
              {action}
            </output>
          ))}
      </div>
    );
  }

  const {
    Toast,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
  } = toastModule;

  return (
    <ToastProvider duration={TOAST_DURATION}>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} duration={TOAST_DURATION} {...props}>
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
