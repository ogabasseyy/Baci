'use client';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCartSafe } from '@/hooks/cart/cart-context';
import { resolveCatalogExperienceRoute } from '@/lib/experience/catalog-route-ownership';
import { asRoute } from '@/lib/routes';
import { ExperienceFrame } from './ExperienceFrame';
import { createPublishedExperienceHost } from './experience-host-runtime';
import { ExperienceShellContext } from './experience-shell-context';
import { createExperienceShellController } from './experience-shell-controller';
export function ExperienceShell({
  children,
  merchantSlug,
}: {
  children: ReactNode;
  merchantSlug: string;
}) {
  const [controller] = useState(createExperienceShellController);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot
  );
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCartSafe();
  const live = useRef({ state, cart, router, pathname });
  useEffect(() => {
    live.current = { state, cart, router, pathname };
  });
  const [checkoutPresented, setCheckoutPresented] = useState(false);
  const [boundInstance, setBoundInstance] = useState<string | null>(null);
  const [runtime] = useState(() =>
    createPublishedExperienceHost({
      controller,
      live,
      merchantSlug,
      present: () => setCheckoutPresented(true),
    })
  );
  useEffect(() => {
    if (
      !state ||
      /(?:^|\/)(checkout|account|auth|api)(?:\/|$)/.test(pathname ?? '')
    )
      return;
    const data = state.data;
    document.title = data.title;
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.append(link);
    }
    link.href = data.canonicalUrl;
  }, [state, pathname]);
  useEffect(() => {
    if (!state?.active) return;
    let mounted = true;
    let checkGeneration = 0;
    const instance = state.data.launch.instanceId;
    const check = () => {
      const generation = ++checkGeneration;
      void runtime
        .isActive()
        .then((valid) => {
          if (mounted && generation === checkGeneration)
            setBoundInstance(valid ? instance : null);
        })
        .catch(() => {
          if (mounted && generation === checkGeneration) setBoundInstance(null);
        });
    };
    check();
    const checkVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const timer = setInterval(checkVisible, 30000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', checkVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', checkVisible);
    };
  }, [runtime, state?.active, state?.data.launch.instanceId]);
  useEffect(() => {
    if (!state || !pathname) return;
    const base = new URL(state.data.launch.canonicalBase).pathname.replace(
      /\/$/,
      ''
    );
    const relative =
      pathname === base
        ? '/'
        : pathname.startsWith(`${base}/`)
          ? pathname.slice(base.length)
          : null;
    if (
      !relative ||
      !resolveCatalogExperienceRoute(
        state.data.manifest.routes,
        relative,
        state.data.bootstrap.catalog.products
      )
    )
      controller.exit();
  }, [controller, pathname, state]);
  const isCheckout = /(?:^|\/)(checkout|account|auth|api)(?:\/|$)/.test(
    pathname ?? ''
  );
  useEffect(() => {
    if (isCheckout) {
      controller.exit();
      setCheckoutPresented(false);
    }
  }, [isCheckout, controller]);
  return (
    <ExperienceShellContext.Provider value={controller}>
      {state?.active && !isCheckout && (
        <ExperienceFrame
          launch={state.data.launch}
          isActive={runtime.isActive}
          host={runtime.host}
          admitted={boundInstance === state.data.launch.instanceId}
          presented={state.ready}
        />
      )}
      {children}
      {checkoutPresented && state?.active && (
        <Dialog open={checkoutPresented} onOpenChange={setCheckoutPresented}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
            <DialogTitle>Continue to checkout</DialogTitle>
            <DialogDescription>
              Continue with Baci checkout to choose delivery and review your
              total.
            </DialogDescription>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setCheckoutPresented(false);
                  router.push(
                    asRoute(
                      new URL(
                        state.data.launch.canonicalBase.replace(/\/$/, '') +
                          '/checkout'
                      ).pathname
                    )
                  );
                }}
              >
                Continue to checkout
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCheckoutPresented(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </ExperienceShellContext.Provider>
  );
}
