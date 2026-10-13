'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface JumiaBrandItem {
  code: number;
  name: string;
}

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

const BRAND_LISTBOX_ID = 'jumia-brand-selector-listbox';

interface BrandSelectorProps {
  merchantId: string;
  integrationId?: string;
  value?: JumiaBrandItem | null;
  onSelect: (brand: JumiaBrandItem) => void;
}

export function JumiaBrandSelector({
  merchantId,
  integrationId,
  value,
  onSelect,
}: BrandSelectorProps) {
  const [open, setOpen] = useState(false);
  const [brands, setBrands] = useState<JumiaBrandItem[]>([]);
  // Seed both status and message from the initial prop so a missing merchant
  // shows the requirement (not the loading spinner, which the 'idle' branch
  // renders) on mount without an effect; the merchant-change reset below keeps
  // them in sync afterwards.
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>(
    merchantId ? 'idle' : 'error'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    merchantId ? null : 'Merchant is required to load Jumia brands.'
  );

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchBrands = (currentMerchantId: string) => {
    // Defensive: never hit the API without a merchant id.
    if (!currentMerchantId) {
      setFetchStatus('error');
      setErrorMessage('Merchant is required to load Jumia brands.');
      return;
    }
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setFetchStatus('loading');
    setErrorMessage(null);
    fetch(
      `/api/marketplace/jumia/brands?merchantId=${encodeURIComponent(currentMerchantId)}${integrationId ? `&integrationId=${encodeURIComponent(integrationId)}` : ''}`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load brands');
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        // Differentiate malformed response from empty brands list
        if (!data || typeof data !== 'object' || !('brands' in data)) {
          setErrorMessage(
            'Unexpected response from brands API — please try again'
          );
          setFetchStatus('error');
          return;
        }
        if (!Array.isArray(data.brands)) {
          setErrorMessage('Malformed brands data received — please try again');
          setFetchStatus('error');
          return;
        }
        const items = data.brands.filter(
          (b: unknown): b is JumiaBrandItem =>
            typeof b === 'object' &&
            b !== null &&
            typeof (b as Record<string, unknown>).code === 'number' &&
            typeof (b as Record<string, unknown>).name === 'string'
        );
        setBrands(items);
        setFetchStatus('success');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to load brands'
        );
        setFetchStatus('error');
      });
  };

  // Abort any in-flight request when the component unmounts or the merchant
  // changes. The ref read stays inside the effect so it is never touched during
  // render; the merchant-change state reset is derived during render below.
  // merchantId is an intentional dependency: the cleanup must re-run when the
  // merchant changes so a stale request can't resolve into the new merchant's
  // brand list, even though the cleanup body only reads the ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: merchantId re-arms the abort cleanup on merchant change; the body reads only the ref
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [merchantId]);

  // Reset the brand list inline during render when the merchant changes,
  // instead of inside an effect. Routing this reset through useEffect forces an
  // extra render where the previous merchant's brands are briefly visible, and
  // re-arming `fetchStatus` inside an effect bails the React Compiler out of
  // memoizing the component. The stale request is aborted by the effect cleanup
  // above (keyed on merchantId), keeping every ref read out of render.
  // See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevMerchantId, setPrevMerchantId] = useState(merchantId);
  if (merchantId !== prevMerchantId) {
    setPrevMerchantId(merchantId);
    setBrands([]);
    setErrorMessage(
      merchantId ? null : 'Merchant is required to load Jumia brands.'
    );
    setFetchStatus(merchantId ? 'idle' : 'error');
    // Close the selector on merchant change so it can't sit on a stale
    // "Loading brands…" frame (fetching happens on open, and no open-change
    // event fires here); reopening re-fetches for the new merchant.
    setOpen(false);
  }

  // Fetch in response to the user opening the popover. Loading brands is the
  // direct result of a user interaction, so it belongs in the event handler
  // rather than an effect that re-arms the loading status on every render.
  // See https://react.dev/learn/you-might-not-need-an-effect#fetching-data
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && merchantId && fetchStatus === 'idle') {
      fetchBrands(merchantId);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-controls={BRAND_LISTBOX_ID}
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value?.name || 'Select Jumia Brand...'}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search brand..." />
          <CommandList id={BRAND_LISTBOX_ID}>
            {fetchStatus === 'error' && (
              <CommandEmpty>
                <div className="p-4 text-sm text-center">
                  <p className="text-destructive">{errorMessage}</p>
                  {merchantId && (
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => fetchBrands(merchantId)}
                      className="mt-2 text-sm underline"
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </CommandEmpty>
            )}
            {fetchStatus === 'success' && brands.length === 0 && (
              <CommandEmpty>No brand found.</CommandEmpty>
            )}
            {fetchStatus === 'loading' || fetchStatus === 'idle' ? (
              <div className="p-4 text-sm text-center text-muted-foreground">
                Loading brands…
              </div>
            ) : (
              <CommandGroup>
                <ScrollArea className="h-72">
                  {brands.map((brand) => (
                    <CommandItem
                      key={brand.code}
                      value={brand.name}
                      onSelect={() => {
                        onSelect(brand);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 size-4',
                          value?.code === brand.code
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                      {brand.name}
                    </CommandItem>
                  ))}
                </ScrollArea>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
