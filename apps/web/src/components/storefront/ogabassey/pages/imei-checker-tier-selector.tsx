'use client';

import { groupImeiServices, type ImeiServiceTierKey } from '@baci/shared/imei';
import { Check, ChevronRight, Star } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { getDisplayTier } from './imei-checker-tiers';

interface ImeiCheckerTierSelectorProps {
  canToggleServices: boolean;
  displayedTierKeys: readonly ImeiServiceTierKey[];
  selectedTier: ImeiServiceTierKey;
  showAllServices: boolean;
  onSelectTier: (tier: ImeiServiceTierKey) => void;
  onToggleServices: () => void;
}

/** One primary check per goal; a single full-width area compares alternatives. */
export function ImeiCheckerTierSelector({
  canToggleServices,
  displayedTierKeys,
  selectedTier,
  showAllServices,
  onSelectTier,
  onToggleServices,
}: ImeiCheckerTierSelectorProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const id = useId();
  const radioRefs = useRef<
    Partial<Record<ImeiServiceTierKey, HTMLButtonElement | null>>
  >({});
  const groups = groupImeiServices(displayedTierKeys, selectedTier).map(
    (group) =>
      expandedGoal === group.id
        ? {
            ...group,
            tierKeys: displayedTierKeys.filter((key) =>
              group.tierKeys.includes(key)
            ),
          }
        : group
  );
  const visibleKeys = groups.flatMap((group) =>
    expandedGoal === group.id ? group.tierKeys : group.tierKeys.slice(0, 1)
  );
  const currentTier = getDisplayTier(selectedTier);
  const detailsId = `${id}-details`;

  function renderCard(tierKey: ImeiServiceTierKey) {
    const tier = getDisplayTier(tierKey);
    const isSelected = tierKey === selectedTier;
    const Icon = tier.icon;
    return (
      // biome-ignore lint/a11y/useSemanticElements: Card radio follows the APG pattern with roving focus and arrow-key selection.
      <button
        aria-checked={isSelected}
        aria-label={`${tier.name}, ${tier.tagline}, ${tier.priceDisplay}`}
        className={`relative flex h-full min-h-40 w-full flex-col rounded-2xl border-2 p-4 text-left text-store-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current ${isSelected ? 'border-[var(--store-primary)] bg-[var(--store-primary)]/5' : 'border-gray-100 bg-white hover:border-gray-400'}`}
        key={tierKey}
        onClick={() => onSelectTier(tierKey)}
        onKeyDown={(event) => {
          const index = visibleKeys.indexOf(tierKey);
          let next: number;
          switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
              next = (index + 1) % visibleKeys.length;
              break;
            case 'ArrowLeft':
            case 'ArrowUp':
              next = (index - 1 + visibleKeys.length) % visibleKeys.length;
              break;
            case 'Home':
              next = 0;
              break;
            case 'End':
              next = visibleKeys.length - 1;
              break;
            default:
              return;
          }
          event.preventDefault();
          radioRefs.current[visibleKeys[next]]?.focus();
          onSelectTier(visibleKeys[next]);
        }}
        ref={(element) => {
          radioRefs.current[tierKey] = element;
        }}
        role="radio"
        tabIndex={
          isSelected ||
          (!visibleKeys.includes(selectedTier) && tierKey === visibleKeys[0])
            ? 0
            : -1
        }
        type="button"
      >
        {tier.recommended && (
          <span className="absolute -right-1 -top-2 flex items-center gap-1 rounded-full bg-[var(--store-primary)] px-2 py-0.5 text-[10px] font-bold text-[var(--store-primary-text,#ffffff)]">
            <Star aria-hidden="true" fill="currentColor" size={10} />
            Recommended
          </span>
        )}
        <div className="flex w-full items-center justify-between gap-2">
          <Icon aria-hidden="true" size={24} />
          {isSelected && <Check aria-hidden="true" size={20} />}
        </div>
        <p className="mt-2 text-sm font-bold">{tier.name}</p>
        <p className="mt-1 text-xs text-gray-600">{tier.tagline}</p>
        <p className="mt-auto pt-3 text-sm font-bold">{tier.priceDisplay}</p>
      </button>
    );
  }

  return (
    <div>
      <div
        aria-label="Service tier"
        className="grid grid-cols-2 items-stretch gap-4 xl:grid-cols-4"
        role="radiogroup"
      >
        {groups.map((group) => {
          const expanded = expandedGoal === group.id;
          const comparisonId = `${id}-${group.id}`;
          return (
            <div
              className={`flex min-w-0 flex-col ${expanded ? 'col-span-full rounded-2xl border border-gray-200 p-3' : ''}`}
              key={group.id}
            >
              <h3 className="mb-2 flex min-h-10 items-center text-sm font-bold text-store-foreground">
                {group.label}
              </h3>
              <section
                aria-label={expanded ? `Compare ${group.label}` : undefined}
                className={`grid flex-1 gap-3 ${expanded ? 'grid-cols-2 xl:grid-cols-4' : ''}`}
                id={comparisonId}
              >
                {(expanded ? group.tierKeys : group.tierKeys.slice(0, 1)).map(
                  renderCard
                )}
              </section>
              {group.tierKeys.length > 1 ? (
                <button
                  type="button"
                  aria-controls={comparisonId}
                  aria-expanded={expanded}
                  className="mt-1 inline-flex min-h-11 items-center gap-1 self-start text-left text-sm text-store-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                  onClick={() => setExpandedGoal(expanded ? null : group.id)}
                >
                  {expanded ? 'Close comparison' : 'Compare options'}{' '}
                  <span className="sr-only">for {group.label}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className={expanded ? 'rotate-90' : ''}
                    size={14}
                  />
                </button>
              ) : (
                <div aria-hidden="true" className="mt-1 min-h-11" />
              )}
            </div>
          );
        })}
      </div>
      {canToggleServices && (
        <div className="mt-3 text-center">
          <button
            aria-expanded={showAllServices}
            className="min-h-11 text-sm text-store-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            onClick={onToggleServices}
            type="button"
          >
            {showAllServices ? 'Show key checks' : 'More checks'}
          </button>
        </div>
      )}
      <div className="mt-2 text-center">
        <button
          aria-controls={detailsId}
          aria-expanded={showDetails}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-store-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          onClick={() => setShowDetails((value) => !value)}
          type="button"
        >
          What's included in {currentTier.name}?
          <ChevronRight
            aria-hidden="true"
            className={showDetails ? 'rotate-90' : ''}
            size={14}
          />
        </button>
        {showDetails && (
          <div
            className="mt-3 space-y-3 rounded-xl border border-gray-200 p-4 text-left text-sm text-store-foreground"
            id={detailsId}
          >
            <p>{currentTier.detail}</p>
            <ul className="flex flex-wrap gap-2">
              {currentTier.features.map((feature) => (
                <li
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                  key={feature}
                >
                  <Check aria-hidden="true" size={12} />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
