'use client';
import type { ReactNode } from 'react';

export function RefinementGroup({
  group,
  title,
  open,
  onToggle,
  children,
}: {
  group: string;
  title: string;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <fieldset data-filter-group={group} className="min-w-0">
      <legend className="mb-2 w-full font-semibold">
        {onToggle ? (
          <button
            type="button"
            aria-expanded={open}
            className="flex min-h-12 w-full items-center justify-between rounded-lg bg-store-background-text/5 px-3 text-left"
            onClick={onToggle}
          >
            {title}
            <span aria-hidden="true">{open ? '−' : '+'}</span>
          </button>
        ) : (
          title
        )}
      </legend>
      {open && children}
    </fieldset>
  );
}
