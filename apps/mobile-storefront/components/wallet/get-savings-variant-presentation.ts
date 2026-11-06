import { resolveColorSwatchValue } from '@/lib/cart-display';

export function getSavingsVariantPresentation(
  label: string | null | undefined
) {
  const parts =
    label
      ?.split('·')
      .map((part) => part.trim())
      .filter(Boolean) ?? [];
  let colour: { name: string; hex: string } | null = null;
  const details: string[] = [];
  let storage: string | null = null;
  for (const part of parts) {
    const capacity = /^(?:storage:\s*)?(\d+(?:\.\d+)?\s*(?:GB|TB))$/i.exec(
      part
    );
    if (!storage && capacity) {
      storage = capacity[1].replace(/\s+/g, '').toUpperCase();
      continue;
    }
    const name = part.replace(/^colou?r:\s*/i, '');
    const hex = resolveColorSwatchValue(name);
    if (!colour && hex) {
      colour = { name, hex };
    } else {
      details.push(part);
    }
  }
  return { colour, details: details.join(' · '), storage };
}
