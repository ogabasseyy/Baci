import type { ReactNode } from 'react';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';

// Cart states and the checkout footer handle their own vertical insets.
export function renderCartShell(children: ReactNode) {
  return (
    <StorefrontScreenShell
      edges={['left', 'right']}
      themeBackground
      testID="storefront-cart-safe-area"
    >
      {children}
    </StorefrontScreenShell>
  );
}
