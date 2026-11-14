'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { OxygenBankLogo } from './OxygenBankLogo';
import { oxygenFieldClass } from './oxygen-checkout-styles';

type Bank = { name: string; code: string };

/** Local search; the portal stays inside the native application dialog. */
export function OxygenBankSelect({
  id,
  banks,
  value,
  disabled,
  loading,
  onChange,
}: {
  id: string;
  banks: Bank[];
  value: string;
  disabled: boolean;
  loading: boolean;
  onChange: (code: string) => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const previousValue = useRef(value);
  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    // Match the previous select's bubbling change event for encrypted autosave.
    selectRef.current?.dispatchEvent(new Event('change', { bubbles: true }));
  }, [value]);
  const selected = banks.find((bank) => bank.code === value);
  const sorted = [...banks].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
  const matches = sorted.filter((bank) =>
    bank.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const activeIndex = Math.min(highlighted, matches.length - 1);
  function changeOpen(next: boolean) {
    setOpen(next);
    setQuery('');
    setHighlighted(0);
  }
  function choose(code: string) {
    onChange(code);
    changeOpen(false);
  }
  return (
    <div ref={setContainer}>
      {/* Keep native form validation and exact Oxygen codes independent of search. */}
      <select
        ref={selectRef}
        name="bank_code"
        value={value}
        required
        disabled={disabled || loading}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none sr-only"
        onChange={(event) => {
          if (event.target.value !== value) onChange(event.target.value);
        }}
      >
        <option value="">Select a bank</option>
        {sorted.map((bank) => (
          <option key={bank.code} value={bank.code}>
            {bank.name}
          </option>
        ))}
      </select>
      <Popover.Root
        modal
        open={open && !disabled && !loading}
        onOpenChange={changeOpen}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            id={id}
            disabled={disabled || loading}
            className={`${oxygenFieldClass} flex items-center gap-3 text-left`}
            onKeyDown={(event) => {
              if (['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                changeOpen(true);
              }
            }}
          >
            <OxygenBankLogo key={value} code={selected?.code ?? ''} />
            <span className="min-w-0 flex-1 truncate">
              {selected?.name ?? (loading ? 'Loading banks…' : 'Select a bank')}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-gray-500"
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content
            sideOffset={6}
            collisionPadding={12}
            className="z-50 flex max-h-[min(360px,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-xl"
          >
            <div className="m-1.5 mb-0 flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 focus-within:border-store-primary focus-within:ring-2 focus-within:ring-inset focus-within:ring-store-primary/15">
              <Search
                aria-hidden="true"
                className="size-4 shrink-0 text-store-primary"
              />
              <input
                type="search"
                role="combobox"
                aria-label="Search banks"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
                }
                autoComplete="off"
                placeholder="Search banks…"
                value={query}
                className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:outline-none"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlighted(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const next =
                      event.key === 'ArrowDown'
                        ? Math.min(activeIndex + 1, matches.length - 1)
                        : Math.max(activeIndex - 1, 0);
                    setHighlighted(next);
                    document
                      .getElementById(`${listId}-${next}`)
                      ?.scrollIntoView({ block: 'nearest' });
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    if (matches[activeIndex]) choose(matches[activeIndex].code);
                  }
                }}
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label="Banks"
              className="min-h-0 overflow-y-auto overscroll-contain p-1.5"
            >
              {matches.map((bank, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={bank.code === value}
                  id={`${listId}-${index}`}
                  key={bank.code}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(bank.code)}
                  onPointerMove={() => setHighlighted(index)}
                  className={`relative flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg py-2 pl-3 pr-9 text-left text-sm outline-hidden ${activeIndex === index ? 'bg-gray-50' : ''}`}
                >
                  <OxygenBankLogo code={bank.code} />
                  <span>{bank.name}</span>
                  {bank.code === value && (
                    <Check
                      aria-hidden="true"
                      className="absolute right-3 size-4 text-store-primary"
                    />
                  )}
                </button>
              ))}
            </div>
            {matches.length === 0 && (
              <p
                role="status"
                className="px-3 py-6 text-center text-sm text-gray-500"
              >
                No banks found. Try another name.
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
