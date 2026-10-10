import { resolve } from 'node:path';
import { readAppProjection } from './app-projection.mjs';
import { bootstrapContractDatabase } from './bootstrap.mjs';
import { CONTRACT_E2E } from './constants.mjs';
import { createDisposablePostgres } from './postgres.mjs';
import { createReceiptTransport } from './receipt-transport.mjs';
import { createSourceLoader } from './source-loader.mjs';

export function createContractHarness() {
  const loader = createSourceLoader([
    CONTRACT_E2E.canonicalRoot,
    CONTRACT_E2E.receiverRoot,
  ]);
  const raw = loader.track(
    resolve(
      CONTRACT_E2E.canonicalRoot,
      'apps/web/src/schemas/piggyvest/interest-payout-success.fixture.json'
    )
  );
  const payout = JSON.parse(raw.toString('utf8'));
  const database = createDisposablePostgres();
  try {
    const scope = bootstrapContractDatabase(database, loader, payout);
    const transport = createReceiptTransport(database, loader);
    const receiver = (name) =>
      loader.load(
        resolve(
          CONTRACT_E2E.receiverRoot,
          'apps/web/tools/piggyvest-staging',
          name
        )
      );
    const outcomes = [];
    const replayInterest = receiver(
      'replay-interest-runtime.ts'
    ).createInterestReplay(scope, async (statement, parameters) => {
      const response = await database.execute(
        statement,
        parameters,
        'prefunded_treasury_operator'
      );
      outcomes.push(response.rows[0].result);
      return response;
    });
    const replayAccrual = receiver(
      'replay-accrual-runtime.ts'
    ).createAccrualReplay(
      scope,
      CONTRACT_E2E.signingSecret,
      (statement, parameters) =>
        database.execute(
          statement,
          parameters,
          'piggyvest_staging_ledger_worker'
        )
    );
    const adapters = receiver('replay-store.ts').createDurableReplayAdapters({
      store: transport.store,
      app: {
        rpc: () => {
          throw new Error('Legacy inflow unavailable');
        },
      },
      allowLegacyInflow: false,
      keyResolver: () => Promise.resolve(CONTRACT_E2E.encryptionKey),
      leaseSeconds: 300,
      accrualReplay: replayAccrual,
      dispatchFinancial: ({ event }) => replayInterest(event),
    });
    const worker = receiver('replay-worker.ts').createReplayWorker(adapters, {
      environment: 'staging',
      batchSize: 10,
      keyResolver: () => Promise.resolve(CONTRACT_E2E.encryptionKey),
    });
    const fractional = JSON.stringify({
      eventId: 'synthetic-accrual-event',
      eventType: 'interest-accrued.success',
      eventCategory: 'interest_accrued',
      customer_id: payout.customer_id,
      pvb_wallet: payout.pvb_wallet,
      pvb_wallet_name: 'Synthetic fixture wallet',
      pvb_split_interest_with_wallet: null,
      pvb_split_interest_with_wallet_name: null,
      eventData: {
        id: 'synthetic-accrual-id',
        wallet_id: '70000000-0000-4000-8000-000000000001',
        interest_date: '2026-10-01T00:00:00.000Z',
        interest_type: 'original',
        amount: 0,
        balance: 10000,
        percentage: 9,
      },
    }).replace('"amount":0', `"amount":${CONTRACT_E2E.fractionalKobo}`);
    return {
      database,
      transport,
      worker,
      outcomes,
      replayInterest,
      payout,
      raw,
      fractional: Buffer.from(fractional),
      readProjection: () => readAppProjection(database, loader),
      manifest: () => loader.manifest(),
      snapshot() {
        return JSON.parse(
          database.sql(`SELECT json_build_object(
          'principalKobo', (SELECT coalesce(sum(amount_kobo),0) FROM piggyvest_savings_ledger.postings WHERE account='principal'),
          'paidInterestKobo', (SELECT coalesce(sum(amount_kobo),0) FROM piggyvest_savings_ledger.postings WHERE account='paid_interest'),
          'interestReceipts', (SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts),
          'payoutEconomics', (SELECT jsonb_build_object('gross',economics->'grossKobo','tax',economics->'taxKobo','net',economics->'netKobo') FROM piggyvest_savings_ledger.interest_receipts),
          'allocations', (SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations),
          'notifications', (SELECT count(*) FROM savings_notifications.events WHERE type='interest_credited'),
          'deliveries', (SELECT count(*) FROM savings_notifications.deliveries),
          'sealedReceipts', (SELECT count(*) FROM public.piggyvest_staging_receipts),
          'quarantines', (SELECT count(*) FROM public.piggyvest_staging_replay_quarantine)
        )`)
        );
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
