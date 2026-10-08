'use client';

import { useId, useState } from 'react';
import { ThemedButton } from '@/components/themed/themed-button';
import { resolveSavingsDeviceSelection } from '@/lib/customer-savings-device';
import type {
  CustomerSavingsDraftProduct,
  CustomerSavingsDraftSelection,
} from '@/schemas/customer-savings-draft-public';

export function DraftCatalogue({
  products,
  busy,
  page,
  onSearch,
  onCreate,
}: {
  products: CustomerSavingsDraftProduct[];
  busy: boolean;
  page: { search: string; page: number };
  onSearch: (search: string, page: number) => void;
  onCreate: (selection: CustomerSavingsDraftSelection) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState<string | null>(null);
  const product = products.find((entry) => entry.id === productId);
  const variants =
    product?.variants?.filter((variant) => !variant.is_inventory_anchor) ?? [];
  const selected = product
    ? resolveSavingsDeviceSelection({ product, variantId })
    : null;
  const ready =
    selected?.ok &&
    !!selected.snapshot.condition?.trim() &&
    !(product?.has_variants && variants.length === 0);
  return (
    <section aria-label="Choose your exact device" className="space-y-5">
      <h3 className="text-lg font-semibold">Choose your device</h3>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(search, 0);
        }}
      >
        <label htmlFor={`${id}-search`} className="flex-1 space-y-2">
          Search devices
          <input
            id={`${id}-search`}
            type="search"
            maxLength={100}
            value={search}
            disabled={busy}
            onChange={(event) => setSearch(event.target.value)}
            className="block w-full rounded-lg border border-store-primary/30 bg-transparent p-3"
          />
        </label>
        <ThemedButton type="submit" disabled={busy}>
          Search
        </ThemedButton>
      </form>
      {!busy && products.length === 0 && (
        <p>No devices found. Try another search.</p>
      )}
      <label htmlFor={`${id}-device`} className="block space-y-2">
        Device
        <select
          id={`${id}-device`}
          value={product?.id ?? ''}
          disabled={busy}
          className="block w-full rounded-lg border border-store-primary/30 bg-store-background p-3 text-store-background-text"
          onChange={(event) => {
            setProductId(event.target.value);
            setVariantId(null);
          }}
        >
          <option value="">Select a device</option>
          {products.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-3">
        {page.page > 0 && (
          <ThemedButton
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onSearch(page.search, page.page - 1)}
          >
            Previous devices
          </ThemedButton>
        )}
        {products.length === 20 && (
          <ThemedButton
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onSearch(page.search, page.page + 1)}
          >
            More devices
          </ThemedButton>
        )}
      </div>
      {variants.length > 0 && product && (
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-3 font-semibold">Exact variant</legend>
          {variants.map((variant) => {
            const choice = resolveSavingsDeviceSelection({
              product,
              variantId: variant.id,
            });
            return (
              <label
                key={variant.id}
                className="flex items-start gap-3 rounded-lg border border-store-primary/30 p-4"
              >
                <input
                  type="radio"
                  name={`${id}-variant`}
                  checked={variantId === variant.id}
                  disabled={!choice.ok || !choice.snapshot.condition?.trim()}
                  onChange={() => setVariantId(variant.id)}
                  className="mt-1 accent-[var(--store-primary)]"
                />
                <span>
                  {choice.ok
                    ? `${choice.snapshot.variantLabel ?? variant.sku ?? 'Variant'} · ${choice.snapshot.condition ?? 'Condition unavailable'} · ₦${choice.snapshot.price.toLocaleString('en-NG')}`
                    : 'Variant unavailable'}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {product && !ready && (
        <p>Select the exact device variant and condition before continuing.</p>
      )}
      {ready && selected?.ok && (
        <p>
          Catalogue preview: ₦{selected.snapshot.price.toLocaleString('en-NG')}.
          Final draft details are read from the server.
        </p>
      )}
      <ThemedButton
        type="button"
        disabled={busy || !ready}
        onClick={() => {
          if (product && ready && selected?.ok)
            onCreate({ productId: product.id, variantId: selected.variantId });
        }}
      >
        Review savings draft
      </ThemedButton>
    </section>
  );
}
