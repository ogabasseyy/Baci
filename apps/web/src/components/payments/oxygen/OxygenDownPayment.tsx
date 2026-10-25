'use client';
import { Pencil } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { equityForPercentage, percentageForAmount } from './down-payment';
import styles from './OxygenPlanForm.module.css';

const format = (value: number) =>
  new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value);
export function OxygenDownPayment({
  productAmount,
  percentage,
  onChange,
  extraPercentages = [],
  disabled = false,
  onCommit,
}: {
  productAmount: number;
  percentage: number | null;
  onChange: (percentage: number | null) => void;
  extraPercentages?: number[];
  disabled?: boolean;
  onCommit?: (percentage: number) => void;
}) {
  const id = useId();
  const amountInput = useRef<HTMLInputElement>(null);
  const last = useRef(percentage);
  const lastProductAmount = useRef(productAmount);
  const [text, setText] = useState(
    percentage === null
      ? ''
      : format(equityForPercentage(productAmount, percentage))
  );
  const [adjusted, setAdjusted] = useState(false);
  useEffect(() => {
    if (
      last.current !== percentage ||
      lastProductAmount.current !== productAmount
    ) {
      lastProductAmount.current = productAmount;
      last.current = percentage;
      setText(
        percentage === null
          ? ''
          : format(equityForPercentage(productAmount, percentage))
      );
      setAdjusted(false);
    }
  }, [percentage, productAmount]);
  function choose(value: number, commit = true) {
    last.current = value;
    setText(format(equityForPercentage(productAmount, value)));
    setAdjusted(false);
    onChange(value);
    if (commit) onCommit?.(value);
  }
  const choices = [
    ...new Set([
      ...Array.from({ length: 14 }, (_, i) => 25 + i * 5),
      ...extraPercentages,
    ]),
  ].sort((a, b) => a - b);
  return (
    <fieldset
      disabled={disabled}
      className={styles.card}
      aria-label="Down payment options"
    >
      <div className={styles.cardHeading}>
        <label htmlFor={id}>Your down payment</label>
        <output
          className={styles.percentage}
          aria-label="Down payment percentage"
        >
          {percentage === null ? '—' : `${percentage}%`}
        </output>
      </div>
      <div className={styles.amountInput}>
        <span aria-hidden="true">₦</span>
        <input
          id={id}
          ref={amountInput}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={24}
          value={text}
          aria-describedby={`${id}-hint`}
          aria-invalid={percentage === null}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            setAdjusted(false);
            const value = percentageForAmount(productAmount, next);
            last.current = value;
            onChange(value);
          }}
          onBlur={(event) => {
            if (percentage === null) return;
            const amount = equityForPercentage(productAmount, percentage);
            setAdjusted(
              Math.round(Number(text.replaceAll(',', '')) * 100) !==
                Math.round(amount * 100)
            );
            setText(format(amount));
            const next = event.relatedTarget;
            const choosingControl =
              next instanceof HTMLElement &&
              (next.tagName === 'BUTTON' ||
                (next instanceof HTMLInputElement &&
                  ['range', 'radio'].includes(next.type)));
            if (!choosingControl) onCommit?.(percentage);
          }}
        />
        <button
          type="button"
          className={styles.editAmount}
          aria-label="Edit down payment"
          onClick={() => amountInput.current?.focus()}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>Edit</span>
        </button>
      </div>
      <p id={`${id}-hint`} className={styles.hint}>
        {percentage === null
          ? `Enter ₦${format(equityForPercentage(productAmount, 25))}–₦${format(equityForPercentage(productAmount, 90))}.`
          : 'Type your amount · excludes upfront charges.'}
      </p>
      <input
        className={styles.slider}
        aria-label="Adjust down payment"
        type="range"
        min="25"
        max="90"
        step="0.01"
        value={percentage ?? 25}
        onChange={(event) => choose(Number(event.target.value), false)}
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
      <div className={styles.bounds}>
        <span>25% · ₦{format(equityForPercentage(productAmount, 25))}</span>
        <span>90% · ₦{format(equityForPercentage(productAmount, 90))}</span>
      </div>
      <div className={styles.quickChoices}>
        {choices.map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={percentage === value}
            onClick={() => choose(value)}
          >
            {value}%
          </button>
        ))}
      </div>
      {adjusted && (
        <p role="status" className={styles.hint}>
          Adjusted to {percentage}% to match Oxygen’s percentage precision.
        </p>
      )}
    </fieldset>
  );
}
