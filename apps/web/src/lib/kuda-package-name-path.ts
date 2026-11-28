import { stripProviderNames } from '@baci/shared/lib';
import type { BillItem } from './kuda-bill-items';
import { normalizeKudaItemCode } from './kuda-item-code';

function plain(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** An item name as the billers list shows it: provider tags stripped, "Plan" if nothing is left. */
function displayName(name: string) {
  return stripProviderNames(name) || 'Plan';
}

/**
 * Every name path to the package with this code, both as Kuda named the
 * items and as the billers list displays them (each segment cleaned like
 * the billers route does), since checkouts send the displayed names.
 */
function namePaths(
  items: BillItem[] | undefined,
  code: string,
  raw: string[],
  shown: string[],
  found: string[]
): string[] {
  for (const item of items ?? []) {
    const rawPath = [...raw, item.itemName];
    const shownPath = [...shown, displayName(item.itemName)];
    if (normalizeKudaItemCode(item.itemCode) === code) {
      found.push(rawPath.join(' / '), shownPath.join(' / '));
    }
    namePaths(item.billItems, code, rawPath, shownPath, found);
  }
  return found;
}

/**
 * Whether `path` (the checkout's "<package path>", the selected items'
 * names joined by " / ") is the name path to the package with this
 * (normalized) code among `items`, compared ignoring case and spacing, as
 * Kuda named it or as the billers list displays it.
 */
export function isPackageNamePath(
  items: BillItem[] | undefined,
  code: string,
  path: string
): boolean {
  const sent = plain(path);
  return namePaths(items, code, [], [], []).some(
    (candidate) => plain(candidate) === sent
  );
}
