'use client';
import { useId } from 'react';
import styles from './OxygenPlanForm.module.css';
export function OxygenTenurePicker({
  months,
  value,
  onChange,
  disabled = false,
}: {
  months: number[];
  value: number;
  onChange: (months: number) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className={styles.tenurePicker}>
      <legend className={styles.tenureLegend}>
        <span>Repayment period</span>
        {months.length > 6 && (
          <span className={styles.hint}>Swipe for more →</span>
        )}
      </legend>
      <div className={styles.tenureTabs}>
        {months.map((month) => (
          <label key={month} className={styles.tenureTab}>
            <input
              type="radio"
              name={name}
              value={month}
              checked={value === month}
              onChange={() => onChange(month)}
            />
            <span>
              {month} {month === 1 ? 'month' : 'months'}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
