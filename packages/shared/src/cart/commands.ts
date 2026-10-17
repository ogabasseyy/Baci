import type {
  CartCommand,
  CartErrorCode,
  CartInputLine,
  CartItemIdentity,
} from './types';
import {
  SHARED_CART_MAX_LINES,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from './types';

export interface CartCommandIssue {
  code: CartErrorCode;
  message: string;
}

/**
 * The complete session command vocabulary, mirroring the
 * commerce_cart_grants.allowed_operations default for new grants
 * (migration 20261014120100). Grants minted by the cart RPCs carry
 * this full set unless a restricted-grant flow says otherwise;
 * renewals propagate the verified list instead of re-widening it.
 */
export const CART_FULL_SESSION_OPERATIONS: readonly CartCommand['type'][] = [
  'add',
  'set_quantity',
  'remove',
  'clear',
  'replace',
  'set_assurance',
  'set_negotiated_price',
];

function issue(message: string): CartCommandIssue {
  return { code: 'invalid_item', message };
}

function isValidQuantity(quantity: number): boolean {
  return (
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= SHARED_CART_MAX_QUANTITY_PER_LINE
  );
}

function validateIdentity(item: CartItemIdentity): CartCommandIssue | null {
  if (!item.productId || item.productId.trim().length === 0) {
    return issue('A cart line requires a product.');
  }
  return null;
}

function validateAttachments(
  line: CartInputLine | Extract<CartCommand, { type: 'add' }>
): CartCommandIssue | null {
  if (
    (line.voucherToken !== undefined &&
      line.voucherToken.trim().length === 0) ||
    (line.voucherAwardId !== undefined &&
      line.voucherAwardId.trim().length === 0)
  ) {
    return issue('Voucher references must not be blank.');
  }
  if (
    line.negotiatedUnitPriceMinor !== undefined &&
    (!Number.isInteger(line.negotiatedUnitPriceMinor) ||
      line.negotiatedUnitPriceMinor < 0)
  ) {
    return issue('Negotiated prices must be non-negative minor-unit integers.');
  }
  if (
    line.negotiationStatus !== undefined &&
    line.negotiationStatus !== 'pending' &&
    line.negotiationStatus !== 'accepted' &&
    line.negotiationStatus !== 'rejected'
  ) {
    return issue('Unknown negotiation status.');
  }
  return null;
}

function validateInputLine(line: CartInputLine): CartCommandIssue | null {
  // sourceLineId is a handoff-only stored-line selector minted by
  // planCartMerge; ordinary client writes must never carry one, or
  // a caller could aim a write at another principal's stored line.
  if (line.sourceLineId != null) {
    return issue('sourceLineId is not allowed on ordinary cart writes.');
  }
  const identityIssue = validateIdentity(line.item);
  if (identityIssue) return identityIssue;
  if (!isValidQuantity(line.quantity)) {
    return issue(
      `Quantity must be an integer from 1 to ${SHARED_CART_MAX_QUANTITY_PER_LINE}.`
    );
  }
  return validateAttachments(line);
}

/**
 * Pure structural validation for cart commands.
 *
 * This checks shape and inherited quantity/line bounds only. Merchant,
 * catalog, voucher and negotiation rules are enforced by the authorized
 * cart service.
 */
export function validateCartCommand(
  command: CartCommand
): CartCommandIssue | null {
  switch (command.type) {
    case 'add': {
      const identityIssue = validateIdentity(command.item);
      if (identityIssue) return identityIssue;
      if (!isValidQuantity(command.quantity)) {
        return issue(
          `Quantity must be an integer from 1 to ${SHARED_CART_MAX_QUANTITY_PER_LINE}.`
        );
      }
      return validateAttachments(command);
    }
    case 'set_quantity': {
      if (!command.lineId || command.lineId.trim().length === 0) {
        return issue('A quantity change requires a line id.');
      }
      if (!isValidQuantity(command.quantity)) {
        return issue(
          `Quantity must be an integer from 1 to ${SHARED_CART_MAX_QUANTITY_PER_LINE}.`
        );
      }
      return null;
    }
    case 'set_assurance': {
      if (!command.lineId || command.lineId.trim().length === 0) {
        return issue('An assurance change requires a line id.');
      }
      if (typeof command.hasAssurance !== 'boolean') {
        return issue('An assurance change requires a boolean choice.');
      }
      return null;
    }
    case 'set_negotiated_price': {
      if (!command.lineId || command.lineId.trim().length === 0) {
        return issue('A negotiated price change requires a line id.');
      }
      if (
        command.negotiatedUnitPriceMinor !== null &&
        (!Number.isInteger(command.negotiatedUnitPriceMinor) ||
          command.negotiatedUnitPriceMinor < 0)
      ) {
        return issue(
          'A negotiated price must be null or a non-negative minor-unit integer.'
        );
      }
      return null;
    }
    case 'remove': {
      if (!command.lineId || command.lineId.trim().length === 0) {
        return issue('A removal requires a line id.');
      }
      return null;
    }
    case 'clear': {
      return null;
    }
    case 'replace': {
      if (command.lines.length > SHARED_CART_MAX_LINES) {
        return issue(`A cart holds at most ${SHARED_CART_MAX_LINES} lines.`);
      }
      for (const line of command.lines) {
        const lineIssue = validateInputLine(line);
        if (lineIssue) return lineIssue;
      }
      return null;
    }
  }
}
