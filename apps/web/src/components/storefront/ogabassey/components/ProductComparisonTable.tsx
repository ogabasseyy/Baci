'use client';

import { useState, useEffect, useRef } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import { getStorefrontLocale } from '@/lib/storefront-localization';
import { resolveStorefrontProductCategoryName } from '@/lib/storefront-product-category-name';
import { isUnsupportedSpecValue } from '@/lib/storefront-specs/is-unsupported-spec-value';
import { buildProductSpecData } from '@/lib/storefront-specs/spec-data';
import {
    buildProductComparisonMatrix,
    type ProductComparisonMatrixRow,
} from '@/lib/storefront-specs/spec-matrix';
import { normalizeProductCondition, type Product } from '../types';
import { ComparisonSlotCell } from './ComparisonSlotCell';
import type { SearchResultProduct } from './comparison-search-types';
import { useComparisonProductSearch } from './use-comparison-product-search';

interface ProductComparisonTableProps {
    mainProduct: Product;
    storeSlug?: string;
}

const FALLBACK_PRICE_CURRENCY = 'NGN';
const SUPPORTED_CURRENCY_CODES = typeof Intl.supportedValuesOf === 'function' ? new Set(Intl.supportedValuesOf('currency')) : null;
function getSafeCurrencyCode(currency?: string | null) {
    const code = currency?.trim().toUpperCase();
    return code && /^[A-Z]{3}$/.test(code) && (!SUPPORTED_CURRENCY_CODES || SUPPORTED_CURRENCY_CODES.has(code)) ? code : FALLBACK_PRICE_CURRENCY;
}

const _priceFormatterCache = new Map<string, Intl.NumberFormat>();

function getPriceFormatter(locale: string, currency: string): Intl.NumberFormat {
    const key = `${locale}:${currency}`;
    let formatter = _priceFormatterCache.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
        _priceFormatterCache.set(key, formatter);
    }
    return formatter;
}

export function ProductComparisonTable({
    mainProduct,
    storeSlug,
}: ProductComparisonTableProps) {
    const [comparisonProducts, setComparisonProducts] = useState<Product[]>([]);
    const [isSearching, setIsSearching] = useState<number | null>(null);
    const {
        query,
        results,
        loading,
        searchError,
        handleQueryChange,
        resetSearch,
        clearSearchError,
    } = useComparisonProductSearch({ mainProduct, comparisonProducts });
    const searchInputRef = useRef<HTMLInputElement>(null);
    const merchantContext = useMerchantSafe();
    const basePath = merchantContext?.basePath ?? (storeSlug ? `/${storeSlug}` : '');
    const priceLocale = getStorefrontLocale(merchantContext?.merchant?.country);
    const priceCurrency = getSafeCurrencyCode(merchantContext?.merchant?.payout_currency);

    const getProductHref = (product: Product) => {
        const categorySlug = product.categorySlug || mainProduct.categorySlug || 'products';
        return asRoute(`${basePath}/${categorySlug}/${product.slug}`);
    };

    useEffect(() => {
        if (isSearching !== null) {
            searchInputRef.current?.focus();
        }
    }, [isSearching]);

    const addProduct = (rawProduct: SearchResultProduct) => {
        const heroImage = rawProduct.imageLarge || rawProduct.image || '';
        const categoryName = resolveStorefrontProductCategoryName(rawProduct);
        const specData = buildProductSpecData({
            brand: rawProduct.brand,
            category: rawProduct.category,
            category_slug: rawProduct.category_slug,
            categories: rawProduct.categories,
            condition: rawProduct.condition,
            description: rawProduct.description,
            product_key_specs: rawProduct.product_key_specs,
            specifications: rawProduct.specifications,
            variant_attributes: rawProduct.variant_attributes,
        });
        const product: Product = {
            id: rawProduct.id,
            name: rawProduct.name,
            slug: rawProduct.slug,
            price: getPriceFormatter(priceLocale, priceCurrency).format(rawProduct.price),
            rawPrice: rawProduct.price,
            image: heroImage,
            images: [heroImage],
            description: rawProduct.description || '',
            rating: rawProduct.rating || 0,
            category: categoryName ?? rawProduct.category,
            categorySlug:
                [rawProduct.categories?.slug, rawProduct.category_slug]
                    .map((value) => value?.trim())
                    .find((value) => value && !isUnsupportedSpecValue(value)) ||
                undefined,
            condition: normalizeProductCondition(rawProduct.condition) || 'new',
            brand: rawProduct.brand,
            product_key_specs: rawProduct.product_key_specs,
            variant_attributes: rawProduct.variant_attributes,
            detailedSpecs: specData.detailedSpecs,
            specs: specData.specs,
        };

        setComparisonProducts(prev => [...prev, product]);
        setIsSearching(null);
        resetSearch();
    };

    const removeProduct = (index: number) => {
        setComparisonProducts(prev => prev.filter((_, i) => i !== index));
    };

    const comparisonColumns = [mainProduct, ...comparisonProducts];
    const comparisonMatrix = buildProductComparisonMatrix({
        products: comparisonColumns,
    });
    const summarySpecsByColumn = comparisonColumns.map(
        (product) => buildProductSpecData(product).specs
    );

    const getMatrixCellValue = (
        row: ProductComparisonMatrixRow,
        columnIndex: number,
        hasProduct: boolean
    ) => {
        if (!hasProduct) {
            return '';
        }

        return row.values[columnIndex] || '—';
    };

    const renderSummaryColumn = (columnIndex: number, hasProduct: boolean) => {
        const items = hasProduct ? summarySpecsByColumn[columnIndex] || [] : [];

        if (items.length === 0) {
            return <div className="p-4" />;
        }

        return (
            <div className="p-4 space-y-3">
                {items.map((item) => (
                    <div key={`${item.label}-${item.value}`} className="space-y-1.5">
                        <div className="text-xs text-store-background-text/55">{item.label}</div>
                        <div className="font-semibold text-sm text-store-background-text">{item.value}</div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="animate-in fade-in duration-300 overflow-x-auto pb-4">
            <div className="min-w-[800px] border border-store-background-text/10 rounded-2xl overflow-hidden bg-store-background shadow-sm">
                <div className="grid grid-cols-4 border-b border-store-background-text/10 bg-store-background-text/5">
                    <div className="col-start-2 p-4 flex flex-col items-center justify-end h-56 border-r border-store-background-text/10 relative bg-store-background">
                        <div className="absolute top-3 right-3">
                            <span className="bg-store-primary text-store-primary-text text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                                Current
                            </span>
                        </div>
                        <div className="relative size-24 mb-3">
                            <CdnFormatImage
                                src={mainProduct.images?.[0] || mainProduct.image}
                                alt={mainProduct.name}
                                fill
                                sizes="96px"
                                className="object-contain"
                            />
                        </div>
                        <h3 className="font-bold text-sm text-center line-clamp-2 mb-1">{mainProduct.name}</h3>
                        <p className="text-store-primary font-bold text-sm">{mainProduct.price}</p>
                    </div>

                    {[0, 1].map((slotIdx) => {
                        const product = comparisonProducts[slotIdx];
                        const isSlotSearching = isSearching === slotIdx;

                        return (
                            <ComparisonSlotCell
                                key={slotIdx}
                                slotIdx={slotIdx}
                                product={product}
                                isSearching={isSlotSearching}
                                mainCategoryLabel={mainProduct.category}
                                getProductHref={getProductHref}
                                onRemoveProduct={removeProduct}
                                onStartSearch={(nextSlotIdx) => {
                                    setIsSearching(nextSlotIdx);
                                    resetSearch();
                                }}
                                onCancelSearch={() => {
                                    setIsSearching(null);
                                    clearSearchError();
                                }}
                                query={query}
                                setQuery={handleQueryChange}
                                results={results}
                                loading={loading}
                                searchError={searchError}
                                onSelectProduct={addProduct}
                                searchInputRef={searchInputRef}
                                locale={priceLocale}
                                currencyCode={priceCurrency}
                            />
                        );
                    })}
                </div>

                <div className="divide-y divide-store-background-text/10">
                    <div className="grid grid-cols-4">
                        <div className="p-4 bg-store-background-text/5 text-xs font-bold text-store-background-text/55 uppercase tracking-wider flex items-center">
                            Key Specs
                        </div>
                        <div className="col-span-3 grid grid-cols-3 divide-x divide-store-background-text/10">
                            {renderSummaryColumn(0, true)}
                            {renderSummaryColumn(1, Boolean(comparisonProducts[0]))}
                            {renderSummaryColumn(2, Boolean(comparisonProducts[1]))}
                        </div>
                    </div>

                    {comparisonMatrix.groups.map((category) => (
                        <div key={category.category}>
                            <div className="px-4 py-2 bg-store-background-text/5 text-xs font-bold text-store-background-text uppercase tracking-widest border-y border-store-background-text/10">
                                {category.category}
                            </div>

                            {category.rows.map((item) => (
                                <div key={`${category.category}-${item.label}`} className="grid grid-cols-4 min-h-[48px] divide-x divide-store-background-text/10 hover:bg-store-background-text/5 transition-colors">
                                    <div className="p-3 text-xs font-bold text-store-background-text/55 flex items-center pl-6">
                                        {item.label}
                                    </div>

                                    <div className="p-3 text-sm text-store-background-text leading-snug flex items-center">
                                        {getMatrixCellValue(item, 0, true)}
                                    </div>

                                    <div className="p-3 text-sm text-store-background-text/70 leading-snug flex items-center">
                                        {getMatrixCellValue(item, 1, Boolean(comparisonProducts[0]))}
                                    </div>

                                    <div className="p-3 text-sm text-store-background-text/70 leading-snug flex items-center">
                                        {getMatrixCellValue(item, 2, Boolean(comparisonProducts[1]))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}

                    {comparisonMatrix.groups.length === 0 && (
                        <div className="p-8 text-center text-store-background-text/55">
                            No detailed specifications available for the main product.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
