'use client';

import { useSyncExternalStore } from 'react';
import { BLACK_FRIDAY_LAUNCH } from './black-friday-launch';
import styles from './ogabassey-black-friday-page.module.css';

const launchTime = Date.parse(BLACK_FRIDAY_LAUNCH);
const units = [
  { label: 'Days', seconds: 86_400, modulus: Number.POSITIVE_INFINITY },
  { label: 'Hours', seconds: 3_600, modulus: 24 },
  { label: 'Minutes', seconds: 60, modulus: 60 },
  { label: 'Seconds', seconds: 1, modulus: 60 },
];

function getRemainingSeconds() {
  return Math.max(0, Math.ceil((launchTime - Date.now()) / 1000));
}

function subscribe(onChange: () => void) {
  if (getRemainingSeconds() === 0) return () => undefined;
  const interval = window.setInterval(() => {
    onChange();
    if (getRemainingSeconds() === 0) window.clearInterval(interval);
  }, 1000);
  return () => window.clearInterval(interval);
}

const getServerSnapshot = () => null;

export function BlackFridayCountdown() {
  const remaining = useSyncExternalStore(
    subscribe,
    getRemainingSeconds,
    getServerSnapshot
  );

  return (
    <div
      className={styles.countdown}
      role="timer"
      aria-label="Countdown to Black Friday in Lagos"
    >
      {remaining === 0 ? (
        <p>Black Friday has started.</p>
      ) : (
        units.map(({ label, seconds, modulus }) => {
          const value =
            remaining === null
              ? '–'
              : String(Math.floor(remaining / seconds) % modulus).padStart(
                  2,
                  '0'
                );
          return (
            <div className={styles.countdownUnit} key={label}>
              <span className={styles.countdownValue}>{value}</span>
              <span>{label}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
