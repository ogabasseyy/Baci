import { useContext } from 'react';
import { StartupMotionContext } from './StartupMotionContext';

export function useStartupMotionEnabled() {
  return useContext(StartupMotionContext);
}
