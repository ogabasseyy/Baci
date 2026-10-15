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
// The coordinator function is stable for one owner/controller lifetime. Retain
// a rejected attempt only while its exact two-cart review remains unchanged.
const conflictAttempts = new WeakMap<
  Deps['redeem'],
  { key: string; id: string }
>();
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
  const attemptKey = JSON.stringify([
    link.handoffId,
    choice,
    context.cartId,
    preview.snapshot.version,
    deps.getSnapshot()?.version,
  ]);
  const previous = conflictAttempts.get(deps.redeem);
  const attemptId =
    previous?.key === attemptKey ? previous.id : deps.newOperationId();
  let result: CartSnapshot | null;
  try {
    result = await deps.redeem({
      ...(mergeLines ? { lines: mergeLines, resolutions } : {}),
      token: link.token,
      handoffId: link.handoffId,
      attemptId,
      choice,
      expectedIncomingVersion: preview.snapshot.version,
      ...(context.cartId
        ? {
            destCartId: context.cartId,
            expectedDestVersion: deps.getSnapshot()?.version,
          }
        : {}),
    });
  } catch (error) {
    deps.assertCurrent();
    if (
      error instanceof NativeCartError &&
      error.code === 'merge_conflict' &&
      error.conflicts?.length
    ) {
      conflictAttempts.set(deps.redeem, { key: attemptKey, id: attemptId });
      deps.onMergeConflicts?.(error.conflicts.map((conflict) => conflict.item));
    } else conflictAttempts.delete(deps.redeem);
    throw error;
  }
  conflictAttempts.delete(deps.redeem);
  // A null snapshot means keep_existing committed without a
  // destination cart: nothing to adopt, the session continues on the
  // bootstrap proof the client persisted during redeem.
  if (result) await deps.accept(result);
  deps.onMergeConflicts?.([], undefined);
  deps.onHandoffCommitted?.(link.handoffId);
}
