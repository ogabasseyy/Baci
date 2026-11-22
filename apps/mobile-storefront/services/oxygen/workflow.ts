import {
  type OxygenRuntimeAction,
  type OxygenRuntimeSnapshot,
  type OxygenTransientFile,
  oxygenRuntimeActionSchema,
  pendingReadRecovery,
} from '@baci/shared/oxygen';
import { assertOxygenActionFile } from './action-file';
import { readVerifiedOxygenCapabilities } from './capability-readiness';
import type { OxygenClient } from './client';
import { dispatchOxygenAction } from './dispatch';
import { OxygenClientError } from './errors';
import type { OxygenIntentJournal } from './journal';
import { retireOxygenQueued } from './retire-queued';
import type {
  OxygenApprovalBinding,
  OxygenWorkflowState,
} from './workflow-state';

export type {
  OxygenApprovalBinding,
  OxygenWorkflowState,
} from './workflow-state';
export function createOxygenWorkflow(options: {
  client: OxygenClient;
  journal: OxygenIntentJournal;
  key: () => string;
  now?: () => number;
  environment?: OxygenRuntimeSnapshot['environment'];
  findSaved?: (orderId: string) => Promise<string | null>;
}) {
  let state: OxygenWorkflowState = {
    snapshot: null,
    busy: false,
    error: null,
    capabilities: null,
  };
  let alive = true;
  let ownedWorkflowId: string | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<OxygenWorkflowState>) => {
    if (alive) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    }
  };
  async function run(task: (generation: number) => Promise<void>) {
    if (!alive || state.busy) return;
    const generation = revision;
    publish({ busy: true, error: null });
    try {
      await task(generation);
    } catch (error) {
      if (generation === revision)
        publish({
          error:
            error instanceof OxygenClientError
              ? error
              : new OxygenClientError('transport'),
        });
    } finally {
      if (generation === revision) publish({ busy: false });
    }
  }
  const accept = (snapshot: OxygenRuntimeSnapshot, generation: number) => {
    if (
      snapshot.environment !== (options.environment ?? 'staging') ||
      (state.snapshot && state.snapshot.workflowId !== snapshot.workflowId)
    )
      throw new OxygenClientError('scope');
    if (generation === revision) publish({ snapshot });
  };
  async function read(generation: number) {
    const workflowId = ownedWorkflowId;
    if (!workflowId) throw new OxygenClientError('recovery');
    const snapshot = await options.client.snapshot(workflowId);
    accept(snapshot, generation);
    return snapshot;
  }
  async function refreshCapabilities() {
    publish({ capabilities: null });
    const capabilities = await readVerifiedOxygenCapabilities(options.client);
    publish({ capabilities });
    return capabilities;
  }
  async function initializeWorkflow(generation: number) {
    const capabilities = await refreshCapabilities();
    const orderId = options.journal.scope.orderId;
    if (!capabilities?.mobileEnabled) {
      // A disabled or unavailable initiation check cannot create a workflow.
      // A saved unpaid order without a workflow is still a new application.
      // An existing workflow stays accessible through the authenticated read.
      const savedId = await options.findSaved?.(orderId);
      if (!alive || generation !== revision) return;
      if (!savedId) throw new OxygenClientError('recovery');
      ownedWorkflowId = savedId;
      await read(generation);
      return;
    }
    // The owned order is the server's idempotent resume key after a lost response.
    const saved = await options.journal.read();
    const creationKey = saved?.key ?? options.key();
    if (!saved)
      await options.journal.write({
        scope: options.journal.scope,
        workflowId: null,
        action: 'create',
        version: 0,
        key: creationKey,
        time: (options.now ?? Date.now)(),
      });
    const created = await options.client.createOrResume(orderId);
    if (!alive || generation !== revision) return;
    ownedWorkflowId = created.id;
    if (!saved?.workflowId || saved.workflowId !== created.id)
      await options.journal.write({
        scope: options.journal.scope,
        workflowId: created.id,
        action: 'create',
        version: created.version,
        key: creationKey,
        time: (options.now ?? Date.now)(),
      });
    await read(generation);
  }
  const retireQueued = (kind: 'address' | 'phone') =>
    run(async (generation) => {
      if (!state.capabilities) throw new OxygenClientError('recovery');
      const snapshot = await read(generation);
      if (!alive || generation !== revision) return;
      await retireOxygenQueued(options.client, snapshot, kind);
      if (!alive || generation !== revision) return;
      await options.journal.clear();
      await read(generation);
    });
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: () => run(initializeWorkflow),
    refresh: () =>
      run(async (generation) => {
        if (!ownedWorkflowId) return initializeWorkflow(generation);
        await refreshCapabilities();
        await read(generation);
      }),
    pollHostedStatus: () =>
      run(async (generation) => {
        // The snapshot request still authenticates and checks the owned workflow.
        if (!state.capabilities) throw new OxygenClientError('recovery');
        await read(generation);
      }),
    execute: (
      command: OxygenRuntimeAction,
      file?: OxygenTransientFile,
      approvalBinding?: OxygenApprovalBinding
    ) =>
      run(async (generation) => {
        if (!state.capabilities) throw new OxygenClientError('recovery');
        const parsed = oxygenRuntimeActionSchema.parse(command);
        assertOxygenActionFile(parsed, file);
        const snapshot = await read(generation);
        if (!alive || generation !== revision) return;
        if (
          parsed.action === 'approve_booking' &&
          (!approvalBinding ||
            approvalBinding.version !== snapshot.version ||
            approvalBinding.bookingReference !==
              snapshot.state.bookingReference)
        )
          throw new OxygenClientError('recovery');
        if (
          !snapshot.executionEnabled ||
          snapshot.pending ||
          snapshot.stage === 'reconciliation_required' ||
          snapshot.stage === 'activated'
        )
          throw new OxygenClientError('recovery');
        if (parsed.action === 'approve_booking') {
          const { window } = await options.client.approvalWindow(
            snapshot.workflowId
          );
          if (
            !window ||
            window.bookingReference !== approvalBinding?.bookingReference ||
            Date.parse(window.expiresAt) <= (options.now ?? Date.now)()
          )
            throw new OxygenClientError('recovery');
          if (!alive || generation !== revision) return;
        }
        const saved = await options.journal.read();
        if (
          saved &&
          saved.action !== 'create' &&
          saved.version >= snapshot.version
        )
          throw new OxygenClientError('recovery');
        const key = options.key();
        await options.journal.write({
          scope: options.journal.scope,
          workflowId: snapshot.workflowId,
          action: parsed.action,
          version: snapshot.version,
          key,
          time: (options.now ?? Date.now)(),
          ...(parsed.action === 'book'
            ? {
                terms: {
                  equityPercentage: parsed.equityPercentage,
                  tenure: parsed.tenure,
                },
              }
            : {}),
        });
        if (!alive || generation !== revision) return;
        accept(
          await dispatchOxygenAction(
            options.client,
            options.journal,
            {
              workflowId: snapshot.workflowId,
              version: snapshot.version,
              idempotencyKey: key,
              command: parsed,
            },
            file,
            () => alive && generation === revision
          ),
          generation
        );
        if (alive && generation === revision) await options.journal.clear();
      }),
    recover: () =>
      run(async (generation) => {
        const snapshot = await read(generation);
        if (!alive || generation !== revision) return;
        if (!state.capabilities) throw new OxygenClientError('recovery');
        const action = pendingReadRecovery(snapshot);
        const pending = snapshot.pending;
        // File commands require an explicit new proof/retirement flow. Never replay OTP/signature.
        if (!action || !pending || action === 'submit_address')
          throw new OxygenClientError('recovery');
        const command = oxygenRuntimeActionSchema.parse(
          action === 'book' ? { action, ...pending.bookingTerms } : { action }
        );
        await options.journal.write({
          scope: options.journal.scope,
          workflowId: snapshot.workflowId,
          action: command.action,
          version: snapshot.version,
          key: pending.idempotencyKey,
          time: (options.now ?? Date.now)(),
          ...(command.action === 'book'
            ? {
                terms: {
                  equityPercentage: command.equityPercentage,
                  tenure: command.tenure,
                },
              }
            : {}),
        });
        if (!alive || generation !== revision) return;
        accept(
          await options.client.action({
            workflowId: snapshot.workflowId,
            version: snapshot.version,
            idempotencyKey: pending.idempotencyKey,
            command,
          }),
          generation
        );
        if (alive && generation === revision) await options.journal.clear();
      }),
    retireQueuedAddress: () => retireQueued('address'),
    retireQueuedPhone: () => retireQueued('phone'),
    dispose() {
      alive = false;
      revision += 1;
      listeners.clear();
    },
  };
}
export type OxygenWorkflowController = ReturnType<typeof createOxygenWorkflow>;
