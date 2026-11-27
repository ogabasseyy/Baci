'use client';

import { useState } from 'react';

export const SNOW_STOPPED_KEY = 'ogabassey-snow-stopped';

// Survives remounts (e.g. a trip through checkout) when storage is blocked.
let stoppedYearThisVisit: string | undefined;

const currentYear = () => String(new Date().getFullYear());

// The stored value is the year, so the snow returns next December.
function readStopped(): boolean {
  if (stoppedYearThisVisit === currentYear()) return true;
  try {
    return window.localStorage.getItem(SNOW_STOPPED_KEY) === currentYear();
  } catch {
    // Storage is unavailable (private mode, blocked site data) or on server.
    return false;
  }
}

export function useSnowDismissal() {
  const [stopped, setStopped] = useState(readStopped);

  const stop = () => {
    setStopped(true);
    stoppedYearThisVisit = currentYear();
    try {
      window.localStorage.setItem(SNOW_STOPPED_KEY, stoppedYearThisVisit);
    } catch {
      // The snow still stops for this visit.
    }
  };

  return { stopped, stop };
}
