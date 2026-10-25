'use client';

import { IMEI_BRAND_FILTERS, type ImeiBrandFilter } from '@baci/shared/imei';
import { useRef } from 'react';

interface ImeiCheckerBrandChipsProps {
  selectedBrand: ImeiBrandFilter;
  onSelectBrand: (brand: ImeiBrandFilter) => void;
}

/** Left/Right/Home/End move focus and select, per the ARIA APG radio-group pattern. */
function nextIndexForKey(
  key: string,
  currentIndex: number,
  count: number
): number | null {
  switch (key) {
    case 'ArrowRight':
      return (currentIndex + 1) % count;
    case 'ArrowLeft':
      return (currentIndex - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Brand filter row, shown only on the smartphone device tab. There is
 * deliberately no "All" chip — every phone is a specific brand — mirroring
 * the mobile checker's ImeiBrandChips.
 */
export function ImeiCheckerBrandChips({
  selectedBrand,
  onSelectBrand,
}: ImeiCheckerBrandChipsProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <div
      aria-label="Brand"
      className="flex gap-2 overflow-x-auto pb-1"
      role="radiogroup"
    >
      {IMEI_BRAND_FILTERS.map((brand, index) => {
        const isSelected = brand.id === selectedBrand;

        return (
          // biome-ignore lint/a11y/useSemanticElements: Custom chip radio implements the APG roving focus and keyboard pattern.
          <button
            aria-checked={isSelected}
            className={`shrink-0 rounded-full border px-4 min-h-11 py-1.5 text-sm font-medium text-store-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
              isSelected
                ? 'border-[var(--store-primary)] bg-[var(--store-primary)]/10'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            key={brand.id}
            onClick={() => onSelectBrand(brand.id)}
            onKeyDown={(event) => {
              const nextIndex = nextIndexForKey(
                event.key,
                index,
                IMEI_BRAND_FILTERS.length
              );
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              buttonRefs.current[nextIndex]?.focus();
              onSelectBrand(IMEI_BRAND_FILTERS[nextIndex].id);
            }}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            role="radio"
            tabIndex={isSelected ? 0 : -1}
            type="button"
          >
            {brand.label}
          </button>
        );
      })}
    </div>
  );
}
