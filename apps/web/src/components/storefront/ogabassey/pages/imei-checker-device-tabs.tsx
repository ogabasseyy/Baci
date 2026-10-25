'use client';

import {
  IMEI_DEVICE_CATEGORIES,
  type ImeiDeviceCategory,
} from '@baci/shared/imei';
import { useRef } from 'react';
import { IMEI_DEVICE_ICONS } from './imei-checker-device-icons';

interface ImeiCheckerDeviceTabsProps {
  panelId?: string;
  selected: ImeiDeviceCategory;
  onSelect: (device: ImeiDeviceCategory) => void;
}

/** Left/Right/Home/End move focus and activate, per the ARIA APG tab pattern. */
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

/** Device-category tab strip (Phone/iPad/Mac/Watch) — mirrors the mobile checker's ImeiDeviceTabs. */
export function ImeiCheckerDeviceTabs({
  selected,
  panelId = 'imei-device-panel',
  onSelect,
}: ImeiCheckerDeviceTabsProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <div
      aria-label="Device type"
      className="grid grid-cols-4 gap-2"
      role="tablist"
    >
      {IMEI_DEVICE_CATEGORIES.map((category, index) => {
        const isSelected = category.id === selected;
        const Icon = IMEI_DEVICE_ICONS[category.id];

        return (
          <button
            aria-label={`${category.label} checks`}
            aria-selected={isSelected}
            aria-controls={panelId}
            id={`${panelId}-${category.id}-tab`}
            className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 text-store-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current ${
              isSelected
                ? 'border-[var(--store-primary)] bg-[var(--store-primary)]/5'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
            key={category.id}
            onClick={() => onSelect(category.id)}
            onKeyDown={(event) => {
              const nextIndex = nextIndexForKey(
                event.key,
                index,
                IMEI_DEVICE_CATEGORIES.length
              );
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              buttonRefs.current[nextIndex]?.focus();
              onSelect(IMEI_DEVICE_CATEGORIES[nextIndex].id);
            }}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            role="tab"
            tabIndex={isSelected ? 0 : -1}
            type="button"
          >
            <Icon size={20} />
            <span className="text-xs font-semibold">{category.label}</span>
          </button>
        );
      })}
    </div>
  );
}
