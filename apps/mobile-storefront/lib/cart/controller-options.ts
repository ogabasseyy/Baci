import type { CartItemIdentity, CartSnapshot } from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import type { CartProductShell } from './display';
import type { pendingCartRequest } from './pending-request';
import type { NativeCartClient } from './shared-cart-client';

export interface NativeSharedCartRef {
  merchantId: string;
  cartId: string;
}
export type NativeCartStatus =
  | 'loading'
  | 'pending'
  | 'ready'
  | 'error'
  | 'choice_required';
export interface NativeCartControllerOptions {
  merchantId: string;
  getOwnerSubject?(): string | null;
  client: Pick<
    NativeCartClient,
    'context' | 'bootstrap' | 'read' | 'create' | 'command' | 'recoverCreation'
  > &
    Partial<
      Pick<
        NativeCartClient,
        | 'redeem'
        | 'recoverHandoff'
        | 'previewHandoff'
        | 'restartSession'
        | 'recoverAccountLink'
        | 'linkAccount'
        | 'savedAccountCart'
        | 'prepareCheckout'
      >
    >;
  receipts?: typeof pendingCartRequest;
  newOperationId(): string;
  getLegacy(): { items: CartItem[]; sharedCartRef?: NativeSharedCartRef };
  loadProduct(
    merchantId: string,
    productId: string
  ): Promise<CartProductShell | null>;
  publish(
    snapshot: CartSnapshot,
    display: { items: CartItem[]; metadataReady: boolean }
  ): void;
  status(status: NativeCartStatus, code?: string): void;
  isCurrent(): boolean;
  onHandoffCommitted?(handoffId: string): void;
  onMergeConflicts?(items: CartItemIdentity[], reason?: string): void;
}
