'use client';

import type React from 'react';
import { V2SavedProvider } from './providers/v2-saved-context';
import {
  type V2ThemeMode,
  V2ThemeProvider,
} from './providers/v2-theme-context';

interface OgabasseyLayoutProvidersProps {
  children: React.ReactNode;
  enabled?: boolean;
  initialTheme?: V2ThemeMode;
}

export function OgabasseyLayoutProviders({
  children,
  enabled = true,
  initialTheme,
}: OgabasseyLayoutProvidersProps) {
  return (
    <V2ThemeProvider enabled={enabled} initialTheme={initialTheme}>
      <V2SavedProvider enabled={enabled}>{children}</V2SavedProvider>
    </V2ThemeProvider>
  );
}
