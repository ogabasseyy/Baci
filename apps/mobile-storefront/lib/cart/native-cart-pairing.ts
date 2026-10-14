import {
  type CartInputLine,
  type CartItemIdentity,
  type CartMergeResolution,
  type CartSnapshot,
  planCartMerge,
} from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import type { createCartCommandCoordinator } from './command-coordinator';
import type { CartPairingLink } from './pairing-link';
import { type NativeCartClient, NativeCartError } from './shared-cart-client';

interface Deps {
  merchantId: string;
  client: Pick<NativeCartClient, 'context' | 'bootstrap'> &
    Partial<Pick<NativeCartClient, 'redeem' | 'previewHandoff'>>;
  readPending(): Promise<unknown>;
  getSnapshot(): CartSnapshot | null;
  getItems(): CartItem[];
  ensureCart(): Promise<CartSnapshot>;
  refresh(): Promise<void>;
  accept(snapshot: CartSnapshot): Promise<void>;
  assertCurrent(): void;
  pending(): void;
  newOperationId(): string;
  redeem: ReturnType<typeof createCartCommandCoordinator>['redeem'];
  onMergeConflicts?(items: CartItemIdentity[], reason?: string): void;
  onHandoffCommitted?(handoffId: string): void;
}
export async function pairNativeCart(
  deps: Deps,
  link: CartPairingLink,
  choice: 'connect' | 'merge' | 'keep_existing',
  resolutions: CartMergeResolution[] = []
): Promise<void> {
  if (
    link.destination !== 'native' ||
    link.merchantId !== deps.merchantId ||
    !deps.client.previewHandoff ||
    !deps.client.redeem
  )
    throw new NativeCartError('invalid_request');
  if (await deps.readPending()) throw new NativeCartError('pending_operation');
  const preview = await deps.client.previewHandoff(link.handoffId, link.token);
  deps.assertCurrent();
  if (choice !== 'connect') await deps.ensureCart();
  let context = await deps.client.context();
  deps.assertCurrent();
  if (!context) {
    await deps.client.bootstrap();
    context = await deps.client.context();
    deps.assertCurrent();
  }
  if (!context) throw new NativeCartError('missing_proof');
  if (context.cartId && !deps.getSnapshot()) await deps.refresh();
  if (
    choice === 'connect' &&
    (deps.getSnapshot()?.lines.length || deps.getItems().length)
  )
    throw new NativeCartError('merge_choice_required');
  let mergeLines: CartInputLine[] | undefined;
  if (choice === 'merge') {
    const current = deps.getSnapshot();
    if (!current) throw new NativeCartError('refresh_required');
    const plan = planCartMerge(current, preview.snapshot, resolutions);
    if (!plan.ok) {
      if (plan.code === 'merge_conflict')
        deps.onMergeConflicts?.(
          plan.conflicts.map((conflict) => conflict.item),
          plan.reason
        );
      throw new NativeCartError(plan.code);
    }
    mergeLines = plan.lines;
  }
  deps.pending();
  const result = await deps.redeem({
    ...(mergeLines ? { lines: mergeLines, resolutions } : {}),
    token: link.token,
    handoffId: link.handoffId,
    attemptId: deps.newOperationId(),
    choice,
    expectedIncomingVersion: preview.snapshot.version,
    ...(context.cartId
      ? {
          destCartId: context.cartId,
          expectedDestVersion: deps.getSnapshot()?.version,
        }
      : {}),
  });
  await deps.accept(result);
  deps.onMergeConflicts?.([], undefined);
  deps.onHandoffCommitted?.(link.handoffId);
}
