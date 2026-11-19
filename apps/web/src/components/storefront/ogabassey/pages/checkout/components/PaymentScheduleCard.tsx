import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function PaymentScheduleCard({ title, subtitle, icon: Icon, selected, onSelect, children }: {
  title: string; subtitle: string; icon: LucideIcon; selected: boolean;
  onSelect: () => void; children: ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border ${selected ? 'border-store-primary ring-1 ring-store-primary' : 'border-store-border'} bg-store-background`}>
      <button type="button" aria-label={title} aria-pressed={selected} aria-expanded={selected} onClick={onSelect} className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-store-primary">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-store-primary/10 text-store-primary"><Icon size={20} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-store-foreground">{title}</span><span className="mt-1 block text-xs text-store-background-text/70">{subtitle}</span></span>
        {selected ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      </button>
      {selected && <div className="border-t border-store-border p-4">{children}</div>}
    </section>
  );
}
