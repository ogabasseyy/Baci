import {
  cartItemToIdentity,
  displayLineMatchesAddLane,
  identityKeyOfDisplay,
  isCartCondition,
} from './shared-cart-display-identity';

export {
  cartItemToIdentity,
  displayLineMatchesAddLane,
  identityKeyOfDisplay,
  isCartCondition,
  type SharedCartIdentitySource,
} from './shared-cart-display-identity';

import {
  type CartItemIdentity,
  type CartLine,
  cartLineIdentity,
} from '@baci/shared/cart';

import type { Product } from '@/lib/products';

import type {
  CartItem,
  SharedCartDisplayItem,
  SharedCartSyncStatus,
} from './cart-types';
import type {
  SharedCartIntent,
  SharedCartLineTarget,
  SharedCartPendingEntry,
  SharedCartState,
} from './shared-cart-state';

export const MAX_CONFLICT_ATTEMPTS = 3;

export function deriveSyncStatus(state: SharedCartState): SharedCartSyncStatus {
  if (state.queue.some((entry) => entry.state === 'failed')) return 'retrying';
  if (state.queue.length > 0) return 'pending';
  if (state.syncError) return 'error';
  return 'synced';
}

export function minorToMajor(minor: number): number {
  return minor / 100;
}

export function fallbackProduct(productId: string): Product {
  return {
    brand: '',
    description: '',
    gtin: '',
    id: productId,
    image: '',
    imageHint: '',
    imageLarge: '',
    manage_stock: false,
    mpn: '',
    name: 'Unavailable item',
    price: 0,
    slug: productId,
    status: 'active',
    stock: 0,
  } as Product;
}

export function confirmedLineToDisplay(
  line: CartLine,
  products: Record<string, Product>
): SharedCartDisplayItem {
  const key = cartLineIdentity(line.item);
  const product = products[key] ?? fallbackProduct(line.item.productId);
  const options = line.item.options ?? {};
  const { color, colorValue, secondaryColor, secondaryColorValue, storage } =
    options;
  const display: SharedCartDisplayItem = {
    ...(product as CartItem),
    cartItemId: line.id,
    condition: line.item.condition,
    hydrationFailed: products[key] ? undefined : true,
    id: line.item.productId,
    pendingTempId: null,
    price: minorToMajor(line.unitPriceMinor),
    quantity: line.quantity,
    quizAwardId: line.voucherAwardId,
    quizVoucherToken: line.voucherToken,
    secondaryColor,
    secondaryColorValue,
    selectedColor: color,
    selectedColorValue: colorValue,
    selectedStorage: storage,
    serverLineId: line.id,
    variantAttributes:
      Object.keys(options).length > 0 ? { ...options } : undefined,
    variantId: line.item.variantId,
  };
  // The product shell can carry a stale PDP offer. The snapshot wins.
  display.offerId = line.item.offerId;
  // Unconditional resets: the cached product shell may carry stale
  // negotiated or assurance fields that the server snapshot refutes.
  display.negotiatedPrice =
    line.negotiatedUnitPriceMinor != null
      ? minorToMajor(line.negotiatedUnitPriceMinor)
      : undefined;
  display.negotiationStatus = line.negotiationStatus ?? 'none';
  display.hasAssurance = line.hasAssurance ?? false;
  display.assuranceRate = line.assuranceRate ?? undefined;
  return display;
}

export function intentIdentity(
  intent: SharedCartIntent
): CartItemIdentity | null {
  if (intent.kind !== 'add') return null;
  if (intent.input) return intent.input.item;
  return cartItemToIdentity({
    condition: intent.options?.condition,
    id: intent.product.id,
    offerId: intent.options?.offerId,
    selectedColor: intent.options?.color,
    selectedColorValue: intent.options?.colorValue,
    selectedStorage: intent.options?.storage,
    secondaryColor: intent.options?.secondaryColor,
    secondaryColorValue: intent.options?.secondaryColorValue,
    variantAttributes: intent.options?.variantAttributes,
    variantId: intent.options?.variantId,
  });
}

export function findDisplayIndex(
  display: SharedCartDisplayItem[],
  target: SharedCartLineTarget
): number {
  if (target.kind === 'temp') {
    return display.findIndex((line) => line.pendingTempId === target.tempId);
  }
  if (target.kind === 'identity') {
    return display.findIndex(
      (line) => identityKeyOfDisplay(line) === target.key
    );
  }
  return display.findIndex(
    (line) =>
      line.serverLineId === target.lineId || line.cartItemId === target.lineId
  );
}

export function optimisticAddLine(
  intent: Extract<SharedCartIntent, { kind: 'add' }>
): SharedCartDisplayItem {
  const options = intent.options;
  const attachments = intent.attachments;
  return {
    ...(intent.product as CartItem),
    cartItemId: `temp:${intent.tempId}`,
    condition: isCartCondition(options?.condition)
      ? options?.condition
      : undefined,
    negotiatedPrice:
      attachments?.negotiatedUnitPriceMinor != null
        ? minorToMajor(attachments.negotiatedUnitPriceMinor)
        : undefined,
    negotiationStatus: attachments?.negotiationStatus ?? 'none',
    pendingTempId: intent.tempId,
    quantity: intent.quantity,
    quizAwardId: attachments?.voucherAwardId ?? options?.quizAwardId,
    quizVoucherToken: attachments?.voucherToken ?? options?.quizVoucherToken,
    secondaryColor: options?.secondaryColor,
    secondaryColorValue: options?.secondaryColorValue,
    selectedColor: options?.color,
    selectedColorValue: options?.colorValue,
    selectedStorage: options?.storage,
    serverLineId: null,
    variantAttributes: options?.variantAttributes,
    variantId: options?.variantId,
  };
}

export function applyIntent(
  display: SharedCartDisplayItem[],
  entry: SharedCartPendingEntry
): SharedCartDisplayItem[] {
  if (entry.silent) return display;
  const intent = entry.intent;
  if (intent.kind === 'replace') return display;
  if (intent.kind === 'clear') return [];
  if (intent.kind === 'add') {
    const key = cartLineIdentity(intentIdentity(intent) as CartItemIdentity);
    const index = display.findIndex(
      (line) =>
        identityKeyOfDisplay(line) === key &&
        displayLineMatchesAddLane(line, {
          voucherToken:
            intent.input?.voucherToken ?? intent.attachments?.voucherToken,
          voucherAwardId:
            intent.input?.voucherAwardId ?? intent.attachments?.voucherAwardId,
          negotiatedUnitPriceMinor:
            intent.input?.negotiatedUnitPriceMinor ??
            intent.attachments?.negotiatedUnitPriceMinor,
          negotiationStatus:
            intent.input?.negotiationStatus ??
            intent.attachments?.negotiationStatus,
        })
    );
    if (index === -1) {
      return [...display, optimisticAddLine(intent)];
    }
    return display.map((line, lineIndex) =>
      lineIndex === index
        ? {
            ...line,
            pendingTempId: line.pendingTempId ?? intent.tempId,
            quantity: line.quantity + intent.quantity,
          }
        : line
    );
  }
  const index = findDisplayIndex(display, intent.target);
  if (index === -1) return display;
  if (intent.kind === 'remove') {
    return display.filter((_, lineIndex) => lineIndex !== index);
  }
  if (intent.kind === 'set_assurance') {
    return display.map((line, lineIndex) =>
      lineIndex === index
        ? { ...line, hasAssurance: intent.hasAssurance }
        : line
    );
  }
  if (intent.kind === 'set_negotiated_price') {
    return display.map((line, lineIndex) =>
      lineIndex === index
        ? {
            ...line,
            negotiatedPrice:
              intent.negotiatedUnitPriceMinor != null
                ? minorToMajor(intent.negotiatedUnitPriceMinor)
                : undefined,
            negotiationStatus:
              intent.negotiatedUnitPriceMinor != null
                ? ('accepted' as const)
                : ('none' as const),
          }
        : line
    );
  }
  // A quantity edit never claims a temp id: temp targets resolve only
  // when an add reconciles, so a claim here would strand the next edit
  // on the same line behind an unresolvable block.
  return display.map((line, lineIndex) =>
    lineIndex === index ? { ...line, quantity: intent.quantity } : line
  );
}

export function deriveDisplay(state: SharedCartState): SharedCartDisplayItem[] {
  const lines = (state.confirmed?.lines ?? []).map((line) =>
    confirmedLineToDisplay(line, state.products)
  );
  const confirmedKeys = new Set(
    (state.confirmed?.lines ?? []).map((line) => cartLineIdentity(line.item))
  );
  // Unimported cache lines stay visible until the import resolves, but
  // overlapping identities defer to the confirmed line: no duplicates,
  // and the pending status marks the transient quantities.
  for (const cached of state.unimportedCache) {
    if (confirmedKeys.has(cartLineIdentity(cartItemToIdentity(cached)))) {
      continue;
    }
    lines.push({
      ...(cached as SharedCartDisplayItem),
      pendingTempId: null,
      serverLineId: (cached as SharedCartDisplayItem).serverLineId ?? null,
    });
  }
  const applied = state.queue.reduce(applyIntent, lines);
  if (Object.keys(state.assuranceOverlays).length === 0) return applied;
  return applied.map((line) => {
    const overlay = state.assuranceOverlays[identityKeyOfDisplay(line)];
    return overlay === undefined ? line : { ...line, hasAssurance: overlay };
  });
}
