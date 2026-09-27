'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getCurrencyCode } from '@/lib/currency';
import type { PublishProduct } from '@/schemas/jumia/publish-products';
import type { JumiaProductMappingState } from './publish-products-data-loader';
import {
  loadMappedProductMappings,
  loadPublishProducts,
} from './publish-products-data-loader';
import { isJumiaProductFullyMapped } from './publish-products-mapping';
import { getJumiaPublishBlockReason } from './publish-products-payload';
import { submitJumiaProducts } from './submit-jumia-products';

const MIXED_PRODUCT_METADATA_REASON =
  'Select products with the same category and brand as the first selected product.';

type UsePublishProductsDialogArgs = {
  integrationId: string;
  countryCode?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function usePublishProductsDialog({
  integrationId,
  countryCode = 'NG',
  open,
  onOpenChange,
}: UsePublishProductsDialogArgs) {
  const { toast } = useToast();
  const [products, setProducts] = useState<PublishProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [categoryCode, setCategoryCode] = useState<number | null>(null);
  const [brand, setBrand] = useState<{ code: number; name: string } | null>(
    null
  );
  const [productsLoading, setProductsLoading] = useState(false);
  const [mappedProductsLoading, setMappedProductsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(
    null
  );
  const [mappedProductsLoadError, setMappedProductsLoadError] = useState<
    string | null
  >(null);
  const [mappedProducts, setMappedProducts] = useState<
    Map<string, JumiaProductMappingState[]>
  >(new Map());

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setProductsLoading(true);
    setProductsLoadError(null);
    loadPublishProducts(search.trim() || undefined, controller.signal)
      .then((loadedProducts) => {
        setProducts((current) => {
          const productsById = new Map(
            current.map((product) => [product.id, product])
          );
          for (const product of loadedProducts) {
            productsById.set(product.id, product);
          }
          return [...productsById.values()];
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setProductsLoadError(
          error instanceof Error ? error.message : 'Failed to load products'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setProductsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [open, search]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setMappedProductsLoading(true);
    setMappedProductsLoadError(null);
    loadMappedProductMappings(integrationId, controller.signal)
      .then((mappings) => {
        setMappedProducts(mappings);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setMappedProductsLoadError(
          error instanceof Error
            ? error.message
            : 'Failed to load mapped Jumia products'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setMappedProductsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [open, integrationId]);

  const loading = productsLoading || mappedProductsLoading;
  const loadError = productsLoadError ?? mappedProductsLoadError;

  const getPublishBlockReason = (product: PublishProduct): string | null => {
    if (isJumiaProductFullyMapped(mappedProducts.get(product.id))) {
      return 'Already published to this Jumia integration.';
    }
    const productReason = getJumiaPublishBlockReason(product);
    if (productReason) return productReason;

    const firstSelectedProduct = products.find((candidate) =>
      selectedIds.has(candidate.id)
    );
    if (
      firstSelectedProduct &&
      !selectedIds.has(product.id) &&
      (firstSelectedProduct.category?.trim().toLocaleLowerCase() ?? '') !==
        (product.category?.trim().toLocaleLowerCase() ?? '')
    ) {
      return MIXED_PRODUCT_METADATA_REASON;
    }
    if (
      firstSelectedProduct &&
      !selectedIds.has(product.id) &&
      (firstSelectedProduct.brand?.trim().toLocaleLowerCase() ?? '') !==
        (product.brand?.trim().toLocaleLowerCase() ?? '')
    ) {
      return MIXED_PRODUCT_METADATA_REASON;
    }
    return null;
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProducts = products.filter((product) => {
    if (!normalizedSearch) return true;
    return [
      product.name,
      product.sku ?? '',
      ...(product.variants ?? []).map((variant) => variant.sku ?? ''),
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  });

  const toggleProduct = (productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product || getPublishBlockReason(product)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const submit = () => {
    const selected = products.filter((product) => selectedIds.has(product.id));
    if (!categoryCode || !brand || selected.length === 0) {
      toast({
        title: 'Complete the selection',
        description:
          'Choose at least one product, a Jumia category, and a brand.',
        variant: 'destructive',
      });
      return;
    }

    const invalid = selected.find(
      (product) =>
        !product.sku?.trim() &&
        (!(product.variants ?? []).length ||
          (product.variants ?? []).some(
            (variant) =>
              variant.is_inventory_anchor !== true && !variant.sku?.trim()
          ))
    );
    if (invalid) {
      toast({
        title: 'SKU required',
        description: `${invalid.name} needs a SKU for every variant before it can be submitted to Jumia.`,
        variant: 'destructive',
      });
      return;
    }

    const blocked = selected.find(
      (product) => getPublishBlockReason(product) !== null
    );
    if (blocked) {
      toast({
        title: 'Product not ready for Jumia',
        description: `${blocked.name}: ${getPublishBlockReason(blocked)}`,
        variant: 'destructive',
      });
      return;
    }

    const firstSelectedProduct = selected[0];
    const hasMixedProductMetadata = selected.some(
      (product) =>
        (product.category?.trim().toLocaleLowerCase() ?? '') !==
          (firstSelectedProduct?.category?.trim().toLocaleLowerCase() ?? '') ||
        (product.brand?.trim().toLocaleLowerCase() ?? '') !==
          (firstSelectedProduct?.brand?.trim().toLocaleLowerCase() ?? '')
    );
    if (hasMixedProductMetadata) {
      toast({
        title: 'Choose one product group per batch',
        description: MIXED_PRODUCT_METADATA_REASON,
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    const marketplaceCurrency = getCurrencyCode(countryCode);
    submitJumiaProducts({
      products: selected,
      integrationId,
      categoryCode,
      brand,
      marketplaceCurrency,
    })
      .then((results) => {
        const succeeded = results.filter((result) => result.ok).length;
        const partial = results.filter((result) => result.partial).length;
        const failed = results.length - succeeded;
        if (succeeded > 0) {
          toast({
            title: 'Products submitted to Jumia',
            description:
              partial > 0
                ? `${succeeded} product${succeeded === 1 ? '' : 's'} was accepted by Jumia; local mapping reconciliation is pending.${failed ? ` ${failed} failed.` : ''}`
                : `${succeeded} product${succeeded === 1 ? '' : 's'} is pending Jumia approval.${failed ? ` ${failed} failed.` : ''}`,
          });
          onOpenChange(false);
        } else {
          toast({
            title: 'Submission failed',
            description: String(
              results[0]?.body?.error || 'Jumia rejected the product feed.'
            ),
            variant: 'destructive',
          });
        }
      })
      .catch(() => {
        toast({
          title: 'Submission failed',
          description: 'Please try again.',
          variant: 'destructive',
        });
      })
      .finally(() => setSubmitting(false));
  };

  return {
    products,
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
  };
}
