import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { customerFundingCapabilitySchema } from '@/schemas/customer-funding-capability';
import { piggyvestCustomerFundingViewSchemas } from '@/schemas/piggyvest-customer-funding-view';
import { piggyvestCustomerPolicyContextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { CUSTOMER_FUNDING_CAPABILITY_STATEMENTS } from './customer-funding-capability-statements';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';

export async function resolvePiggyvestCustomerFundingCapability(options: {
  supabase: SupabaseClient;
  goalId: string;
  configuration: unknown;
  fundingConfiguration: unknown;
  execute: (
    statement: string,
    parameters: readonly string[]
  ) => Promise<{ rows: unknown }>;
}) {
  try {
    const context = await resolvePiggyvestCustomerPolicyContext({
      supabase: options.supabase,
      configuration: options.configuration,
      input: { goalId: options.goalId },
    });
    if (context.status !== 'ready') return null;
    const config = piggyvestCustomerPolicyContextSchemas.configuration.parse(
      options.configuration
    );
    const funding = piggyvestCustomerFundingViewSchemas.configuration.parse(
      options.fundingConfiguration
    );
    const scope = context.configuration;
    if (
      funding.integrationId !== scope.integrationId ||
      funding.expectedMerchantId !== scope.merchantId ||
      funding.expectedBusinessId !== scope.expectedBusinessId ||
      funding.actualProjectId !== config.actualProjectId ||
      !funding.allowlistedCustomerIds.includes(scope.customerId)
    )
      return null;
    const response = await options.execute(
      CUSTOMER_FUNDING_CAPABILITY_STATEMENTS.readFundingCapability.text,
      [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        scope.expectedBusinessId,
        context.actorId,
      ]
    );
    const result = customerFundingCapabilitySchema.parse(response.rows)[0]
      .result;
    if (!result) return null;
    const { identity, policy, ledgerSnapshot } = result;
    if (
      identity.integrationId !== scope.integrationId ||
      identity.merchantId !== scope.merchantId ||
      identity.customerId !== scope.customerId ||
      identity.goalId !== scope.goalId ||
      policy.actorId !== context.actorId ||
      !policy.acceptedAt ||
      !policy.durationMonths ||
      ledgerSnapshot.activeReservation ||
      ledgerSnapshot.fundingReversed ||
      ledgerSnapshot.ledger.reservedPrincipalKobo !== 0 ||
      ledgerSnapshot.ledger.reservedPaidInterestKobo !== 0
    )
      return null;
    return { identity, policy, actorId: context.actorId };
  } catch {
    return null;
  }
}
