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

interface JumiaCategoryItem {
  code: number;
  name: string;
  completePath: string;
  attributeSet?: string;
}

interface CategorySelectorProps {
  merchantId: string;
  integrationId?: string;
  value?: number;
  onSelect: (code: number, name: string) => void;
}

const CATEGORY_LISTBOX_ID = 'jumia-category-selector-listbox';

export function JumiaCategorySelector({
  merchantId,
  integrationId,
  value,
  onSelect,
}: CategorySelectorProps) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<JumiaCategoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [prevMerchantId, setPrevMerchantId] = useState(merchantId);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state during render when the merchant context changes so a new
  // merchant refetches its own categories (replaces a setState-in-effect sync).
  // The previous request's controller is aborted inside fetchCategories before
  // any new fetch starts (and on unmount), so we must not read/touch the ref
  // here — refs cannot be accessed during render.
  if (merchantId !== prevMerchantId) {
    setPrevMerchantId(merchantId);
    setCategories([]);
    setError(null);
    setHasFetched(false);
    setLoading(false);
    setOpen(false);
  }

  // The selected label is derived from the controlled value + loaded
  // categories, so it never needs to be mirrored into local state.
  const selectedMatch =
    value == null ? null : categories.find((c) => c.code === value);
  const selectedName = selectedMatch
    ? selectedMatch.completePath || selectedMatch.name
    : '';

  const fetchCategories = () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 10_000);
    fetch(
      `/api/marketplace/jumia/categories?merchantId=${encodeURIComponent(merchantId)}${integrationId ? `&integrationId=${encodeURIComponent(integrationId)}` : ''}`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load categories');
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        // Categories are already flat from the Vendor Center API
        const cats = Array.isArray(data.categories)
          ? data.categories.filter(
              (c: unknown): c is JumiaCategoryItem =>
                typeof c === 'object' &&
                c !== null &&
                typeof (c as Record<string, unknown>).code === 'number' &&
                typeof (c as Record<string, unknown>).name === 'string' &&
                typeof (c as Record<string, unknown>).completePath === 'string'
            )
          : [];
        setCategories(cats);
        setHasFetched(true);
      })
      .catch((err: unknown) => {
        if (didTimeout) {
          setError('Timeout while loading categories');
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof Error ? err.message : 'Failed to load categories'
        );
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!controller.signal.aborted || didTimeout) {
          setLoading(false);
        }
      });
  };

  // Abort any in-flight request when the component unmounts.
  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && error) {
      setError(null);
    }
    setOpen(nextOpen);
    if (nextOpen && !hasFetched && !error) {
      fetchCategories();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-controls={CATEGORY_LISTBOX_ID}
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedName ||
            (value
              ? loading
                ? 'Loading...'
                : 'Category selected'
              : 'Select Jumia Category...')}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search Jumia category..." />
          <CommandList id={CATEGORY_LISTBOX_ID}>
            <CommandEmpty>
              {error ? (
                <div className="p-4 text-sm text-center">
                  <p className="text-destructive">{error}</p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => fetchCategories()}
                    className="mt-2 text-sm underline"
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                'No category found.'
              )}
            </CommandEmpty>
            {loading ? (
              <div className="p-4 text-sm text-center text-muted-foreground">
                Loading categories…
              </div>
            ) : (
              <CommandGroup>
                <ScrollArea className="h-72">
                  {categories.map((category) => (
                    <CommandItem
                      key={category.code}
                      value={category.completePath || category.name}
                      onSelect={() => {
                        onSelect(category.code, category.name);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 size-4',
                          value === category.code ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {category.completePath || category.name}
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
