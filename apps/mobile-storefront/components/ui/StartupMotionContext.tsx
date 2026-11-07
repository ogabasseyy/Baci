import { createContext, type ReactNode, useContext } from 'react';

const StartupMotionContext = createContext(true);

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

export function useStartupMotionEnabled() {
  return useContext(StartupMotionContext);
}
