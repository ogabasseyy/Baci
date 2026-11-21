import { stripProviderNames } from '@baci/shared/lib';
import type { BillItem } from './kuda-bill-items';
import { normalizeKudaItemCode } from './kuda-item-code';

function plain(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function namePaths(
  items: BillItem[] | undefined,
  code: string,
  prefix: string[],
  found: string[]
): string[] {
  for (const item of items ?? []) {
    const path = [...prefix, item.itemName];
    if (normalizeKudaItemCode(item.itemCode) === code) {
      found.push(path.join(' / '));
    }
    namePaths(item.billItems, code, path, found);
  }
  return found;
}

/**
 * Whether `path` (the checkout's "<package path>", the selected items'
 * names joined by " / ") is the name path to the package with this
 * (normalized) code among `items`, compared ignoring case and spacing, with
 * or without provider tags.
 */
export function isPackageNamePath(
  items: BillItem[] | undefined,
  code: string,
  path: string
): boolean {
  const sent = plain(path);
  return namePaths(items, code, [], []).some(
    (candidate) =>
      plain(candidate) === sent || plain(stripProviderNames(candidate)) === sent
  );
}
