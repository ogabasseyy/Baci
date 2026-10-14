import { AnimatePresence, motion } from 'framer-motion';
import { MapPin } from 'lucide-react';
import type { RefObject } from 'react';
import type { PlacePrediction } from '@/lib/google-places';
import { cn } from '@/lib/utils';
import { AddressAutocompleteAttribution } from './address-autocomplete-attribution';

interface AddressAutocompleteDropdownProps {
  isOpen: boolean;
  predictions: PlacePrediction[];
  highlightedIndex: number;
  dropdownRef: RefObject<HTMLDivElement | null>;
  onSelect: (prediction: PlacePrediction) => void;
}

export function AddressAutocompleteDropdown({
  isOpen,
  predictions,
  highlightedIndex,
  dropdownRef,
  onSelect,
}: AddressAutocompleteDropdownProps) {
  return (
    <AnimatePresence>
      {isOpen && predictions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-9999 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-[300px] overflow-auto overflow-x-hidden"
          style={{ position: 'absolute' }}
        >
          <div className="p-1.5 space-y-0.5">
            {predictions.map((prediction, index) => (
              <button
                key={prediction.placeId}
                type="button"
                className={cn(
                  'w-full px-3 py-2.5 text-left text-sm rounded-lg transition-colors flex items-start gap-3 group/item text-gray-700',
                  highlightedIndex === index
                    ? 'bg-store-primary/5 text-gray-900'
                    : 'hover:bg-gray-50 hover:text-gray-900'
                )}
                onClick={() => onSelect(prediction)}
              >
                <div
                  className={cn(
                    'mt-0.5 p-1.5 rounded-full transition-colors',
                    highlightedIndex === index
                      ? 'bg-store-primary/10 text-store-primary'
                      : 'bg-gray-100 text-gray-500 group-hover/item:bg-store-primary/10 group-hover/item:text-store-primary'
                  )}
                >
                  <MapPin className="size-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'font-medium truncate transition-colors',
                      highlightedIndex === index
                        ? 'text-store-primary'
                        : 'text-gray-900'
                    )}
                  >
                    {prediction.mainText}
                  </p>
                  <p className="text-xs text-gray-600 truncate">
                    {prediction.secondaryText}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex justify-end sticky bottom-0">
            <AddressAutocompleteAttribution
              provider={
                predictions[0]?.provider === 'geoapify' ? 'geoapify' : 'google'
              }
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
