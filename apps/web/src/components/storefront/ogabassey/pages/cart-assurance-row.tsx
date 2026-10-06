'use client';

import { ShieldCheck } from 'lucide-react';

interface CartAssuranceRowProps {
  hasAssurance?: boolean;
  assuranceCost: number;
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
  cartItemId,
  onToggle,
}: CartAssuranceRowProps) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none group active:opacity-70 max-w-[70%]">
      <div className="relative flex items-center mt-0.5">
        <input
          type="checkbox"
          checked={hasAssurance || false}
          onChange={() => onToggle?.(cartItemId)}
          className="peer sr-only"
        />
        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600" />
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-red-600" />
          Ogabassey Assurance
        </span>
        <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
          {hasAssurance ? (
            <>
              Covers{' '}
              <span className="font-bold text-gray-700">
                Screen & Liquid Damage
              </span>
              <span className="ml-1 text-red-600 font-bold">
                +₦{assuranceCost.toLocaleString()}
              </span>
            </>
          ) : (
            'Device Protection (+5%)'
          )}
        </p>
        <p className="text-[10px] text-store-background-text/55 leading-tight mt-0.5">
          {hasAssurance
            ? 'Optional. Included in total; uncheck to remove.'
            : 'Optional. Check to add.'}
        </p>
      </div>
    </label>
  );
}
