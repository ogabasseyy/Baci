import type { CSSProperties } from 'react';
import { Info, MapPin } from 'lucide-react';
import type { NormalizedProductDetails } from './product-details-helpers';
import { ProductOptionAxisGroup } from './product-option-axis-group';

interface ProductOptionSelectorsProps {
  deliveryEstimate: string;
  deliveryLocation: 'Lagos' | 'Outside Lagos';
  descriptionExcerpt: string;
  effectiveAxes: string[];
  formatAxisLabel: (axis: string) => string;
  getAxisOptions: (axis: string) => string[];
  onChangeDeliveryLocation: (
    updater: (current: 'Lagos' | 'Outside Lagos') => 'Lagos' | 'Outside Lagos'
  ) => void;
  onSelectAttribute: (axis: string, value: string) => void;
  onSelectColor: (index: number) => void;
  onSelectSecondaryColor: (index: number) => void;
  productData: NormalizedProductDetails;
  secondaryColor: number | null;
  selectedAttributes: Record<string, string>;
  selectedColor: number | null;
  showColorToast: boolean;
}

const secondaryAccent =
  'color-mix(in_srgb,var(--store-primary) 72%,var(--store-background-text,#111827) 28%)';
type SecondaryAccentStyle = CSSProperties & {
  '--store-option-secondary': string;
};

export function ProductOptionSelectors({
  deliveryEstimate,
  deliveryLocation,
  descriptionExcerpt,
  effectiveAxes,
  formatAxisLabel,
  getAxisOptions,
  onChangeDeliveryLocation,
  onSelectAttribute,
  onSelectColor,
  onSelectSecondaryColor,
  productData,
  secondaryColor,
  selectedAttributes,
  selectedColor,
  showColorToast,
}: ProductOptionSelectorsProps) {
  return (
    <>
      <div className="mb-6 flex items-start justify-between rounded-xl border border-gray-100 bg-gray-50 p-3">
        <div className="flex gap-3">
          <div className="mt-1 text-gray-400">
            <MapPin size={20} />
          </div>
          <div>
            <p className="mb-0.5 text-xs text-gray-500">
              Deliver to:{' '}
              <span className="font-bold text-gray-900">{deliveryLocation}</span>
            </p>
            <p className="text-sm font-bold text-green-600">
              Est. Delivery: {deliveryEstimate}
            </p>
            {effectiveAxes
              .filter((axis) => axis !== 'color')
              .some(
                (axis) =>
                  !selectedAttributes[axis] &&
                  getAxisOptions(axis).length > 0
              ) && (
              <p className="mt-1 text-[10px] text-gray-400">
                Select options to confirm availability
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChangeDeliveryLocation((current) =>
              current === 'Lagos' ? 'Outside Lagos' : 'Lagos'
            )
          }
          className="mt-1 text-xs font-bold text-store-primary transition-transform active:scale-95 hover:underline"
          aria-label="Change delivery location"
        >
          Change
        </button>
      </div>

      {productData.colors.length > 0 && (
        <div className="relative mb-8">
          {showColorToast &&
            selectedColor !== null &&
            secondaryColor === null && (
              <output aria-live="polite" aria-atomic="true" className="block pointer-events-none absolute -top-12 left-0 right-0 z-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex max-w-fit items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
                  <Info
                    size={14}
                    className="shrink-0 text-store-primary"
                  />
                  <span>
                    Optional: Select a backup color in case your first choice is
                    out of stock.
                  </span>
                </div>
                <div className="-mt-1 ml-6 size-2 rotate-45 bg-gray-900" />
              </output>
            )}

          <label className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-bold text-gray-900">
            <span className="flex items-center gap-2">
              Color:
              <span className="text-store-primary">
                {selectedColor !== null
                  ? productData.colors[selectedColor]?.name
                  : 'Select a color'}
              </span>
              {secondaryColor !== null && (
                <span className="text-xs font-normal text-gray-400">
                  (+ {productData.colors[secondaryColor]?.name})
                </span>
              )}
            </span>
            {selectedColor === null && (
              <span className="animate-pulse text-xs font-normal text-store-primary">
                * Required
              </span>
            )}
          </label>

          <div className="flex flex-wrap gap-4">
            {productData.colors.map((color, index) => {
              const isPrimary = selectedColor === index;
              const isSecondary = secondaryColor === index;

              return (
                <div key={color.name} className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectColor(index)}
                    className={`group relative flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 outline-hidden active:scale-95 ${
                      isPrimary
                        ? 'scale-110 border-[3px] border-store-primary shadow-lg'
                        : isSecondary
                          ? 'scale-105 border-[3px] border-store-option-secondary shadow-md'
                          : 'border border-gray-200 shadow-sm md:hover:scale-105 md:hover:border-gray-400'
                    }`}
                    style={
                      isSecondary
                        ? ({
                            '--store-option-secondary': secondaryAccent,
                          } as SecondaryAccentStyle)
                        : undefined
                    }
                    aria-label={`Select color ${color.name}`}
                    aria-pressed={isPrimary}
                    title={color.name}
                  >
                    <div
                      className="size-11 rounded-full border border-black/5 shadow-inner"
                      style={{ backgroundColor: color.value }}
                    />
                    {isPrimary && (
                      <div className="absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full border-2 border-white bg-store-primary text-[10px] font-bold text-store-primary-text shadow-sm">
                        1
                      </div>
                    )}
                    {isSecondary && (
                      <div
                        className="absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full border-2 border-white bg-store-option-secondary text-[10px] font-bold text-store-primary-text shadow-sm"
                        style={
                          {
                            '--store-option-secondary': secondaryAccent,
                          } as SecondaryAccentStyle
                        }
                      >
                        2
                      </div>
                    )}
                  </button>
                  {selectedColor !== null && selectedColor !== index && (
                    <button
                      type="button"
                      onClick={() => onSelectSecondaryColor(index)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                        isSecondary
                          ? 'bg-store-option-secondary/10 text-store-option-secondary'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      style={
                        isSecondary
                          ? ({
                              '--store-option-secondary': secondaryAccent,
                            } as SecondaryAccentStyle)
                          : undefined
                      }
                      aria-pressed={isSecondary}
                      aria-label={`${isSecondary ? 'Remove' : 'Set'} backup color ${color.name}`}
                    >
                      {isSecondary ? 'Backup' : 'Set backup'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {descriptionExcerpt ? (
        <p className="mb-8 border-b border-gray-100 pb-8 text-sm leading-relaxed text-gray-600">
          {descriptionExcerpt}
        </p>
      ) : null}

      {effectiveAxes
        .filter((axis) => axis !== 'color')
        .map((axis) => (
          <ProductOptionAxisGroup
            key={axis}
            axis={axis}
            formatAxisLabel={formatAxisLabel}
            getAxisOptions={getAxisOptions}
            onSelectAttribute={onSelectAttribute}
            productData={productData}
            selectedAttributes={selectedAttributes}
          />
        ))}
    </>
  );
}
