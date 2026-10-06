import {
  createPiggyvestPurchaseClient,
  createPiggyvestPurchaseController,
} from '@baci/shared/lib';
import { expect, it, vi } from 'vitest';
import { purchaseJourneyFixture } from './purchase-journey-runtime.fixture';
import { query } from './purchase-pricing-runtime.fixture';

vi.mock('server-only', () => ({}));
it.skipIf(process.env.PIGGYVEST_RUN_PURCHASE_JOURNEY !== '1')(
  'connects the shared client and controller to authenticated HTTP and actual restricted SQL',
  async () => {
    const fixture = await purchaseJourneyFixture();
    try {
      const client = createPiggyvestPurchaseClient({
        configuration: {
          mode: 'local_test',
          baseUrl: fixture.runtime.origin,
          endpointPath: '/purchase',
        },
        goalId: fixture.selection.goalId,
        fetch: fixture.transport,
        getCsrfToken: fixture.getCsrfToken,
        isCurrent: () => true,
      });
      const binding = createPiggyvestPurchaseController({
        source: fixture.source,
        tenantKey: 'synthetic',
        operationId: fixture.operationId,
        client,
        isCurrent: () => true,
      });
      await binding.quote(fixture.selection);
      const view = binding.read(fixture.source);
      if (view?.status !== 'review') throw new Error('Expected actual quote');
      expect(view.quote.quote).toMatchObject({
        deviceKobo: 98000,
        deliveryKobo: 1500,
        taxKobo: 7350,
        feeKobo: 50,
        totalKobo: 106900,
        savingsKobo: 97000,
      });
      const receipt = await binding.prepare(view.command);
      expect(receipt.fulfilment).toBe('disabled');
      await expect(binding.prepare(view.command)).rejects.toThrow();
      await binding.recover();
      expect(binding.read(fixture.source)).toMatchObject({
        status: 'prepared',
        recovery: {
          current: {
            status: 'observed',
            reservation: 'retained',
            fundsUse: 'not_authorized',
          },
        },
      });
      expect(
        (
          await query(
            'harness_admin',
            'SELECT count(*)::int AS count FROM piggyvest_purchase_preparation.intents WHERE goal_id=$1',
            [fixture.selection.goalId]
          )
        ).rows[0].count
      ).toBe(1);
    } finally {
      await fixture.runtime.close();
    }
  }
);

it.skipIf(process.env.PIGGYVEST_PURCHASE_BROWSER_HOLD !== '1')(
  'holds an isolated actual purchase runtime for explicit local browser acceptance',
  async () => {
    const fixture = await purchaseJourneyFixture();
    const modulePath = `${process.cwd()}/../../tools/test/runtime-journey-browser/server.mjs`;
    const { startRuntimeJourneyBrowser } = await import(
      /* @vite-ignore */ modulePath
    );
    let browser: { close: () => Promise<void> } | undefined;
    try {
      browser = await startRuntimeJourneyBrowser({
        port: 4184,
        backends: [
          {
            pathPrefix: '/scenario/243',
            backendOrigin: fixture.runtime.origin,
            syntheticSessionCookie: 'synthetic-session=owner',
            freshPreparation: {
              goalId: fixture.selection.goalId,
              operationId: fixture.operationId,
            },
          },
        ],
        configuration: {
          mode: 'local_test',
          scenarios: [
            {
              goalId: fixture.selection.goalId,
              operationId: fixture.operationId,
              pathPrefix: '/scenario/243',
              label: 'Synthetic exact pickup purchase',
              purchaseSelection: fixture.selection,
            },
          ],
        },
      });
      process.stdout.write(
        'PURCHASE_BROWSER_READY http://127.0.0.1:4184 goal243; bounded ten-minute disposable fixture\n'
      );
      await new Promise((resolve) => setTimeout(resolve, 600000));
    } finally {
      await browser?.close();
      await fixture.runtime.close();
    }
  },
  650000
);
