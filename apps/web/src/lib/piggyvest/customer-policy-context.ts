import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { piggyvestCustomerPolicyContextSchemas as schemas } from '@/schemas/piggyvest-customer-policy-context';
import { resolvePiggyvestCustomerScope } from './customer-policy-scope';

type Result =
  | { status: 'unavailable' }
  | {
      status: 'ready';
      actorId: string;
      configuration: {
        environment: 'staging';
        integrationId: string;
        expectedBusinessId: string;
        merchantId: string;
        customerId: string;
        goalId: string;
      };
    };

export async function resolvePiggyvestCustomerPolicyContext({
  configuration,
  input,
  supabase,
}: {
  configuration: unknown;
  input: unknown;
  supabase: SupabaseClient;
}): Promise<Result> {
  try {
    const auth = await supabase.auth.getUser();
    const actor = schemas.actor.safeParse(auth.data?.user);
    if (auth.error || !actor.success) return { status: 'unavailable' };
    const parsedConfig = schemas.configuration.safeParse(configuration);
    const parsedInput = schemas.input.safeParse(input);
    if (!parsedConfig.success || !parsedInput.success)
      return { status: 'unavailable' };
    return resolvePiggyvestCustomerScope({
      configuration: parsedConfig.data,
      actorId: actor.data.id,
      goalId: parsedInput.data.goalId,
      supabase,
    });
  } catch {
    return { status: 'unavailable' };
  }
}
