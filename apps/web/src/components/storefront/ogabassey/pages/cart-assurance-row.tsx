'use client';

import { ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';

interface CartAssuranceRowProps {
  hasAssurance?: boolean;
  assuranceCost: number;
  assuranceRateLabel?: string;
  cartItemId: string;
  onToggle?: (cartItemId: string) => void;
}

/**
 * Per-line Assurance opt-in row: toggle, coverage/cost copy, and the
 * optional-fee disclosure. Extracted from the cart page so the disclosure
 * lives in a focused, theme-aware module.
 */
export function CartAssuranceRow({
  hasAssurance,
  assuranceCost,
  assuranceRateLabel = '5%',
  cartItemId,
  onToggle,
}: CartAssuranceRowProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const [removedByShopper, setRemovedByShopper] = useState(false);
  const handleToggle = () => {
    if (!onToggle) return;
    setRemovedByShopper(Boolean(hasAssurance));
    onToggle(cartItemId);
  };

  return (
    <div className="w-full">
      <label className="flex items-center gap-2.5 cursor-pointer select-none group active:opacity-70">
        <span className="relative flex items-center shrink-0">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={hasAssurance || false}
            onChange={handleToggle}
            className="peer sr-only"
          />
          <span className="block w-7 h-4 bg-store-background-text/20 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-store-primary rounded-full peer peer-checked:after:translate-x-3 peer-checked:after:border-store-primary-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-store-background after:border-store-border after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-store-primary" />
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[11px] font-bold text-store-background-text flex items-center gap-1 whitespace-nowrap">
            <ShieldCheck size={12} className="text-store-primary shrink-0" />
            Ogabassey Assurance
          </span>
          <span className="block text-[10px] text-store-background-text/65 leading-tight mt-0.5 whitespace-nowrap">
            {hasAssurance ? (
              <>
                <span className="font-medium text-store-background-text">
                  Screen & Liquid Damage
                </span>
                <span className="ml-1 text-store-primary font-semibold">
                  +₦{assuranceCost.toLocaleString('en-NG')}
                </span>
              </>
            ) : (
              `Device Protection (+${assuranceRateLabel})`
            )}
          </span>
        </span>
      </label>
      <div role="status" className="text-xs text-store-background-text/70">
        {removedByShopper && !hasAssurance && (
          <p className="mt-2">
            This item won’t include screen and liquid damage protection.
          </p>
        )}
      </div>
      {removedByShopper && !hasAssurance && (
        <div className="space-y-1 text-xs text-store-background-text/70">
          <p>A little extra care? You can always add a screen protector 🙂</p>
          <button
            type="button"
            onClick={() => {
              handleToggle();
              checkboxRef.current?.focus();
            }}
            className="text-store-primary underline underline-offset-2 py-2"
          >
            Add Assurance back
          </button>
        </div>
      )}
    </div>
  );
}
