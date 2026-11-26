'use client';

import type { ExperienceManifest } from '@baci/shared/experience';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { createContext, useContext, useLayoutEffect, useState } from 'react';
import {
  ChatwootWidget,
  type ChatwootWidgetConfig,
} from '@/components/storefront/chatwoot-widget';
import { OgabasseyLayoutProviders } from '@/components/storefront/ogabassey/storefront-layout-providers';
import {
  getOgabasseyLayoutStyle,
  shouldHideOgabasseyNavigation,
} from '@/components/storefront/ogabassey/storefront-layout-utils';
import type { StorefrontAppearance } from '@/components/storefront/storefront-appearance';
import { StorefrontThemeProvider } from '@/components/storefront/storefront-theme-provider';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import type { StorefrontShellSnapshot } from '@/hooks/merchant/types';
import {
  isCategorizedExperienceProductPath,
  resolveExperienceRoute,
} from '@/lib/experience/route-ownership';
import { merchantHasFeature } from '@/lib/merchant-has-feature';

export type StorefrontShellBridgeState =
  | {
      kind: 'ready';
      appearance: StorefrontAppearance;
      chatwootConfig: ChatwootWidgetConfig | null;
      experienceRoutes: ExperienceManifest['routes'] | null;
      shellSnapshot: StorefrontShellSnapshot;
    }
  | {
      kind: 'unpublished';
      appearance: StorefrontAppearance;
    };

type PublishBridgeState = (next: StorefrontShellBridgeState | null) => void;

const StorefrontShellBridgeContext = createContext<PublishBridgeState | null>(
  null
);

function isOwnedByExperience(
  routes: ExperienceManifest['routes'] | null | undefined,
  basePath: string,
  pathname: string | null
): boolean {
  if (!routes || routes.length === 0) {
    return false;
  }

  const resolvedPathname = pathname ?? '';
  const path =
    resolvedPathname === basePath
      ? '/'
      : resolvedPathname.startsWith(`${basePath}/`)
        ? resolvedPathname.slice(basePath.length)
        : null;

  return Boolean(
    path &&
      (resolveExperienceRoute(routes, path) ||
        (routes.some((route) => route.view === 'product') &&
          isCategorizedExperienceProductPath(path)))
  );
}

export function StorefrontShellBridgeSync({
  appearance,
  chatwootConfig,
  experienceRoutes = null,
  shellSnapshot,
}: {
  appearance: StorefrontAppearance;
  chatwootConfig: ChatwootWidgetConfig | null;
  experienceRoutes?: ExperienceManifest['routes'] | null;
  shellSnapshot: StorefrontShellSnapshot;
}) {
  const publish = useContext(StorefrontShellBridgeContext);

  useLayoutEffect(() => {
    publish?.({
      kind: 'ready',
      appearance,
      chatwootConfig,
      experienceRoutes,
      shellSnapshot,
    });
  }, [appearance, chatwootConfig, experienceRoutes, publish, shellSnapshot]);

  return null;
}

export function StorefrontShellUnpublishedSync({
  appearance,
}: {
  appearance: StorefrontAppearance;
}) {
  const publish = useContext(StorefrontShellBridgeContext);

  useLayoutEffect(() => {
    publish?.({
      kind: 'unpublished',
      appearance,
    });
  }, [appearance, publish]);

  return null;
}

export function StorefrontClientShell({
  children,
  dynamicSlot,
  fallbackAppearance,
  headerSlot,
}: {
  children: React.ReactNode;
  dynamicSlot: React.ReactNode;
  fallbackAppearance: StorefrontAppearance;
  headerSlot: React.ReactNode;
}) {
  const pathname = usePathname();
  const [bridgeState, setBridgeState] =
    useState<StorefrontShellBridgeState | null>(null);

  const readyState = bridgeState?.kind === 'ready' ? bridgeState : null;
  const shellSnapshot = readyState?.shellSnapshot ?? null;
  const merchant = shellSnapshot?.merchant ?? null;
  const activeAppearance = bridgeState?.appearance ?? fallbackAppearance;
  const basePath = shellSnapshot
    ? shellSnapshot.routingMode === 'domain'
      ? ''
      : `/${merchant?.slug ?? ''}`
    : '';
  const isExperienceOwned = readyState
    ? isOwnedByExperience(readyState.experienceRoutes, basePath, pathname)
    : false;
  const isOgabasseyTemplate = merchant?.template_id === OGABASSEY_TEMPLATE_ID;
  const showOgabasseyChrome = isOgabasseyTemplate && !isExperienceOwned;
  const hideNavigation = shouldHideOgabasseyNavigation(pathname);
  const merchantSlug = merchant?.slug ?? null;

  return (
    <StorefrontShellBridgeContext.Provider value={setBridgeState}>
      <StorefrontThemeProvider
        appearance={activeAppearance}
        scopeDocument={bridgeState !== null}
      >
        <StorefrontMerchantProvider
          loading={!shellSnapshot}
          shellSnapshot={shellSnapshot}
          slug={merchantSlug ?? ''}
        >
          <StorefrontCartProvider
            deferValidationUntilIdle
            enableSmartCartPro
            merchantId={merchant?.id ?? null}
            merchantSlug={merchantSlug}
            sharedCartAccountsEnabled={
              merchant
                ? merchantHasFeature(merchant, 'shared_cart_accounts')
                : false
            }
            sharedCartEnabled={
              merchant ? merchantHasFeature(merchant, 'shared_cart') : false
            }
            sharedCartRealtimeEnabled={
              merchant
                ? merchantHasFeature(merchant, 'shared_cart_realtime')
                : false
            }
          >
            <OgabasseyLayoutProviders
              enabled={activeAppearance.variant === 'ogabassey'}
            >
              <ChatwootWidget config={readyState?.chatwootConfig ?? null}>
                {bridgeState?.kind === 'unpublished' ? null : (
                  <div
                    className={
                      showOgabasseyChrome
                        ? 'ogabassey-storefront-shell'
                        : 'contents'
                    }
                    style={
                      showOgabasseyChrome && merchant
                        ? getOgabasseyLayoutStyle(merchant)
                        : undefined
                    }
                  >
                    {!isExperienceOwned ? (
                      <div
                        className="storefront-header-slot"
                        data-hide-navigation={
                          hideNavigation ? 'true' : undefined
                        }
                      >
                        {headerSlot}
                      </div>
                    ) : null}
                    <div
                      key="storefront-route-body"
                      className={
                        showOgabasseyChrome
                          ? 'ogabassey-storefront-main'
                          : 'storefront-route-body'
                      }
                      id={showOgabasseyChrome ? 'main-content' : undefined}
                    >
                      {children}
                    </div>
                  </div>
                )}
                {dynamicSlot}
              </ChatwootWidget>
            </OgabasseyLayoutProviders>
          </StorefrontCartProvider>
        </StorefrontMerchantProvider>
      </StorefrontThemeProvider>
    </StorefrontShellBridgeContext.Provider>
  );
}
