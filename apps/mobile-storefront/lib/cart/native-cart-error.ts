import type { NativeCartMergeConflicts } from '@/schemas/cart';
export class NativeCartError extends Error {
  constructor(
    readonly code: string,
    readonly indeterminate = false,
    readonly conflicts?: NativeCartMergeConflicts
  ) {
    super('Cart request unavailable');
    this.name = 'NativeCartError';
  }
}
