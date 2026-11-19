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
import { jumiaCategoryMetadataSchema } from '@/schemas/jumia/metadata-query';
import { useJumiaMetadata } from './use-jumia-metadata';
export type JumiaCategorySelection = {
  code: number;
  name: string;
  attributeSetId: string;
};
interface CategorySelectorProps {
  merchantId: string;
  integrationId?: string;
  businessClientCode?: string;
  value?: number;
  leafOnly?: boolean;
  onSelect: (category: JumiaCategorySelection) => void;
}
export function JumiaCategorySelector(props: CategorySelectorProps) {
  return (
    <CategorySelectorContent
      key={JSON.stringify([
        props.merchantId,
        props.integrationId,
        props.businessClientCode,
      ])}
      {...props}
    />
  );
}
function CategorySelectorContent({
  merchantId,
  integrationId,
  businessClientCode,
  value,
  leafOnly = false,
  onSelect,
}: CategorySelectorProps) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const id = useId();
  const query = new URLSearchParams({ merchantId });
  if (integrationId) query.set('integrationId', integrationId);
  if (businessClientCode) query.set('businessClientCode', businessClientCode);
  const metadata = useJumiaMetadata(
    `/api/marketplace/jumia/categories?${query}`,
    jumiaCategoryMetadataSchema,
    requested && Boolean(merchantId)
  );
  const categories = metadata.data?.categories ?? [];
  const selected = categories.find((item) => item.code === value);
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
          aria-label="Jumia category"
          aria-controls={id}
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selected?.completePath ||
            (value != null ? 'Category selected' : 'Select Jumia Category...')}
          <ChevronsUpDown className="ml-2 size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search Jumia category..." />
          <CommandList id={id}>
            {metadata.error ? (
              <div role="alert" className="p-4 text-sm">
                <p>{metadata.error}</p>
                <Button type="button" variant="link" onClick={metadata.retry}>
                  Retry
                </Button>
              </div>
            ) : metadata.status === 'loading' ? (
              <p className="p-4 text-sm">Loading categories…</p>
            ) : (
              <CommandEmpty>No category found.</CommandEmpty>
            )}
            <CommandGroup>
              <ScrollArea className="h-72">
                {categories.map((category) => (
                  <CommandItem
                    key={category.code}
                    value={category.completePath}
                    disabled={leafOnly && category.hasChildren}
                    onSelect={() => {
                      if (leafOnly && category.hasChildren) return;
                      onSelect({
                        code: category.code,
                        name: category.name,
                        attributeSetId: category.attributeSet.sid,
                      });
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        value === category.code ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {category.completePath}
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
