'use client';

import { createContext } from 'react';
import type { CommittedSnapshotStore } from '@/lib/committed-snapshot-store';

export type V2ThemeMode = 'standard' | 'santa';

export interface V2ThemeContextType {
  theme: V2ThemeMode;
  setTheme: (theme: V2ThemeMode) => void;
  toggleTheme: () => void;
}

export const V2ThemeContext = createContext<
  CommittedSnapshotStore<V2ThemeContextType> | undefined
>(undefined);

export const getNoTheme = () => null;
export const subscribeToMissingTheme = () => () => undefined;
