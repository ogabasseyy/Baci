import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestCustomerPolicyContextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { createCancellationRecoveryHandler } from './cancellation-recovery';
import { createPiggyvestCustomerCancelHandler } from './customer-cancel-handler';
import { createPiggyvestCustomerDraftClosureHandler } from './customer-draft-closure-handler';
import { createPiggyvestCustomerFundingHttp } from './customer-funding-http';
import { createPiggyvestCustomerFundingScreen } from './customer-funding-screen';
import { createPiggyvestCustomerLifecycleHandler } from './customer-lifecycle-handler';
import { createPiggyvestCustomerPeriodRecoveryHandler } from './customer-period-recovery-handler';
import { createPiggyvestCustomerPurchaseHandler } from './customer-purchase-handler';
import { createPiggyvestCustomerScheduleHandler } from './customer-schedule-handler';
import { createPiggyvestCustomerScreenRuntime } from './customer-screen-runtime';
import { createPiggyvestDeviceChangeHandler } from './device-change-handler';
import { createPrefundedCardCustomerHandler } from './prefunded-card-customer-handler';
import { createPiggyvestProtectedOfferHandler } from './protected-offer-handler';
import { createReconciliationCasesHandler } from './reconciliation-cases-handler';
import type {
  RuntimeCompositionCommon,
  RuntimeCompositionServices,
} from './runtime-composition.types';
import { guardRuntimeCompositionFunding } from './runtime-composition-funding';
import { createSavingsExitExecutionHandler } from './savings-exit-execution-handler';

export async function dispatchRuntimeComposition(
  request: NextRequest,
  common: RuntimeCompositionCommon,
  services: RuntimeCompositionServices = {}
) {
  const url = new URL(request.url);
  const failure = (status: number) =>
    Response.json(
      { error: 'Local savings runtime unavailable' },
      { status, headers: { 'cache-control': 'no-store' } }
    );
  const method = request.method === 'GET' ? 'GET' : 'POST';
  const funding = services.funding
    ? guardRuntimeCompositionFunding(services.funding, request.signal)
    : undefined;
  switch (url.pathname) {
    case '/card-contributions':
      return services.prefundedCard?.enabled === true
        ? createPrefundedCardCustomerHandler({
            ...common,
            card: services.prefundedCard,
          })[method](request)
        : failure(503);
    case '/policy':
      return createPiggyvestCustomerScreenRuntime(common)[method](request);
    case '/cancel':
      return createPiggyvestCustomerCancelHandler(common)[method](request);
    case '/recovery':
      return createCancellationRecoveryHandler(common).GET(request);
    case '/screen': {
      const selection = piggyvestCustomerPolicyContextSchemas.input.safeParse(
        Object.fromEntries(url.searchParams)
      );
      if (url.searchParams.size !== 1 || !selection.success)
        return failure(400);
      if (selection.data.goalId !== common.goalId) return failure(403);
      const screen = funding
        ? createPiggyvestCustomerFundingScreen({ ...common, ...funding })
        : createPiggyvestCustomerScreenRuntime(common);
      const source = await screen.readScreen(request);
      if (request.signal.aborted) return failure(503);
      return Response.json(piggyvestSavingsScreenSchema.parse(source), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    case '/funding':
      return funding
        ? createPiggyvestCustomerFundingHttp({ ...common, ...funding }).GET(
            request
          )
        : failure(503);
    case '/purchase/quote':
      return services.purchase?.enabled === true
        ? createPiggyvestCustomerPurchaseHandler(common).quote(request)
        : failure(503);
    case '/purchase/prepare':
      return services.purchase?.enabled === true
        ? createPiggyvestCustomerPurchaseHandler(common).prepare(request)
        : failure(503);
    case '/purchase/status':
      return services.purchase?.enabled === true
        ? createPiggyvestCustomerPurchaseHandler({
            ...common,
            paymentLegRecovery: services.purchase.paymentLegRecovery,
          }).status(request)
        : failure(503);
    case '/purchase/execute':
      return services.exitExecution?.enabled === true
        ? createSavingsExitExecutionHandler({
            ...common,
            action: 'purchase',
            policy: services.exitExecution.policies?.purchase,
            transferProvider: services.exitExecution.transferProvider,
          }).POST(request)
        : failure(503);
    case '/cancel/execute':
      return services.exitExecution?.enabled === true
        ? createSavingsExitExecutionHandler({
            ...common,
            action: 'cancellation',
            policy: services.exitExecution.policies?.cancellation,
            transferProvider: services.exitExecution.transferProvider,
          }).POST(request)
        : failure(503);
    case '/schedule':
      return services.schedule?.enabled === true
        ? createPiggyvestCustomerScheduleHandler(common)[method](request)
        : failure(503);
    case '/close-plan':
      return services.closure?.enabled === true
        ? createPiggyvestCustomerDraftClosureHandler(common)[method](request)
        : failure(503);
    case '/device-change/quote':
    case '/device-change/confirm':
    case '/device-change/status': {
      if (services.deviceChange?.enabled !== true) return failure(503);
      const handler = createPiggyvestDeviceChangeHandler({
        ...common,
        termsDocument: services.deviceChange.termsDocument,
      });
      if (url.pathname === '/device-change/quote')
        return handler.quote(request);
      if (url.pathname === '/device-change/confirm')
        return handler.confirm(request);
      return handler.status(request);
    }
    case '/lifecycle/terms':
      return services.lifecycle?.enabled === true
        ? createPiggyvestCustomerLifecycleHandler(common).terms(request)
        : failure(503);
    case '/protected-offer/publish':
      return services.protectedOffer?.enabled === true
        ? createPiggyvestProtectedOfferHandler(common).publish(request)
        : failure(503);
    case '/protected-offer/status':
      return services.protectedOffer?.enabled === true
        ? createPiggyvestProtectedOfferHandler(common).status(request)
        : failure(503);
    case '/reconciliation':
      return services.reconciliation?.enabled === true
        ? createReconciliationCasesHandler(common).GET(request)
        : failure(503);
    case '/period-attribution':
      return services.periodRecovery?.enabled === true
        ? createPiggyvestCustomerPeriodRecoveryHandler(common).GET(request)
        : failure(503);
    case '/lifecycle/activate':
      return services.lifecycle?.enabled === true
        ? createPiggyvestCustomerLifecycleHandler(common).activate(request)
        : failure(503);
    default:
      return failure(503);
  }
}
