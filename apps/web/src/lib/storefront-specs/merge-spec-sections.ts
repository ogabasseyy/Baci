import { dedupeSpecItems } from './dedupe-spec-items';
import type { ProductSpecSection } from './spec-data';

function isGenericSpecSection(category: string) {
  return category.trim().toLowerCase().replace(/\s+/g, ' ') === 'key specs';
}

export function mergeSpecSections(...sections: ProductSpecSection[][]) {
  const merged: ProductSpecSection[] = [];
  const sectionsByIdentity = new Map<string, ProductSpecSection>();

  for (const [sectionGroupIndex, sectionGroup] of sections.entries()) {
    for (const section of sectionGroup) {
      const sectionIdentity =
        section.category
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || section.category.trim().toLowerCase().replace(/\s+/g, ' ');
      let existingSection = sectionsByIdentity.get(sectionIdentity);

      if (!existingSection) {
        existingSection = { category: section.category, items: [] };
        sectionsByIdentity.set(sectionIdentity, existingSection);
        merged.push(existingSection);
      }

      // A derived, unscoped "Key Specs" section cannot override or repeat a
      // stored field that already has a semantic section.
      const incomingItems =
        sectionGroupIndex > 0 && isGenericSpecSection(section.category)
          ? section.items.filter((item) => {
              const visibleItems = merged.flatMap((entry) =>
                entry.items.map((visibleItem) => ({
                  item: visibleItem,
                  section: entry.category,
                }))
              );
              return visibleItems.every(
                ({ item: visibleItem, section: visibleSection }) =>
                  dedupeSpecItems([visibleItem, item], {
                    section: visibleSection,
                  }).length === 2
              );
            })
          : section.items;
      // A spec identity is its semantic section plus canonical field/label.
      // Stored items are appended first, so they win exact/conflicting ties.
      existingSection.items = dedupeSpecItems(
        [...existingSection.items, ...incomingItems],
        { section: existingSection.category }
      );
    }
  }

  return merged.filter((section) => section.items.length > 0);
}
