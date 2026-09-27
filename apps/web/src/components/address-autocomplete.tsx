'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Home, Loader2, MapPin, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ThemedInput } from '@/components/themed';
import { Input } from '@/components/ui/input';
import {
  generateSessionToken,
  getPlaceDetails,
  getPlacePredictions,
  type PlacePrediction,
} from '@/lib/google-places';
import { cn } from '@/lib/utils';

export interface PlaceDetails {
  streetNumber: string;
  route: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  formattedAddress: string;
  location?: { latitude: number; longitude: number } | null;
}

interface AddressAutocompleteProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onSelect' | 'onError'
  > {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement> | string) => void;
  onSelect?: (place: PlaceDetails) => void;
  useThemedInput?: boolean;
  showIcon?: boolean;
  country?: string;
  /**
   * Called with `true` when a prediction request fails (network/API error,
   * e.g. Google Places quota exhausted) and `false` once a request succeeds.
   * Lets callers offer a manual fallback instead of a silently empty dropdown.
   */
  onError?: (failed: boolean) => void;
}

function initSession(
  setSessionToken: (token: string) => void,
  setMounted: (mounted: boolean) => void
): void {
  setSessionToken(generateSessionToken());
  setMounted(true);
}

async function loadPredictions(
  query: string,
  sessionToken: string,
  country: string | undefined,
  setPredictions: (predictions: PlacePrediction[]) => void,
  setIsLoading: (loading: boolean) => void,
  shouldApplyResult: () => boolean,
  onError?: (failed: boolean) => void
): Promise<void> {
  try {
    const results = await getPlacePredictions(query, sessionToken, country);
    if (!shouldApplyResult()) return;
    setPredictions(results);
    onError?.(false);
  } catch (error) {
    if (!shouldApplyResult()) return;
    console.error('Error fetching predictions:', error);
    setPredictions([]);
    onError?.(true);
  } finally {
    if (shouldApplyResult()) {
      setIsLoading(false);
    }
  }
}

interface SelectPredictionCallbacks {
  onSelect?: (place: PlaceDetails) => void;
  setSessionToken: (token: string) => void;
  setIsLoading: (loading: boolean) => void;
}

async function loadPlaceDetails(
  placeId: string,
  sessionToken: string,
  { onSelect, setSessionToken, setIsLoading }: SelectPredictionCallbacks,
  shouldApplyResult: () => boolean
): Promise<void> {
  try {
    const details = await getPlaceDetails(placeId, sessionToken);
    if (!shouldApplyResult()) return;

    if (details && onSelect) {
      onSelect({
        streetNumber: details.streetNumber || '',
        route: details.route || '',
        city: details.city || '',
        state: details.state || '',
        zip: details.postalCode || '',
        country: details.country || '',
        formattedAddress: details.formattedAddress,
        location: details.location,
      });
    }

    // Refresh session token
    setSessionToken(generateSessionToken());
  } catch (error) {
    if (!shouldApplyResult()) return;
    console.error('Error fetching place details:', error);
  } finally {
    if (shouldApplyResult()) {
      setIsLoading(false);
    }
  }
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  useThemedInput = false,
  showIcon = false,
  country,
  onError,
  className,
  ...props
}: AddressAutocompleteProps) {
  // Internal state for input value if not controlled
  const [internalValue, setInternalValue] = useState(value || '');

  // Sync internal value with the controlled prop during render (prev-prop
  // compare) so users never see a stale frame between commits.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== undefined) {
      setInternalValue(value);
    }
  }

  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const predictionRequestId = useRef(0);
  const placeDetailsRequestId = useRef(0);

  // Initialize session token and mark as mounted
  useEffect(() => {
    initSession(setSessionToken, setMounted);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInternalValue(newValue);

    // Call parent onChange
    if (onChange) {
      onChange(e);
    }

    setIsOpen(true);
    setHighlightedIndex(-1);

    // Debounce API call
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    placeDetailsRequestId.current += 1;

    if (newValue.length < 2) {
      predictionRequestId.current += 1;
      setPredictions([]);
      setIsLoading(false);
      onError?.(false);
      return;
    }

    const currentRequestId = predictionRequestId.current + 1;
    predictionRequestId.current = currentRequestId;
    setIsLoading(true);
    debounceTimer.current = setTimeout(() => {
      void loadPredictions(
        newValue,
        sessionToken,
        country,
        setPredictions,
        setIsLoading,
        () => predictionRequestId.current === currentRequestId,
        onError
      );
    }, 300);
  };

  const handleClear = () => {
    predictionRequestId.current += 1;
    placeDetailsRequestId.current += 1;
    setInternalValue('');
    setPredictions([]);
    setIsOpen(false);
    setIsLoading(false);
    onError?.(false);
    if (onChange) {
      // Create a synthetic event to clear the parent form
      const event = {
        target: { value: '' },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(event);
    }
    inputRef.current?.focus();
  };

  const handlePredictionSelect = (prediction: PlacePrediction) => {
    // Update input with main text
    setInternalValue(prediction.mainText);

    // Notify parent of text change
    if (onChange) {
      onChange(prediction.mainText);
    }

    setIsOpen(false);
    setIsLoading(true);
    predictionRequestId.current += 1;
    const currentRequestId = placeDetailsRequestId.current + 1;
    placeDetailsRequestId.current = currentRequestId;

    void loadPlaceDetails(
      prediction.placeId,
      sessionToken,
      {
        onSelect,
        setSessionToken,
        setIsLoading,
      },
      () => placeDetailsRequestId.current === currentRequestId
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || predictions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < predictions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : predictions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0) {
          handlePredictionSelect(predictions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const InputComponent = useThemedInput ? ThemedInput : Input;

  return (
    <div className="relative group" style={{ overflow: 'visible' }}>
      {showIcon && (
        <Home className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-store-primary transition-colors duration-200 z-10" />
      )}
      <InputComponent
        {...props}
        ref={inputRef}
        value={internalValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsOpen(true)}
        className={cn(
          showIcon ? 'pl-10' : '',
          'pr-10 transition-all duration-200',
          className
        )}
        autoComplete={props.autoComplete ?? 'new-password'}
        data-lpignore="true"
      />

      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
        {/* Only show clear button after hydration to prevent SSR mismatch */}
        {mounted && internalValue && !isLoading && (
          <button
            type="button"
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear address"
          >
            <X className="size-4" />
          </button>
        )}
        {isLoading && (
          <Loader2 className="size-4 animate-spin text-store-primary" />
        )}
      </div>

      {/* Custom Dropdown - positioned to escape parent containers */}
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
                  onClick={() => handlePredictionSelect(prediction)}
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
              <span className="text-xs text-muted-foreground opacity-60">
                Powered by{' '}
                <span className="font-medium">
                  <span className="text-[#4285F4]">G</span>
                  <span className="text-[#EA4335]">o</span>
                  <span className="text-[#FBBC05]">o</span>
                  <span className="text-[#4285F4]">g</span>
                  <span className="text-[#34A853]">l</span>
                  <span className="text-[#EA4335]">e</span>
                </span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
