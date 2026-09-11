import type React from 'react';
import type { StorefrontAppearance } from '@/components/storefront/storefront-appearance';
import { StorefrontThemeProvider } from '@/components/storefront/storefront-theme-provider';

export function StorefrontThemeFrame({
  appearance,
  children,
  scopeDocument = true,
}: {
  appearance: StorefrontAppearance;
  children: React.ReactNode;
  scopeDocument?: boolean;
}) {
  return (
    <StorefrontThemeProvider
      appearance={appearance}
      scopeDocument={scopeDocument}
    >
      {children}
    </StorefrontThemeProvider>
  );
}
