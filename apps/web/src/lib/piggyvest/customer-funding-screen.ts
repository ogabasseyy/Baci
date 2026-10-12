import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { resolvePiggyvestCustomerFundingCapability } from './customer-funding-capability';
import { readPiggyvestCustomerFundingView } from './customer-funding-view';
import { createPiggyvestCustomerScreenRuntime } from './customer-screen-runtime';

type ScreenOptions = Parameters<typeof createPiggyvestCustomerScreenRuntime>[0];
type FundingOptions = Parameters<typeof readPiggyvestCustomerFundingView>[0];
type Capability = NonNullable<
  Awaited<ReturnType<typeof resolvePiggyvestCustomerFundingCapability>>
>;
type Screen = Extract<
  Awaited<
    ReturnType<
      ReturnType<typeof createPiggyvestCustomerScreenRuntime>['readScreen']
    >
  >,
  { status: 'ready' }
>;

function matches(capability: Capability, screen: Screen) {
  const { policy } = capability;
  return (
    capability.identity.goalId === screen.goalId &&
    policy.revisionId === screen.policy.revisionId &&
    policy.command.termsVersion === screen.policy.terms.version &&
    policy.command.termsHash === screen.policy.terms.hash &&
    policy.durationMonths === screen.policy.durationMonths &&
    policy.device.name === screen.policy.device.productName &&
    policy.device.condition === screen.policy.device.condition &&
    policy.device.variantLabel === screen.policy.device.variant
  );
}

export function createPiggyvestCustomerFundingScreen(
  options: ScreenOptions & {
    fundingConfiguration: unknown;
    fundingExecute: Parameters<
      typeof resolvePiggyvestCustomerFundingCapability
    >[0]['execute'];
    mappingExecute: FundingOptions['execute'];
    fetchImplementation: typeof fetch;
  }
) {
  const runtime = createPiggyvestCustomerScreenRuntime(options);
  function capability() {
    return resolvePiggyvestCustomerFundingCapability({
      supabase: options.supabase,
      goalId: options.goalId,
      configuration: options.configuration,
      fundingConfiguration: options.fundingConfiguration,
      execute: options.fundingExecute,
    });
  }
  return {
    GET: runtime.GET,
    POST: runtime.POST,
    async readScreen(request: NextRequest) {
      const screen = await runtime.readScreen(request);
      if (
        screen.status !== 'ready' ||
        screen.policy.consent !== 'accepted' ||
        request.signal.aborted
      )
        return screen;
      try {
        const before = await capability();
        if (!before || !matches(before, screen) || request.signal.aborted)
          return screen;
        const funding = await readPiggyvestCustomerFundingView({
          configuration: options.fundingConfiguration,
          resolveAuthenticatedGoal: async () => before.identity,
          execute: options.mappingExecute,
          fetchImplementation: options.fetchImplementation,
        });
        if (funding.status === 'unavailable' || request.signal.aborted)
          return screen;
        const after = await capability();
        if (
          !after ||
          !matches(after, screen) ||
          JSON.stringify(before) !== JSON.stringify(after) ||
          request.signal.aborted
        )
          return screen;
        if (funding.status === 'pending')
          return piggyvestSavingsScreenSchema.parse({
            ...screen,
            funding,
            eligibility: { status: 'pending' },
            progress: { status: 'unavailable' },
          });
        return piggyvestSavingsScreenSchema.parse({
          ...screen,
          funding,
          eligibility: {
            status: 'allowed',
            sessionKey: screen.sessionKey,
            goalId: screen.goalId,
            revisionId: screen.policy.revisionId,
            termsVersion: screen.policy.terms.version,
            termsHash: screen.policy.terms.hash,
          },
          progress: { status: 'unavailable' },
        });
      } catch {
        return screen;
      }
    },
  };
}
