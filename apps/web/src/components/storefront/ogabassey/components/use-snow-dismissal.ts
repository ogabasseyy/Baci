'use client';

import { useState } from 'react';

export const SNOW_STOPPED_KEY = 'ogabassey-snow-stopped';

// The stored value is the year, so the snow returns next December.
function readStopped(): boolean {
  try {
    return (
      window.localStorage.getItem(SNOW_STOPPED_KEY) ===
      String(new Date().getFullYear())
    );
  } catch {
    // Storage is unavailable (private mode, blocked site data) or on server.
    return false;
  }
}

export function useSnowDismissal() {
  const [stopped, setStopped] = useState(readStopped);

  const stop = () => {
    setStopped(true);
    try {
      window.localStorage.setItem(
        SNOW_STOPPED_KEY,
        String(new Date().getFullYear())
      );
    } catch {
      // The snow still stops for this visit.
    }
  };

  return { stopped, stop };
}
