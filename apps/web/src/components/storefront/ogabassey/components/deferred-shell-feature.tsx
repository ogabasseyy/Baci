'use client';

import type React from 'react';
import {
  type DeferredActivationOptions,
  useDeferredActivation,
} from './use-deferred-activation';

export { useDeferredActivation } from './use-deferred-activation';

export interface DeferredShellFeatureProps extends DeferredActivationOptions {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function DeferredShellFeature({
  children,
  fallback = null,
  ...options
}: DeferredShellFeatureProps) {
  const isActivated = useDeferredActivation(options);

  if (!isActivated) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
