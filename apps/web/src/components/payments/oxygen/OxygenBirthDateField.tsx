'use client';

import { format, isValid, parse } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import styles from './OxygenBirthDateField.module.css';
import { oxygenFieldClass } from './oxygen-checkout-styles';

function readDate(value: string): Date | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return null;
  const date = parse(value, 'dd/MM/yyyy', new Date());
  return isValid(date) && date <= new Date() ? date : null;
}

export function OxygenBirthDateField({
  defaultValue = '',
  defaultEntry,
  onValueChange,
}: {
  defaultValue?: string;
  defaultEntry?: string;
  onValueChange?: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(
    () =>
      defaultEntry ??
      (/^\d{4}-\d{2}-\d{2}$/.test(defaultValue)
        ? defaultValue.split('-').reverse().join('/')
        : '')
  );
  const previousValue = useRef(value);
  const [open, setOpen] = useState(false);
  const date = readDate(value);
  const today = new Date();
  const years = Array.from(
    { length: today.getFullYear() - 1899 },
    (_, index) => today.getFullYear() - index
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: notify only when the controlled date changes.
  useEffect(() => {
    input.current?.setCustomValidity(
      value && !readDate(value)
        ? 'Enter a valid date of birth in DD/MM/YYYY format, not in the future.'
        : ''
    );
    if (previousValue.current !== value) {
      previousValue.current = value;
      onValueChange?.();
    }
  }, [value]);

  return (
    <fieldset
      aria-label="Birth date selection"
      className="grid min-w-0 gap-1.5 sm:col-span-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          input.current?.focus();
        }
      }}
    >
      <label htmlFor={id} className="text-xs font-bold text-gray-700">
        Date of birth
      </label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          name="birth_date_entry"
          value={value}
          required
          maxLength={10}
          placeholder="DD/MM/YYYY"
          autoComplete="bday"
          pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
          className={`${oxygenFieldClass} pr-12`}
          aria-describedby={`${id}-format`}
          onChange={(event) => setValue(event.target.value)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() =>
                panel.current
                  ?.querySelector<HTMLElement>('[tabindex="0"]')
                  ?.focus()
              );
            }
          }}
        />
        <button
          type="button"
          aria-label="Choose date of birth"
          aria-expanded={open}
          aria-controls={`${id}-calendar`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-gray-500"
          onClick={() => setOpen(!open)}
        >
          <CalendarDays aria-hidden="true" className="size-4" />
        </button>
      </div>
      <span id={`${id}-format`} className="sr-only">
        Enter day, month and year as DD/MM/YYYY, or select a date. Press Arrow
        Down to move into the calendar.
      </span>
      <input
        type="hidden"
        name="date_of_birth"
        value={date ? format(date, 'yyyy-MM-dd') : ''}
      />
      {open && (
        <div ref={panel} id={`${id}-calendar`} className={styles.panel}>
          <DatePicker
            inline
            selected={date}
            onChange={(selected: Date | null) => {
              if (!selected) return;
              setValue(format(selected, 'dd/MM/yyyy'));
              setOpen(false);
              input.current?.focus();
            }}
            maxDate={today}
            openToDate={date ?? new Date(today.getFullYear() - 30, 0, 1)}
            calendarClassName={styles.calendar}
            renderCustomHeader={({
              date: viewed,
              changeYear,
              changeMonth,
              decreaseMonth,
              increaseMonth,
              nextMonthButtonDisabled,
            }) => (
              <div className={styles.header}>
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={decreaseMonth}
                >
                  <ChevronLeft aria-hidden="true" size={18} />
                </button>
                <select
                  aria-label="Birth month"
                  value={viewed.getMonth()}
                  onChange={(event) => changeMonth(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, month) => (
                    <option
                      key={format(new Date(2000, month, 1), 'MMMM')}
                      value={month}
                    >
                      {format(new Date(2000, month, 1), 'MMMM')}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Birth year"
                  value={viewed.getFullYear()}
                  onChange={(event) => changeYear(Number(event.target.value))}
                >
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Next month"
                  disabled={nextMonthButtonDisabled}
                  onClick={increaseMonth}
                >
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </div>
            )}
          />
        </div>
      )}
    </fieldset>
  );
}
