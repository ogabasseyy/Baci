'use client';

// @imgly/background-removal dynamically imported at use to avoid 2MB ONNX bundle
import { Image as ImageIcon, Loader2, Plus, Wand2, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import type {
  CategoryConfig,
  CategoryVariantAttribute,
} from '@/lib/category-configs';
import { getCountryByCode } from '@/lib/countries';
import { isImeComposing } from '@/lib/is-ime-composing';
import type { ProductVariant } from '@/lib/products';

interface VariantBuilderProps {
  categoryConfig: CategoryConfig;
  onVariantsChange: (variants: ProductVariant[]) => void;
  basePrice: number;
  initialVariants?: ProductVariant[];
  attributeOrder?: string[]; // Optional prop to configure attribute order
  stockTrackingEnabled?: boolean;
}

interface AttributeSelection {
  [key: string]: string[];
}

// Static price formatter for variant inputs (hoisted to avoid per-render construction)
const PRICE_INPUT_FORMATTER = new Intl.NumberFormat('en-US');

// Timeout for AI variant suggestion retrieval
const VARIANT_SUGGESTION_POLL_MS = 3000; // Increased interval to reduce API request frequency and potential server load
const VARIANT_SUGGESTION_MAX_ATTEMPTS = 10; // Number of polling attempts for variant suggestions
const VARIANT_SUGGESTION_POLL_MAX_MS =
  VARIANT_SUGGESTION_POLL_MS * VARIANT_SUGGESTION_MAX_ATTEMPTS;

// Default attribute order, used if not provided via props
const DEFAULT_ATTRIBUTE_ORDER = ['ram', 'storage', 'color'];

// Attribute keys that should be numerically sorted in variants
const NUMERIC_SORT_ATTRIBUTE_KEYS = ['ram', 'storage', 'size', 'weight'];

// Module-scope readers for AI variant suggestions. Keeping the try/catch/finally
// out of the component body lets React Compiler memoize the component.
interface StoredVariantSuggestionsResult {
  // True when raw data was present (even if it failed to parse), so the caller
  // can stop the max-poll timer — matching the original control flow.
  hadRawData: boolean;
  suggestions: { attribute: string; options: string[] }[] | null;
}

function readStoredVariantSuggestions(): StoredVariantSuggestionsResult {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem('ai_variant_suggestions');
  } catch (error) {
    console.error(
      'Could not access sessionStorage for ai_variant_suggestions',
      error
    );
    return { hadRawData: false, suggestions: null };
  }

  if (!raw) {
    return { hadRawData: false, suggestions: null };
  }

  try {
    return { hadRawData: true, suggestions: JSON.parse(raw) };
  } catch (error) {
    console.error('Failed to parse AI variant suggestions', error);
    return { hadRawData: true, suggestions: null };
  } finally {
    // Clean up immediately after use
    try {
      sessionStorage.removeItem('ai_variant_suggestions');
    } catch (error) {
      console.error(
        'Could not remove ai_variant_suggestions from sessionStorage',
        error
      );
    }
  }
}

function mapSuggestionsToSelections(
  suggestions: { attribute: string; options: string[] }[],
  variantAttributes: CategoryConfig['variantAttributes']
): AttributeSelection {
  const newSelections: AttributeSelection = {};
  suggestions.forEach((suggestion) => {
    // Find attribute key case-insensitively
    const attrKey = variantAttributes?.find(
      (a) => a.label.toLowerCase() === suggestion.attribute.toLowerCase()
    )?.key;
    if (attrKey) {
      newSelections[attrKey] = suggestion.options;
    }
  });
  return newSelections;
}

// Module-scope image-enhancement pipeline. Keeping the dynamic import, throw,
// and try/catch out of the component body lets React Compiler memoize the
// component (BuildHIR can't yet lower those statements inside a component).
async function enhanceVariantImage(sourceImage: string): Promise<string> {
  // 1. Remove Background
  const { removeBackground } = await import('@imgly/background-removal');
  const blob = await removeBackground(sourceImage);
  const noBgUrl = URL.createObjectURL(blob);

  // 2. Adjust Lighting (Brightness/Contrast)
  const img = new window.Image();
  img.src = noBgUrl;
  await new Promise((resolve) => {
    img.onload = resolve;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const contrast = 1.1;
  const brightness = 10;
  const intercept = 128 * (1 - contrast);

  for (let i = 0; i < data.length; i += 4) {
    // Only adjust non-transparent pixels
    if (data[i + 3] > 0) {
      data[i] = data[i] * contrast + intercept + brightness;
      data[i + 1] = data[i + 1] * contrast + intercept + brightness;
      data[i + 2] = data[i + 2] * contrast + intercept + brightness;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// Helper to format text to Title Case
function toTitleCase(text: string) {
  if (!text) return '';
  return text
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Deep equality check for objects (attributes)
function areObjectsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null)
    return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  // O(1) membership instead of O(n) Array.includes() per key in this nested loop.
  const keysBSet = new Set(keysB);
  for (const key of keysA) {
    if (!keysBSet.has(key)) return false;

    const valA = (a as Record<string, unknown>)[key];
    const valB = (b as Record<string, unknown>)[key];

    if (!areObjectsEqual(valA, valB)) return false;
  }
  return true;
}

export function VariantBuilder({
  categoryConfig,
  onVariantsChange,
  basePrice,
  initialVariants = [],
  attributeOrder = DEFAULT_ATTRIBUTE_ORDER,
  stockTrackingEnabled = true,
}: VariantBuilderProps) {
  const { merchant } = useMerchant();
  const { toast } = useToast();
  const [attributeSelections, setAttributeSelections] =
    useState<AttributeSelection>({});
  const [variants, setVariants] = useState<ProductVariant[]>(initialVariants);
  const variantsRef = useRef(variants);
  const [textInputs, setTextInputs] = useState<Record<string, string>>({});
  const [enhancingImages, setEnhancingImages] = useState<
    Record<string, boolean>
  >({});

  // Ref to always have the latest onVariantsChange callback
  const onVariantsChangeRef = useRef(onVariantsChange);
  useEffect(() => {
    onVariantsChangeRef.current = onVariantsChange;
  }, [onVariantsChange]);

  const currencySymbol =
    getCountryByCode(merchant?.country || 'NG')?.currencySymbol || '₦';

  // Update ref when variants change
  useEffect(() => {
    variantsRef.current = variants;
  }, [variants]);

  // Effect to handle AI suggestions
  // Ref for timeout across effect runs
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function checkForSuggestions() {
      const { hadRawData, suggestions } = readStoredVariantSuggestions();

      if (!hadRawData) {
        return;
      }

      if (suggestions) {
        setAttributeSelections(
          mapSuggestionsToSelections(
            suggestions,
            categoryConfig.variantAttributes
          )
        );
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    // Handler for storage event
    function handleStorage(event: StorageEvent) {
      // Only act if key is ai_variant_suggestions and it was set (not null)
      if (event.key === 'ai_variant_suggestions' && event.newValue) {
        checkForSuggestions();
      }
    }

    // Attach listener
    window.addEventListener('storage', handleStorage);

    // Initial check in case suggestion exists from previous process/run
    checkForSuggestions();

    timeoutRef.current = setTimeout(() => {
      // Stop polling after maximum period; do not check for suggestions again here
      timeoutRef.current = null;
    }, VARIANT_SUGGESTION_POLL_MAX_MS); // Max polling duration, then give up

    // Cleanup
    return () => {
      window.removeEventListener('storage', handleStorage);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [categoryConfig.variantAttributes]); // Dependency on categoryConfig to ensure keys can be mapped

  // Generate variant combinations whenever attribute selections change
  useEffect(() => {
    if (!categoryConfig.supportsVariants || !categoryConfig.variantAttributes)
      return;

    const combinations = generateVariantCombinations(attributeSelections);

    // Merge with existing variants to preserve images and overrides
    const merged = combinations.map((combo) => {
      const existing = variantsRef.current.find((v) =>
        areObjectsEqual(v.attributes, combo)
      );

      return (
        existing || {
          id: `variant-temp-${generateUUID()}`,
          product_id: '',
          merchant_id: '',
          attributes: combo,
          stock_quantity: 0,
          images: [],
        }
      );
    });

    setVariants(merged);
    onVariantsChangeRef.current(merged);
  }, [
    attributeSelections,
    categoryConfig.supportsVariants,
    categoryConfig.variantAttributes,
  ]);

  // Helper to sort values numerically (for RAM, storage, etc.)
  const sortAttributeValues = (
    values: string[],
    attributeKey: string
  ): string[] => {
    // Sort numerically for RAM, storage, and similar attributes
    if (NUMERIC_SORT_ATTRIBUTE_KEYS.includes(attributeKey.toLowerCase())) {
      return [...values].sort((a, b) => {
        const numA = Number.parseFloat(a);
        const numB = Number.parseFloat(b);
        return numA - numB;
      });
    }
    return values;
  };

  const handleAttributeAdd = (attributeKey: string, value: string) => {
    if (!value) return;

    setAttributeSelections((prev) => {
      // Prevent duplicate values
      const existing = prev[attributeKey] || [];
      if (existing.includes(value)) return prev;

      const newValues = [...existing, value];
      const sortedValues = sortAttributeValues(newValues, attributeKey);

      return {
        ...prev,
        [attributeKey]: sortedValues,
      };
    });
  };

  const handleAttributeRemove = (attributeKey: string, value: string) => {
    setAttributeSelections((prev) => ({
      ...prev,
      [attributeKey]: prev[attributeKey]?.filter((v) => v !== value) || [],
    }));
  };

  const handleVariantImageUpload = (
    color: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUri = reader.result as string;

      // Apply image to ALL variants with this color
      const updated = variants.map((v) =>
        v.attributes.color === color
          ? { ...v, primary_image: dataUri, images: [dataUri] }
          : v
      );

      setVariants(updated);
      onVariantsChange(updated);
    };
    reader.readAsDataURL(file);
  };

  const handleEnhanceImage = (color: string) => {
    const variantToEnhance = variants.find((v) => v.attributes.color === color);
    if (!variantToEnhance?.primary_image) {
      toast({
        title: 'No image to enhance',
        description: 'Please upload an image first.',
        variant: 'destructive',
      });
      return;
    }

    setEnhancingImages((prev) => ({ ...prev, [color]: true }));
    toast({
      title: 'Enhancing Image',
      description:
        'Removing background and adjusting lighting... This may take a moment.',
    });

    return enhanceVariantImage(variantToEnhance.primary_image)
      .then((enhancedPhotoDataUri) => {
        const updated = variants.map((v) =>
          v.attributes.color === color
            ? {
                ...v,
                primary_image: enhancedPhotoDataUri,
                images: [enhancedPhotoDataUri],
              }
            : v
        );
        setVariants(updated);
        onVariantsChange(updated);
        toast({
          title: 'Image enhanced!',
          description: 'Background removed and lighting adjusted.',
        });
      })
      .catch((error: unknown) => {
        console.error('Enhancement failed:', error);
        toast({
          title: 'Enhancement Failed',
          description: `Could not enhance the image.`,
          variant: 'destructive',
        });
      })
      .finally(() => {
        setEnhancingImages((prev) => ({ ...prev, [color]: false }));
      });
  };

  const updateVariant = (
    variantId: string,
    updates: Partial<ProductVariant>
  ) => {
    const updated = variants.map((v) =>
      v.id === variantId ? { ...v, ...updates } : v
    );
    setVariants(updated);
    onVariantsChange(updated);
  };

  const getPlaceholderForAttribute = (
    attr: CategoryVariantAttribute
  ): string => {
    if (attr.options && attr.options.length > 0) {
      return `e.g., ${attr.options[0]}`;
    }
    switch (attr.type) {
      case 'color':
        return 'e.g., Black';
      case 'number':
        return `e.g., 42`;
      case 'text':
        if (attr.key === 'storage') return 'e.g., 256GB';
        if (attr.key === 'ram') return 'e.g., 8GB';
        return `Enter a value for ${attr.label}`;
      default:
        return 'Enter a value';
    }
  };

  // Calculate specCombos for performance
  const specCombos = variants.reduce(
    (combos, variant) => {
      const specs = Object.entries(variant.attributes)
        .filter(([key]) => key !== 'color')
        .map(([, value]) => value)
        .join(' / ');
      if (specs && !combos.find((c) => c.label === specs)) {
        const specAttrs = Object.fromEntries(
          Object.entries(variant.attributes).filter(([key]) => key !== 'color')
        );
        combos.push({ label: specs, attributes: specAttrs });
      }
      return combos;
    },
    [] as Array<{ label: string; attributes: Record<string, string> }>
  );

  const renderGeneratedVariants = () => {
    // Get unique colors
    const colors = [...new Set(variants.map((v) => v.attributes.color))].filter(
      Boolean
    );

    return (
      <div className="space-y-6">
        <Label className="text-base font-semibold">
          Configure variants ({variants.length} total)
        </Label>

        {stockTrackingEnabled ? (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Track Inventory</h3>
            <p className="text-sm text-muted-foreground">
              Manage stock levels for each variant.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
            Unlimited stock is enabled for this product. Variant stock
            quantities are not required.
          </div>
        )}

        {/* Section 1: Color Images */}
        {colors.length > 0 &&
          categoryConfig.variantAttributes?.some(
            (attr) => attr.key === 'color' && attr.hasImage
          ) && (
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                1. Upload color images
              </Label>
              <div className="grid grid-cols-4 gap-3">
                {colors.map((color) => {
                  const variantWithColor = variants.find(
                    (v) => v.attributes.color === color
                  );
                  const isEnhancing = enhancingImages[color];
                  return (
                    <div key={color} className="relative group">
                      <div className="border-2 border-dashed rounded-lg p-3 hover:bg-muted/50 transition-colors space-y-2">
                        <label className="cursor-pointer block">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleVariantImageUpload(color, e)}
                            disabled={isEnhancing}
                          />
                          <div className="aspect-square mb-2 rounded-lg overflow-hidden bg-muted flex items-center justify-center relative">
                            {isEnhancing && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                                <Loader2 className="size-6 text-white animate-spin" />
                              </div>
                            )}
                            {variantWithColor?.primary_image ? (
                              <Image
                                src={variantWithColor.primary_image}
                                alt={color}
                                width={120}
                                height={120}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ImageIcon className="size-8 text-muted-foreground" />
                            )}
                          </div>
                          <p className="text-sm font-medium text-center">
                            {toTitleCase(color)}
                          </p>
                        </label>
                        {variantWithColor?.primary_image && (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            className="w-full h-8"
                            onClick={() => handleEnhanceImage(color)}
                            disabled={isEnhancing}
                          >
                            {isEnhancing ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Wand2 className="size-4 mr-2" />
                            )}
                            Enhance
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        {/* Section 2: Spec-based pricing */}
        {specCombos.length > 0 && (
          <div className="space-y-3">
            <Label className="text-sm font-semibold">
              2. Set prices for specifications ({specCombos.length}{' '}
              {specCombos.length === 1 ? 'option' : 'options'})
            </Label>
            <p className="text-xs text-muted-foreground">
              Price applies to all colors with these specs. Leave blank to use
              base price.
            </p>
            <div className="space-y-2">
              {specCombos.map((combo) => {
                const variantWithSpec = variants.find((v) =>
                  Object.entries(combo.attributes).every(
                    ([key, value]) => v.attributes[key] === value
                  )
                );
                return (
                  <div
                    key={combo.label}
                    className="flex items-center gap-3 p-3 border rounded-lg bg-card"
                  >
                    <p className="flex-1 font-medium text-sm">
                      {combo.label || 'Base variant'}
                    </p>
                    <div className="w-40 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbol}
                      </span>
                      <Input
                        type="text"
                        placeholder={PRICE_INPUT_FORMATTER.format(basePrice)}
                        value={
                          variantWithSpec?.price_override != null
                            ? PRICE_INPUT_FORMATTER.format(
                                variantWithSpec.price_override
                              )
                            : ''
                        }
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          if (rawValue === '' || /^\d*\.?\d*$/.test(rawValue)) {
                            const price =
                              rawValue === '' ? undefined : Number(rawValue);
                            const updated = variants.map((v) =>
                              Object.entries(combo.attributes).every(
                                ([key, value]) => v.attributes[key] === value
                              )
                                ? { ...v, price_override: price }
                                : v
                            );
                            setVariants(updated);
                            onVariantsChange(updated);
                          }
                        }}
                        className="h-9 text-sm pl-8"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 3: Inventory per variant */}
        {stockTrackingEnabled && (
          <div className="space-y-3">
            <Label className="text-sm font-semibold">
              3. Set stock quantity per variant
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {variants.map((variant, index) => {
                const sortedAttributes = Object.entries(
                  variant.attributes
                ).sort(([keyA], [keyB]) => {
                  const indexA = attributeOrder.indexOf(keyA.toLowerCase());
                  const indexB = attributeOrder.indexOf(keyB.toLowerCase());
                  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                  if (indexA !== -1) return -1;
                  if (indexB !== -1) return 1;
                  return 0; // Keep original order for other attributes
                });
                const displayLabel = sortedAttributes
                  .map(([, value]) => value)
                  .join(' / ');

                return (
                  <div
                    key={variant.id || `variant-${index}`}
                    className="flex items-center gap-3 p-3 border rounded-lg bg-card"
                  >
                    <div className="size-10 rounded border overflow-hidden shrink-0 bg-muted">
                      {variant.primary_image && (
                        <Image
                          src={variant.primary_image}
                          alt=""
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <p className="flex-1 text-sm font-medium">{displayLabel}</p>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="0"
                        placeholder="Stock"
                        value={variant.stock_quantity || 0}
                        onChange={(e) =>
                          updateVariant(variant.id, {
                            stock_quantity:
                              Number.parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!categoryConfig.supportsVariants) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Variants</CardTitle>
        <CardDescription>
          Configure variants for this product based on{' '}
          {categoryConfig.displayName.toLowerCase()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Attribute Selectors */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Variant Attributes</Label>
          {categoryConfig.variantAttributes?.map((attr) => (
            <div key={attr.key} className="space-y-2">
              <Label>
                {attr.label}
                {attr.required && ' *'}
              </Label>

              <div className="flex gap-2">
                {
                  <>
                    <div className="flex-1 relative">
                      {(attributeSelections[attr.key]?.length ?? 0) > 0 && (
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 z-10 max-w-[calc(100%-3rem)] overflow-x-auto">
                          <div className="flex gap-1.5 flex-nowrap">
                            {(attributeSelections[attr.key] || []).map(
                              (value) => (
                                <span
                                  key={value}
                                  className="flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 text-primary rounded-md text-sm shrink-0"
                                >
                                  {value}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${value}`}
                                    className="hover:bg-primary/20 rounded-full p-0.5 cursor-pointer inline-flex items-center"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAttributeRemove(attr.key, value);
                                    }}
                                  >
                                    <X className="size-3" />
                                  </button>
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}
                      <Input
                        type="text"
                        placeholder={
                          (attributeSelections[attr.key]?.length ?? 0) > 0
                            ? ''
                            : getPlaceholderForAttribute(attr)
                        }
                        value={textInputs[attr.key] ?? ''}
                        onChange={(e) =>
                          setTextInputs((prev) => ({
                            ...prev,
                            [attr.key]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (isImeComposing(e)) return;
                            const value = textInputs[attr.key];
                            if (value) {
                              handleAttributeAdd(attr.key, value);
                              setTextInputs((prev) => ({
                                ...prev,
                                [attr.key]: '',
                              }));
                            }
                          }
                        }}
                        className="w-full"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const value = textInputs[attr.key];
                        if (value) {
                          handleAttributeAdd(attr.key, value);
                          setTextInputs((prev) => ({
                            ...prev,
                            [attr.key]: '',
                          }));
                        }
                      }}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </>
                }
              </div>
            </div>
          ))}
        </div>

        {/* Generated Variants */}
        {variants.length > 0 && renderGeneratedVariants()}
      </CardContent>
    </Card>
  );
}

// Helper function to generate all variant combinations
function generateVariantCombinations(
  selections: AttributeSelection
): Record<string, string>[] {
  const selectedAttrs = Object.entries(selections).filter(
    ([, values]) => values.length > 0
  );

  if (selectedAttrs.length === 0) return [];

  // Start with the first attribute's values
  let combinations: Record<string, string>[] = selectedAttrs[0][1].map(
    (value) => ({
      [selectedAttrs[0][0]]: value,
    })
  );

  // Cartesian product with remaining attributes
  for (let i = 1; i < selectedAttrs.length; i++) {
    const [key, values] = selectedAttrs[i];
    const newCombinations: Record<string, string>[] = [];

    for (const combo of combinations) {
      for (const value of values) {
        newCombinations.push({ ...combo, [key]: value });
      }
    }

    combinations = newCombinations;
  }

  return combinations;
}

function generateUUID(): string {
  // 2026 Best Practice: Assume crypto is globally available in modern environments (Node.js/Next.js)
  return crypto.randomUUID();
}
