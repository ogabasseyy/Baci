import type {
  CartBridgeResult,
  ExperienceErrorCode,
  PublicCartCommand,
  SharedCartCommandPort,
} from '@baci/shared/experience';
import { experienceCartCommandSchema } from '@/schemas/experience-cart-command';
import {
  engineCommand,
  publicCartSnapshot,
  publicCommand,
  sharedCartIntent,
} from './shared-cart-command-mapping';
import type {
  SharedCartCommandRuntime,
  SharedCartExperienceEntry,
} from './shared-cart-experience-types';
import {
  createSharedCartReceiptStore,
  hashCartOperation,
  type SharedCartOperationReceipt,
} from './shared-cart-operation-receipts';

const denied = (code: ExperienceErrorCode): CartBridgeResult => ({
  status: 'error',
  code,
  message: 'Use the trusted storefront to continue.',
});

export type { SharedCartCommandRuntime, SharedCartExperienceEntry };
export { publicCartSnapshot };

/** Adds observers to the existing single send queue; owns no transport/provisioner. */
export function createSharedCartCommandPort(
  runtime: SharedCartCommandRuntime
): SharedCartCommandPort {
  const receipts = runtime.receiptStorage
    ? createSharedCartReceiptStore(runtime.receiptStorage)
    : null;
  function retainCapacity() {
    if (runtime.entries.size < 64) return;
    for (const [id, entry] of runtime.entries) {
      if (entry.isSettled()) runtime.entries.delete(id);
      if (runtime.entries.size < 64) break;
    }
  }
  async function submit(
    input: PublicCartCommand,
    id: string,
    replay?: SharedCartOperationReceipt
  ): Promise<CartBridgeResult> {
    if (!runtime.enabled()) return denied('CART_ENROLLMENT_REQUIRED');
    const parsed = experienceCartCommandSchema.safeParse(input);
    if (!parsed.success || !id.trim() || id.length > 128)
      return denied('INVALID_REQUEST');
    const command = parsed.data;
    const signature = JSON.stringify(command);
    const existing = runtime.entries.get(id);
    if (existing && !replay)
      return existing.signature === signature
        ? existing.promise
        : denied('IDEMPOTENCY_CONFLICT');
    if (!runtime.entries.has(id)) retainCapacity();
    if (runtime.entries.size >= 64 && !runtime.entries.has(id))
      return denied('QUOTA_EXCEEDED');
    const generation = runtime.generation();
    const admission = () =>
      runtime.generation() === generation
        ? runtime.admit()
        : { allowed: false as const, code: 'CONNECTION_REVOKED' as const };
    const gate = admission();
    if (!gate.allowed) return denied(gate.code);
    const product =
      command.kind === 'add'
        ? await runtime.resolveProduct(command.productId)
        : null;
    if (runtime.refreshAdmission && !(await runtime.refreshAdmission()))
      return denied('CONNECTION_REVOKED');
    const after = admission();
    if (!after.allowed) return denied(after.code);
    if (command.kind === 'add' && !product) return denied('NOT_FOUND');
    // Another port may have prepared this same operation during the product read.
    const prepared = runtime.entries.get(id);
    if (prepared && (!replay || !prepared.isSettled()))
      return prepared.signature === signature
        ? prepared.promise
        : denied('IDEMPOTENCY_CONFLICT');
    if (!runtime.entries.has(id)) retainCapacity();
    if (runtime.entries.size >= 64 && !runtime.entries.has(id))
      return denied('QUOTA_EXCEEDED');
    const intent = sharedCartIntent(command, product, id);
    let settle: (r: CartBridgeResult) => void = () => {
      /* Assigned by the synchronous Promise constructor below. */
    };
    const promise = new Promise<CartBridgeResult>((r) => {
      settle = r;
    });
    let receipt: SharedCartOperationReceipt | undefined = replay;
    const priorWire =
      replay?.state === 'wire-attempted' || replay?.state === 'indeterminate';
    let wire = priorWire;
    let settled = false;
    const save = (state: SharedCartOperationReceipt['state']) => {
      if (receipt) {
        receipt = { ...receipt, state };
        try {
          receipts?.put(receipt);
        } catch {
          // Keep the existing envelope; persistence must not prevent settlement.
        }
      }
    };
    const complete = (result: CartBridgeResult) => {
      settled = true;
      settle(result);
    };
    const entry: SharedCartExperienceEntry = {
      signature,
      generation,
      promise,
      isSettled: () => settled,
      envelope: replay
        ? {
            operationId: id,
            command: replay.command,
            expectedVersion: replay.expectedVersion,
          }
        : undefined,
      async prepare(snapshot) {
        const gate = admission();
        if (!gate.allowed) {
          complete(
            priorWire
              ? { status: 'indeterminate', operationId: id }
              : denied(gate.code)
          );
          return false;
        }
        const partition = await runtime.loadContinuity();
        if (partition && runtime.rebind && !runtime.rebind(partition)) {
          complete({ status: 'indeterminate', operationId: id });
          return false;
        }
        if (runtime.refreshAdmission && !(await runtime.refreshAdmission())) {
          entry.deny();
          return false;
        }
        const current = admission();
        if (!partition || !current.allowed) {
          complete(
            partition && !current.allowed && !priorWire
              ? denied(current.code)
              : { status: 'indeterminate', operationId: id }
          );
          return false;
        }
        if (receipt && receipt.partition !== partition) {
          complete({ status: 'indeterminate', operationId: id });
          return false;
        }
        if (!receipt && receipts?.get(partition, id)) {
          complete(denied('IDEMPOTENCY_CONFLICT'));
          return false;
        }
        entry.envelope ??= {
          operationId: id,
          command: engineCommand(command),
          expectedVersion: snapshot.version,
        };
        const commandHash = await hashCartOperation({
          ...entry.envelope,
          partition,
        });
        if (receipt && receipt.commandHash !== commandHash) {
          complete({ status: 'indeterminate', operationId: id });
          return false;
        }
        receipt ??= {
          ...entry.envelope,
          partition,
          commandHash,
          state: 'prepared',
        };
        entry.partition = partition;
        save(priorWire ? 'indeterminate' : 'prepared');
        return true;
      },
      policy: {
        beforeAttempt: admission,
        onAttemptStart() {
          wire = true;
          save('wire-attempted');
        },
      },
      canProject: () =>
        runtime.generation() === generation &&
        (runtime.sameShopper?.() ?? true),
      finish(result, expose = true) {
        if (result.ok) save('confirmed');
        if (settled) return;
        if (result.ok) {
          complete(
            expose && entry.canProject()
              ? { status: 'ok', value: publicCartSnapshot(result.snapshot) }
              : { status: 'indeterminate', operationId: id }
          );
          return;
        }
        if ('admissionDenied' in result) {
          const unknown =
            priorWire ||
            (result.attempted && result.priorOutcome !== 'csrf-rejected');
          save(unknown ? 'indeterminate' : 'cancelled-unsent');
          complete(
            unknown
              ? { status: 'indeterminate', operationId: id }
              : denied(result.denialCode as ExperienceErrorCode)
          );
          return;
        }
        if (result.code === 'version_conflict') {
          save('cancelled-unsent');
          complete({
            status: 'conflict',
            currentVersion:
              result.snapshot?.version ?? runtime.read()?.version ?? 0,
          });
          return;
        }
        if (wire && result.retryable) {
          save('indeterminate');
          complete({ status: 'indeterminate', operationId: id });
          return;
        }
        save('cancelled-unsent');
        complete(
          denied(
            result.code === 'idempotency_conflict'
              ? 'IDEMPOTENCY_CONFLICT'
              : 'INVALID_REQUEST'
          )
        );
      },
      deny() {
        if (settled) return;
        save(wire ? 'indeterminate' : 'cancelled-unsent');
        complete(
          wire
            ? { status: 'indeterminate', operationId: id }
            : denied('CONNECTION_REVOKED')
        );
      },
    };
    runtime.entries.set(id, entry);
    runtime.enqueue(id, intent);
    return promise;
  }
  return {
    submit,
    reconcile: async (id) => {
      const active = runtime.entries.get(id);
      if (active && !active.isSettled()) return active.promise;
      const gate = runtime.admit();
      if (!gate.allowed) return denied(gate.code);
      const partition = await runtime.loadContinuity();
      if (!partition) return { status: 'indeterminate', operationId: id };
      if (active?.partition === partition) {
        const result = await active.promise;
        if (runtime.refreshAdmission && !(await runtime.refreshAdmission()))
          return denied('CONNECTION_REVOKED');
        const current = runtime.admit();
        if (!current.allowed) return denied(current.code);
        if (
          active.generation !== runtime.generation() ||
          (runtime.rebind && !runtime.rebind(partition)) ||
          !(runtime.sameShopper?.() ?? true)
        )
          return { status: 'indeterminate', operationId: id };
        if (result.status !== 'indeterminate') return result;
      }
      const receipt = receipts?.get(partition, id);
      if (!receipt) return { status: 'indeterminate', operationId: id };
      if (receipt.state === 'confirmed') {
        const state = runtime.read();
        return state
          ? { status: 'ok', value: publicCartSnapshot(state) }
          : { status: 'indeterminate', operationId: id };
      }
      if (
        receipt.state !== 'wire-attempted' &&
        receipt.state !== 'indeterminate'
      )
        return { status: 'indeterminate', operationId: id };
      const command = publicCommand(receipt.command);
      return command ? submit(command, id, receipt) : denied('INVALID_REQUEST');
    },
  };
}
