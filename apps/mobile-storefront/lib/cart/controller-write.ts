import type {
  CartItemIdentity,
  CartMergeResolution,
  CartSnapshot,
} from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import type { createCartCommandCoordinator } from './command-coordinator';
import { planNativeLegacyMerge } from './legacy-merge';
import { NativeCartError } from './shared-cart-client';
import { nativeWriteCommand } from './write-command';

export interface NativeCartWriteDeps {
  accept(next: CartSnapshot): Promise<void>;
  coordinator: ReturnType<typeof createCartCommandCoordinator>;
  ensureCart(): Promise<CartSnapshot>;
  getIncoming(): CartSnapshot | null;
  setIncoming(next: CartSnapshot | null): void;
  getLegacy(): { items: CartItem[] };
  newOperationId(): string;
  onMergeConflicts?(items: CartItemIdentity[], reason?: string): void;
  refresh(): Promise<void>;
  status(status: 'pending' | 'ready'): void;
}

/** Command-issuing controller operations: shopper writes and legacy choice. */
export function createNativeCartWrite(deps: NativeCartWriteDeps) {
  async function write(action: SharedCartWrite): Promise<void> {
    if (action.type === 'legacy_restore' || action.type === 'legacy_generation')
      return;
    if (action.type === 'legacy_reprice') {
      await deps.refresh();
      return;
    }
    const current = await deps.ensureCart();
    deps.status('pending');
    const command = nativeWriteCommand(action, current);
    if (!command) {
      deps.status('ready');
      return;
    }
    if (action.type === 'clear') {
      try {
        await deps.accept(
          await deps.coordinator.command(current.cartId, {
            operationId: deps.newOperationId(),
            expectedVersion: current.version,
            command,
          })
        );
      } catch (error) {
        // A bound order already completed this cart server-side, so
        // clearing it is rejected as locked. Retire the finished
        // generation locally instead of failing the checkout that
        // just succeeded; the next write starts a fresh session.
        if (error instanceof NativeCartError && error.code === 'cart_locked') {
          await deps.refresh();
          return;
        }
        throw error;
      }
      return;
    }
    await deps.accept(
      await deps.coordinator.command(current.cartId, {
        operationId: deps.newOperationId(),
        expectedVersion: current.version,
        command,
      })
    );
  }

  async function chooseLegacy(
    choice: 'keep_server' | 'merge',
    resolutions: CartMergeResolution[] = []
  ): Promise<void> {
    const incoming = deps.getIncoming();
    if (!incoming) throw new NativeCartError('refresh_required');
    if (choice === 'keep_server') {
      deps.setIncoming(null);
      await deps.accept(incoming);
      deps.onMergeConflicts?.([], undefined);
      return;
    }
    const plan = planNativeLegacyMerge(
      incoming,
      deps.getLegacy().items,
      resolutions
    );
    if (!plan.ok) {
      if (plan.code === 'merge_conflict')
        deps.onMergeConflicts?.(
          plan.conflicts.map((conflict) => conflict.item),
          plan.reason
        );
      throw new NativeCartError(plan.code);
    }
    const lines = plan.lines;
    const result = await deps.coordinator.command(incoming.cartId, {
      operationId: deps.newOperationId(),
      expectedVersion: incoming.version,
      command: { type: 'replace', lines },
    });
    deps.setIncoming(null);
    await deps.accept(result);
    deps.onMergeConflicts?.([], undefined);
  }

  return { chooseLegacy, write };
}
