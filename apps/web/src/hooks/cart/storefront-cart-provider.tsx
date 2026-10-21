'use client';

import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { StorefrontLegacyCartProvider } from './storefront-legacy-cart-provider';
import type { StorefrontCartProviderProps } from './storefront-shared-cart-provider';

export type { StorefrontCartProviderProps } from './storefront-shared-cart-provider';

type SharedCartProviderComponent = ComponentType<StorefrontCartProviderProps>;

let resolvedSharedCartProvider: SharedCartProviderComponent | null = null;
let sharedCartProviderLoader: Promise<SharedCartProviderComponent> | null =
  null;

function loadSharedCartProvider(): Promise<SharedCartProviderComponent> {
  if (!sharedCartProviderLoader) {
    sharedCartProviderLoader = import('./storefront-shared-cart-provider').then(
      (mod) => {
        resolvedSharedCartProvider = mod.StorefrontSharedCartProvider;
        return mod.StorefrontSharedCartProvider;
      }
    );
  }

  return sharedCartProviderLoader;
}

export function StorefrontCartProvider(props: StorefrontCartProviderProps) {
  const [SharedCartProvider, setSharedCartProvider] =
    useState<SharedCartProviderComponent | null>(() =>
      props.sharedCartEnabled ? resolvedSharedCartProvider : null
    );

  useEffect(() => {
    if (!props.sharedCartEnabled || SharedCartProvider) {
      return;
    }

    if (resolvedSharedCartProvider) {
      setSharedCartProvider(() => resolvedSharedCartProvider);
      return;
    }

    let active = true;
    void loadSharedCartProvider().then((Component) => {
      if (active) {
        setSharedCartProvider(() => Component);
      }
    });

    return () => {
      active = false;
    };
  }, [props.sharedCartEnabled, SharedCartProvider]);

  if (SharedCartProvider) {
    return <SharedCartProvider {...props} />;
  }

  return (
    <StorefrontLegacyCartProvider
      {...props}
      deferHydration={Boolean(props.sharedCartEnabled)}
    />
  );
}
