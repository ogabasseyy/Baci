'use client';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shared accordion shell for the existing checkout and provider payment steps. */
export function CheckoutStepCard({ number, title, active = false, complete = false, disabled = false, onSelect, summary, children }: {
  number: number; title: string; active?: boolean; complete?: boolean;
  disabled?: boolean; onSelect?: () => void; summary?: ReactNode; children?: ReactNode;
}) {
  const heading = <>
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${complete ? 'bg-green-100 text-green-600' : active ? 'bg-store-primary/10 text-store-primary' : 'bg-gray-100 text-gray-500'}`}>
          {complete ? <Check size={14} /> : number}
        </span>{title}
      </h2>
      {summary && <p className="mt-1 pl-8 text-xs font-normal text-gray-500">{summary}</p>}
    </div>
    {complete && !active && onSelect && <span className="shrink-0 text-sm font-semibold text-store-primary underline-offset-4 hover:underline">Edit</span>}
  </>;
  return <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 ${active ? 'border-store-primary ring-1 ring-store-primary/20' : 'border-gray-100'}`}>
    {onSelect ? <button type="button" disabled={disabled} onClick={onSelect} className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-inset">{heading}</button> : <div className="flex items-center justify-between gap-3 px-6 py-4">{heading}</div>}
    {children}
  </section>;
}
