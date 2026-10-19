/**
 * Persistence-failure error for VTU fulfillment.
 *
 * Leaf module split out of vtu-fulfillment.ts per the Boy Scout Rule:
 * the concurrent-failed-refund branch moved here-adjacent and both it
 * and fulfillment throw this — a shared leaf avoids an import cycle.
 */

export class VtuPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, VtuPersistenceError.prototype);
    this.name = 'VtuPersistenceError';
  }
}

export function throwVtuPersistenceError(message: string): never {
  throw new VtuPersistenceError(message);
}
