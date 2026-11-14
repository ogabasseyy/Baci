'use client';

import { use, useSyncExternalStore } from 'react';
import {
  V2ThemeContext,
  type V2ThemeMode,
  getNoTheme,
  subscribeToMissingTheme,
} from './v2-theme-context-def';

export const useV2ThemeSafe = (): { theme: V2ThemeMode } => {
  const store = use(V2ThemeContext);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeToMissingTheme,
    store?.getSnapshot ?? getNoTheme,
    store?.getServerSnapshot ?? getNoTheme
  );
  return snapshot ?? { theme: 'standard' };
};
