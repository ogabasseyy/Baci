import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { piggyvestScheduleStoreSchemas as schemas } from '@/schemas/piggyvest-schedule-store';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { createScheduleStore } from './schedule-store';

export function createAuthenticatedScheduleStore(options: {
  supabase: SupabaseClient;
  configuration: unknown;
  goalId: string;
  execute: PiggyvestProvisioningExecutor;
}) {
  async function bound() {
    const resolve = () =>
      resolvePiggyvestCustomerPolicyContext({
        supabase: options.supabase,
        configuration: options.configuration,
        input: { goalId: options.goalId },
      });
    const initial = await resolve();
    if (initial.status !== 'ready') throw new Error('Schedule unavailable');
    async function revalidate() {
      const current = await resolve();
      if (JSON.stringify(current) !== JSON.stringify(initial))
        throw new Error('Schedule unavailable');
    }
    const store = createScheduleStore({
      configuration: { ...initial.configuration, actorId: initial.actorId },
      execute: async (statement, parameters) => {
        await revalidate();
        return options.execute(statement, parameters);
      },
    });
    return { store, revalidate };
  }
  return {
    async read(operationId: string | null = null) {
      try {
        const context = await bound();
        const result = await context.store.read(operationId);
        await context.revalidate();
        return result;
      } catch {
        throw new Error('Schedule unavailable');
      }
    },
    async submit(input: unknown) {
      try {
        const context = await bound();
        const request = schemas.request.parse(input);
        const receipt = await context.store.submit(request);
        await context.revalidate();
        return { status: 'persisted_proposal' as const, receipt };
      } catch {
        return {
          status: 'unconfirmed' as const,
          readbackRequired: true as const,
          debitPermission: false as const,
        };
      }
    },
  };
}
