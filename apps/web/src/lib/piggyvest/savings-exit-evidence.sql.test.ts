import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSavingsExitEvidence } from './savings-exit-evidence';
import { createSavingsExitEvidenceStore } from './savings-exit-evidence-store';

const socketDirectory = process.env.SAVINGS_EXIT_SQL_SOCKET;
describe.skipIf(!socketDirectory)(
  'private SQL authenticated exit evidence adapter',
  () => {
    it.each([
      212, 213,
    ])('commits independently looked-up evidence for goal %s through the restricted login', async (goalNumber) => {
      const configuration = {
        integrationId: '40000000-0000-4000-8000-000000000001',
        expectedBusinessId: 'synthetic-business',
        webhookSecret: 'synthetic-exit-signature',
        apiSecret: 'synthetic-exit-api',
      };
      const reference = `30000000-0000-4000-8000-${String(4000 + goalNumber).padStart(12, '0')}`;
      const event = {
        eventId: `independent-event-${goalNumber}`,
        customer_id: `customer-${goalNumber}`,
        eventType: 'wallet-transfer.outflow.success',
        pvb_reference: `independent-transaction-${goalNumber}`,
        pvb_wallet: `goal-${goalNumber}-wallet`,
      };
      const amount = goalNumber === 212 ? 99150 : 100;
      const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
        const address = String(url);
        const data = address.includes('/wallet/')
          ? {
              id: address.split('/').at(-1),
              business_id: 'synthetic-business',
              currency: 'NGN',
              status: 'active',
            }
          : address.includes('/verify?')
            ? { reference, amount, status: 'success' }
            : {
                id: event.pvb_reference,
                customer_id: event.customer_id,
                source_wallet: event.pvb_wallet,
                destination_wallet:
                  goalNumber === 212 ? 'merchant-wallet' : 'customer-wallet',
                reference,
                category: 'wallet_transfer',
                status: 'successful',
                amount,
                fee: 0,
              };
        return new Response(JSON.stringify({ status: true, data }));
      });
      const execute = createSavingsExitEvidenceStore({
        integrationId: configuration.integrationId,
        socketDirectory,
        port: 55454,
        password: 'synthetic-local-only',
      });
      const adapter = createSavingsExitEvidence({
        configuration,
        execute,
        fetchImplementation,
      });
      const rawPayload = Buffer.from(JSON.stringify(event));
      const signature = createHmac('sha512', configuration.webhookSecret)
        .update(rawPayload)
        .digest('hex');
      expect(await adapter.ingest({ rawPayload, signature })).toEqual({
        state: 'stored',
      });
      expect(await adapter.ingest({ rawPayload, signature })).toEqual({
        state: 'stored',
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(8);
    });
  }
);
