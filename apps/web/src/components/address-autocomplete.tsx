'use client';

import { Home, Loader2, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ThemedInput } from '@/components/themed';
import { Input } from '@/components/ui/input';
import {
  generateSessionToken,
  type PlacePrediction,
} from '@/lib/google-places';
import { cn } from '@/lib/utils';
import { AddressAutocompleteAttribution } from './address-autocomplete-attribution';
import { AddressAutocompleteDropdown } from './address-autocomplete-dropdown';
import { loadPredictions } from './address-autocomplete-predictions';
import { selectAddressPrediction } from './address-autocomplete-selection';
import { useAddressAutocompleteStatus } from './address-autocomplete-status';
import type { AddressAutocompleteProps } from './address-autocomplete-types';

export type { PlaceDetails } from './address-autocomplete-types';

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

  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const { suggestionsFailed, handleProviderError, clearProviderError } =
    useAddressAutocompleteStatus(onError);
  const [selectedAddress, setSelectedAddress] = useState<{
    provider: 'google' | 'geoapify';
    values: string[];
  } | null>(null);
  // Sync internal value with the controlled prop during render (prev-prop
  // compare) so users never see a stale frame between commits.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== undefined) {
      if (value !== internalValue) clearProviderError();
      setInternalValue(value);
      if (selectedAddress && !selectedAddress.values.includes(value)) {
        setSelectedAddress(null);
      }
    }
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const predictionRequestId = useRef(0);
  const placeDetailsRequestId = useRef(0);

  // Initialize session token and mark as mounted
  useEffect(() => {
    setSessionToken(generateSessionToken());
    setMounted(true);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      predictionRequestId.current += 1;
      placeDetailsRequestId.current += 1;
    };
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
    setSelectedAddress(null);

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
      handleProviderError(false);
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
        handleProviderError
      );
    }, 300);
  };

  const handleClear = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    predictionRequestId.current += 1;
    placeDetailsRequestId.current += 1;
    setInternalValue('');
    setSelectedAddress(null);
    setPredictions([]);
    setIsOpen(false);
    setIsLoading(false);
    handleProviderError(false);
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
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
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

    void selectAddressPrediction(
      prediction,
      sessionToken,
      {
        onSelect,
        setSessionToken,
        setIsLoading,
        setSelectedProvider: (provider) => {
          setSelectedAddress({
            provider,
            values: [
              prediction.mainText,
              prediction.details?.formattedAddress || prediction.mainText,
            ],
          });
        },
        onError: handleProviderError,
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
    <div>
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

        <div className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 items-center gap-2">
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

        <AddressAutocompleteDropdown
          isOpen={isOpen}
          predictions={predictions}
          highlightedIndex={highlightedIndex}
          dropdownRef={dropdownRef}
          onSelect={handlePredictionSelect}
        />
      </div>
      {selectedAddress?.provider === 'geoapify' && (
        <div className="mt-2">
          <AddressAutocompleteAttribution provider="geoapify" />
        </div>
      )}
      {suggestionsFailed && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Address suggestions are unavailable. You can enter your full address,
          including city and state, manually.
        </p>
      )}
    </div>
  );
}
