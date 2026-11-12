import type { ReactNode } from 'react';
import { StartupMotionContext } from './StartupMotionContext';

export function StartupMotionProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return (
    <StartupMotionContext.Provider value={enabled}>
      {children}
    </StartupMotionContext.Provider>
  );
}
