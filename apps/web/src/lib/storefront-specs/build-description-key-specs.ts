import type { ProductSpecSection } from './spec-data';
import { normalizeSpecValueText } from './spec-value-normalization';

export function buildDescriptionKeySpecs(
  description?: string | null
): ProductSpecSection[] {
  if (!description || !/<table/i.test(description)) {
    return [];
  }

  const keySpecsHeadingIndex = description.search(
    /<h[1-6][^>]*>\s*Key Specs(?: at a Glance)?\s*<\/h[1-6]>/i
  );
  if (keySpecsHeadingIndex < 0) {
    return [];
  }
  const fromKeySpecs = description.slice(keySpecsHeadingIndex);
  const headingEndMatch = fromKeySpecs.match(
    /^<h[1-6][^>]*>\s*Key Specs(?: at a Glance)?\s*<\/h[1-6]>/i
  );
  if (!headingEndMatch) {
    return [];
  }
  const afterHeadingContent = fromKeySpecs.slice(headingEndMatch[0].length);
  const nextHeadingIndex = afterHeadingContent.search(/<h[1-6][^>]*>/i);
  const boundedContent =
    nextHeadingIndex >= 0
      ? afterHeadingContent.slice(0, nextHeadingIndex)
      : afterHeadingContent;
  const tableMatch = boundedContent.match(/<table[\s\S]*?<\/table>/i);

  if (!tableMatch) {
    return [];
  }

  const items = [...tableMatch[0].matchAll(/<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) => {
      const cells = [
        ...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi),
      ]
        .map((cellMatch) => normalizeSpecValueText(cellMatch[1]))
        .filter(Boolean);

      if (cells.length < 2) {
        return null;
      }

      const [label, value] = cells;
      if (!label || !value || /^(feature|what you get)$/i.test(label)) {
        return null;
      }

      return { label, value };
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));

  if (items.length === 0) {
    return [];
  }

  return [{ category: 'Key Specs', items }];
}
