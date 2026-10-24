'use client';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useId, useState } from 'react';
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
import { jumiaBrandMetadataSchema } from '@/schemas/jumia/metadata-query';
import { useJumiaMetadata } from './use-jumia-metadata';
export interface JumiaBrandItem {
  code: number;
  name: string;
}
interface BrandSelectorProps {
  merchantId: string;
  integrationId?: string;
  businessClientCode?: string;
  value?: JumiaBrandItem | null;
  onSelect: (brand: JumiaBrandItem) => void;
}
export function JumiaBrandSelector(props: BrandSelectorProps) {
  return (
    <BrandSelectorContent
      key={JSON.stringify([
        props.merchantId,
        props.integrationId,
        props.businessClientCode,
      ])}
      {...props}
    />
  );
}
function BrandSelectorContent({
  merchantId,
  integrationId,
  businessClientCode,
  value,
  onSelect,
}: BrandSelectorProps) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const id = useId();
  const query = new URLSearchParams({ merchantId });
  if (integrationId) query.set('integrationId', integrationId);
  if (businessClientCode) query.set('businessClientCode', businessClientCode);
  const metadata = useJumiaMetadata(
    `/api/marketplace/jumia/brands?${query}`,
    jumiaBrandMetadataSchema,
    requested && Boolean(merchantId)
  );
  const brands = metadata.data?.brands ?? [];
  const error = merchantId
    ? metadata.error
    : 'Merchant is required to load Jumia brands.';
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setRequested(true);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Jumia brand"
          aria-controls={id}
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value?.name || 'Select Jumia Brand...'}
          <ChevronsUpDown className="ml-2 size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search brand..." />
          <CommandList id={id}>
            {error ? (
              <div role="alert" className="p-4 text-sm">
                <p>{error}</p>
                {merchantId && (
                  <Button type="button" variant="link" onClick={metadata.retry}>
                    Retry
                  </Button>
                )}
              </div>
            ) : metadata.status === 'loading' ? (
              <p className="p-4 text-sm">Loading brands…</p>
            ) : (
              <CommandEmpty>No brand found.</CommandEmpty>
            )}
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
                        value?.code === brand.code ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {brand.name}
                  </CommandItem>
                ))}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
