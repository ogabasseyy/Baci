import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import type { Product } from '@/types/product';
import type { SavingsProductChoice } from './start-savings.types';
import {
  applyStartSavingsProductSelection,
  getSavingsVariantOptions,
  readParam,
} from './start-savings-controller.utils';

export function useStartSavingsProductSelection({
  params,
  products,
  resolveProduct,
  setFormError,
  setSearchValue,
  setTargetAmount,
}: {
  params: { productId?: string | string[]; variantId?: string | string[] };
  products: Product[];
  resolveProduct?: (product: Product) => Promise<Product>;
  setFormError: (error: string | null) => void;
  setSearchValue: (value: string) => void;
  setTargetAmount?: Dispatch<SetStateAction<string>>;
}) {
  const [selectedCatalogProduct, setSelectedCatalogProduct] =
    useState<Product | null>(null);
  const [selectedProduct, setSelectedProduct] =
    useState<SavingsProductChoice | null>(null);
  const normalizedProductId = readParam(params.productId);
  const normalizedVariantId = readParam(params.variantId);
  const routeKey = JSON.stringify([normalizedProductId, normalizedVariantId]);
  const previousRouteKey = useRef(routeKey);
  const selectedVariantRequest = useRef<string | null>(null);
  const previousSelection = useRef<SavingsProductChoice | null>(null);
  const selectionVersion = useRef(0);
  const resolvedPreviewId = useRef<string | null>(null);
  useEffect(
    () => () => {
      selectionVersion.current++;
    },
    []
  );

  const applyProduct = (product: Product, variantId?: string | null) => {
    const requestedVariantId =
      variantId ??
      (product.id === normalizedProductId ? normalizedVariantId : null);
    const resolvedVariantId =
      requestedVariantId &&
      product.variants?.some((variant) => variant.id === requestedVariantId)
        ? requestedVariantId
        : !requestedVariantId && product.variants?.length === 1
          ? product.variants[0].id
          : null;

    selectedVariantRequest.current = requestedVariantId ?? resolvedVariantId;
    applyStartSavingsProductSelection({
      previousSelectedProduct: selectedProduct ?? previousSelection.current,
      product,
      setFormError,
      setSearchValue,
      setSelectedProduct: (choice) => {
        previousSelection.current = choice;
        setSelectedProduct(choice);
      },
      setTargetAmount,
      variantId: requestedVariantId ?? resolvedVariantId,
    });
    setSelectedCatalogProduct(product);
  };

  const selectProduct = (product: Product, variantId?: string | null) => {
    const version = ++selectionVersion.current;
    if (resolvedPreviewId.current !== product.id)
      resolvedPreviewId.current = null;
    applyProduct(product, variantId);
    if (!product.searchPreview) return;
    if (!resolveProduct) {
      setFormError('Connect to load current device options.');
      return;
    }
    void resolveProduct(product)
      .then((resolved) => {
        if (version === selectionVersion.current) {
          resolvedPreviewId.current = resolved.id;
          applyProduct(resolved, variantId);
        }
      })
      .catch(() => {
        if (version === selectionVersion.current) {
          setSelectedCatalogProduct(null);
          setSelectedProduct(null);
          setFormError(
            'Could not load current device options. Please try again.'
          );
        }
      });
  };
  const reconcileProduct = useEffectEvent(selectProduct);
  useEffect(() => {
    if (previousRouteKey.current !== routeKey) {
      selectionVersion.current++;
      resolvedPreviewId.current = null;
      previousRouteKey.current = routeKey;
      const nextProduct = products.find(
        (product) => product.id === normalizedProductId
      );
      if (nextProduct) {
        reconcileProduct(nextProduct, normalizedVariantId);
      } else {
        setSelectedCatalogProduct(null);
        setSelectedProduct(null);
      }
      return;
    }
    if (selectedCatalogProduct) {
      // A freshly resolved detail response is newer than an older search cache.
      if (resolvedPreviewId.current === selectedCatalogProduct.id) return;
      const refreshed = products.find(
        (product) => product.id === selectedCatalogProduct.id
      );
      if (
        refreshed &&
        !refreshed.searchPreview &&
        !selectedCatalogProduct.searchPreview &&
        JSON.stringify(refreshed) !== JSON.stringify(selectedCatalogProduct)
      ) {
        reconcileProduct(refreshed, selectedVariantRequest.current);
      }
      return;
    }
    if (!normalizedProductId || selectedProduct) {
      return;
    }
    const preselected = products.find(
      (product) => product.id === normalizedProductId
    );
    if (!preselected) {
      return;
    }
    reconcileProduct(preselected, normalizedVariantId);
  }, [
    normalizedProductId,
    normalizedVariantId,
    products,
    selectedProduct,
    selectedCatalogProduct,
    routeKey,
  ]);

  return {
    clearProductSelection: () => {
      selectionVersion.current++;
      resolvedPreviewId.current = null;
      previousSelection.current = null;
      selectedVariantRequest.current = null;
      setSelectedCatalogProduct(null);
      setSelectedProduct(null);
    },
    selectProduct,
    selectVariant: (variantId: string) => {
      if (!selectedCatalogProduct) {
        return;
      }
      applyProduct(selectedCatalogProduct, variantId);
    },
    selectedCatalogProduct,
    selectedProduct,
    variantOptions: selectedCatalogProduct
      ? getSavingsVariantOptions(selectedCatalogProduct)
      : [],
  };
}
