import 'server-only';
import { piggyvestScheduleStoreSchemas as schemas } from '@/schemas/piggyvest-schedule-store';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { planPiggyvestScheduleLifecycle } from './schedule-lifecycle';
import { SCHEDULE_STORE_STATEMENTS as statements } from './schedule-store-statements';

export function createScheduleStore(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const config = schemas.configuration.parse(options.configuration);
  const { integrationId, merchantId, customerId, goalId, actorId } = config;
  const scope = { integrationId, merchantId, customerId, goalId };
  const parameters = [
    integrationId,
    merchantId,
    customerId,
    goalId,
    config.expectedBusinessId,
    actorId,
  ];
  function verifyScope(candidate: typeof scope) {
    if (
      Object.entries(scope).some(
        ([key, value]) => candidate[key as keyof typeof scope] !== value
      )
    )
      throw new Error('Scope mismatch');
  }
  async function read(operationId: string | null = null) {
    try {
      const parsedOperation =
        operationId === null
          ? null
          : schemas.receipt.shape.operationId.parse(operationId);
      const response = await options.execute(
        statements.readScheduleProposal.text,
        [...parameters, parsedOperation]
      );
      const result = schemas.readRows.parse(response.rows)[0].result;
      verifyScope(result.trusted.scope);
      verifyScope(result.state.scope);
      if (result.trusted.actorId !== actorId) throw new Error('Actor mismatch');
      if (result.historical) {
        verifyScope(result.historical.receipt.state.scope);
        if (
          result.historical.receipt.operationId !== parsedOperation ||
          result.historical.command.goalId !== goalId
        )
          throw new Error('Receipt mismatch');
      }
      return result;
    } catch {
      throw new Error('Schedule storage unavailable');
    }
  }
  return {
    read,
    async submit(input: unknown) {
      try {
        const request = schemas.request.parse(input);
        if (request.command.goalId !== goalId) throw new Error('Goal mismatch');
        const current = await read(request.operationId);
        if (current.historical) {
          if (
            JSON.stringify(current.historical.command) !==
            JSON.stringify(request.command)
          )
            throw new Error('Replay conflict');
          return current.historical.receipt;
        }
        const planned = planPiggyvestScheduleLifecycle({
          trusted: current.trusted,
          state: current.state,
          command: request.command,
        });
        const proposal = {
          ...planned.stateProposal,
          version: current.state.version + 1,
        };
        const response = await options.execute(
          statements.writeScheduleProposal.text,
          [
            ...parameters,
            JSON.stringify({ ...request, token: current.token, proposal }),
          ]
        );
        const receipt = schemas.writeRows.parse(response.rows)[0].result;
        verifyScope(receipt.state.scope);
        if (
          receipt.operationId !== request.operationId ||
          JSON.stringify(receipt.state) !==
            JSON.stringify(schemas.receipt.shape.state.parse(proposal))
        )
          throw new Error('Receipt mismatch');
        return receipt;
      } catch {
        throw new Error('Schedule storage unavailable');
      }
    },
  };
}
