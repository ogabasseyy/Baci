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

function validateInputLine(line: CartInputLine): CartCommandIssue | null {
  return (
    validateIdentity(line.item) ??
    (isValidQuantity(line.quantity)
      ? null
      : issue(
          `Quantity must be an integer from 1 to ${SHARED_CART_MAX_QUANTITY_PER_LINE}.`
        ))
  );
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
      return null;
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
