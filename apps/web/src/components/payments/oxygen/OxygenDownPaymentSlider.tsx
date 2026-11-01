'use client';

import type { CSSProperties } from 'react';
import styles from './OxygenDownPaymentSlider.module.css';

export function OxygenDownPaymentSlider({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}) {
  return (
    <div
      className={styles.control}
      style={{ '--slider-progress': `${value}%` } as CSSProperties}
    >
      <div className={styles.rail} aria-hidden="true" />
      <div className={styles.marks} aria-hidden="true">
        {[0, 25, 50, 75, 100].map((mark) => (
          <span key={mark} style={{ left: `${mark}%` }} />
        ))}
      </div>
      <input
        className={styles.slider}
        aria-label="Adjust down payment"
        aria-valuetext={`${value}% down payment`}
        type="range"
        min="25"
        max="90"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
              'Home',
              'End',
            ].includes(event.key)
          )
            onCommit?.(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
