'use client';

import { Loader2, Package, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ThemedButton } from '@/components/themed/themed-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JumiaBrandSelector } from './brand-selector';
import { JumiaCategorySelector } from './category-selector';
import { GamingSelectionPreview } from './gaming-selection-preview';
import type { JumiaMappingDraft } from './jumia-mapping-draft-panel';
import { JumiaMappingDraftPanel } from './jumia-mapping-draft-panel';
import { usePublishProductsDialog } from './use-publish-products-dialog';

interface PublishProductsDialogProps {
  integrationId: string;
  merchantId: string;
  countryCode?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishProductsDialog({
  integrationId,
  merchantId,
  countryCode = 'NG',
  open,
  onOpenChange,
}: PublishProductsDialogProps) {
  const [mappingDraft, setMappingDraft] = useState<JumiaMappingDraft | null>(
    null
  );
  const destinationKey = JSON.stringify([merchantId, integrationId]);
  const previousDestinationKey = useRef(destinationKey);
  useEffect(() => {
    if (previousDestinationKey.current !== destinationKey)
      setMappingDraft(null);
    previousDestinationKey.current = destinationKey;
  }, [destinationKey]);
  useEffect(() => {
    if (!open) setMappingDraft(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Add products to Jumia</DialogTitle>
          <DialogDescription>
            Draft destination mappings separately from the existing product
            publisher. Jumia reviews submitted feeds before listings become
            active.
          </DialogDescription>
        </DialogHeader>
        <GamingSelectionPreview
          merchantId={merchantId}
          integrationId={integrationId}
          mapping={mappingDraft}
        />
        {open && (
          <JumiaMappingDraftPanel
            merchantId={merchantId}
            integrationId={integrationId}
            onDraftChange={setMappingDraft}
          />
        )}
        <LegacyPublisher
          key={JSON.stringify([merchantId, integrationId, countryCode])}
          merchantId={merchantId}
          integrationId={integrationId}
          countryCode={countryCode}
          open={open}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function LegacyPublisher({
  merchantId,
  integrationId,
  countryCode,
  open,
  onOpenChange,
}: PublishProductsDialogProps) {
  const {
    selectedIds,
    search,
    setSearch,
    categoryCode,
    setCategoryCode,
    brand,
    setBrand,
    loading,
    submitting,
    loadError,
    filteredProducts,
    getPublishBlockReason,
    toggleProduct,
    submit,
  } = usePublishProductsDialog({
    integrationId,
    countryCode,
    open,
    onOpenChange,
  });

  return (
    <>
      <h3 className="font-medium">Legacy product publisher</h3>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label htmlFor="jumia-product-search">Products</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              id="jumia-product-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your active products"
              className="pl-8"
            />
          </div>
          <div className="max-h-52 overflow-y-auto rounded-md border p-2">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading products…
              </div>
            ) : loadError ? (
              <p className="p-4 text-sm text-destructive">{loadError}</p>
            ) : filteredProducts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No active products found.
              </p>
            ) : (
              filteredProducts.map((product) => {
                const blockReason = getPublishBlockReason(product);
                return (
                  <label
                    key={product.id}
                    htmlFor={`jumia-product-${product.id}`}
                    className="flex items-center gap-3 rounded px-2 py-2 hover:bg-muted"
                  >
                    <Checkbox
                      id={`jumia-product-${product.id}`}
                      checked={selectedIds.has(product.id)}
                      disabled={blockReason !== null}
                      onCheckedChange={() => toggleProduct(product.id)}
                    />
                    <Package className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate">{product.name}</span>
                      {blockReason ? (
                        <span className="block text-xs text-destructive">
                          {blockReason}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {product.sku || 'No SKU'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedIds.size} selected
          </p>
        </div>

        <div className="grid gap-2">
          <Label>Jumia Category</Label>
          <JumiaCategorySelector
            merchantId={merchantId}
            integrationId={integrationId}
            value={categoryCode ?? undefined}
            onSelect={(category) => setCategoryCode(category.code)}
          />
        </div>
        <div className="grid gap-2">
          <Label>Jumia Brand</Label>
          <JumiaBrandSelector
            merchantId={merchantId}
            integrationId={integrationId}
            value={brand}
            onSelect={setBrand}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <ThemedButton onClick={submit} disabled={submitting || loading}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Submitting…
            </>
          ) : (
            'Submit products'
          )}
        </ThemedButton>
      </DialogFooter>
    </>
  );
}
