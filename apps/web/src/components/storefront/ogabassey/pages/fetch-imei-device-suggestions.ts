import type { ProductSuggestion } from './imei-checker-types';

/**
 * Module-scope fetch keeps the try/finally clause out of the component body
 * so React Compiler can memoize the checker.
 */
export async function fetchDeviceSuggestions(
  query: string
): Promise<ProductSuggestion[] | null> {
  try {
    const response = await fetch(
      `/api/storefront/products?q=${encodeURIComponent(query)}&limit=5`
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return (
      data.data?.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        name: p.name as string,
        category: p.category as string | undefined,
        image: p.image as string | undefined,
      })) || []
    );
  } catch {
    console.warn('Failed to fetch device suggestions');
    return null;
  }
}
