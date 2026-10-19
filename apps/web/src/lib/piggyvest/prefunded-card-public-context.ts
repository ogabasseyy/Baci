import 'server-only';
import { piggyvestCustomerPolicyContextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { prefundedCardPublicRuntimeSchemas } from '@/schemas/prefunded-card-public-runtime';
import type { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { resolvePiggyvestCustomerScope } from './customer-policy-scope';

export const resolvePrefundedCardPublicContext: typeof resolvePiggyvestCustomerPolicyContext =
  async ({ configuration, input, supabase }) => {
    try {
      const auth = await supabase.auth.getUser();
      const actor = piggyvestCustomerPolicyContextSchemas.actor.safeParse(
        auth.data?.user
      );
      if (auth.error || !actor.success) return { status: 'unavailable' };
      const config =
        prefundedCardPublicRuntimeSchemas.context.safeParse(configuration);
      const selection =
        piggyvestCustomerPolicyContextSchemas.input.safeParse(input);
      if (!config.success || !selection.success)
        return { status: 'unavailable' };
      return resolvePiggyvestCustomerScope({
        configuration: config.data,
        actorId: actor.data.id,
        goalId: selection.data.goalId,
        supabase,
      });
    } catch {
      return { status: 'unavailable' };
    }
  };
