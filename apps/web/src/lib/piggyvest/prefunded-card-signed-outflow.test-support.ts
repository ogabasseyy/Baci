import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import { createPrefundedCardReceiptReplay } from './prefunded-card-receipt-replay';
import { prefundedCardSignedOutflowFixture as fixture } from './prefunded-card-signed-outflow.test-fixture';

export function setupSignedOutflowReplay() {
  const sample = structuredClone(fixture);
  const observations: Record<string, unknown>[] = [];
  const ingestionExecute = vi.fn(
    (statement: string, parameters: readonly unknown[]) =>
      Promise.resolve().then(() => {
        if (statement.includes('evidence_scope'))
          return {
            rows: [
              {
                result: {
                  businessId: sample.configuration.piggyvest.expectedBusinessId,
                  currency: 'NGN',
                },
              },
            ],
          };
        if (statement.includes('evidence_destination_mapping'))
          return {
            rows: [
              {
                result: {
                  providerWalletId: sample.envelope.pvb_destination_wallet,
                  providerCustomerId: sample.envelope.customer_id,
                },
              },
            ],
          };
        if (statement.includes('record_provider_evidence')) {
          const observation: Record<string, unknown> = JSON.parse(
            String(parameters[2])
          );
          observations.push(observation);
          if (
            observation.status === 'verified' &&
            observation.eventCategory !== 'wallet-transfer'
          )
            return { rows: [{ result: 'deferred' }] };
          return { rows: [{ result: 'stored' }] };
        }
        throw new Error('Unexpected test SQL');
      })
  );
  const fetchImplementation = vi.fn<typeof fetch>((url) =>
    Promise.resolve().then(() => {
      const address = String(url);
      if (address.includes('/transaction/verify?'))
        return Response.json(sample.transaction);
      if (address.includes('/wallet/api/wallet-type?'))
        return Response.json(sample.walletList);
      if (address.endsWith(`/wallet/${sample.envelope.pvb_wallet}`))
        return Response.json(sample.sourceWallet);
      if (address.endsWith(`/wallet/${sample.envelope.pvb_destination_wallet}`))
        return Response.json(sample.destinationWallet);
      throw new Error('Unexpected test provider GET');
    })
  );
  const ledgerExecute = vi.fn();
  const replay = createPrefundedCardReceiptReplay({
    configuration: sample.configuration,
    ingestionExecute,
    ledgerExecute,
    fetchImplementation,
  });
  const receipt = () => {
    const rawPayload = new TextEncoder().encode(
      JSON.stringify(sample.envelope)
    );
    const signature = createHmac('sha512', sample.configuration.webhookSecret)
      .update(rawPayload)
      .digest('hex');
    return { rawPayload, signature };
  };
  return {
    sample,
    observations,
    ingestionExecute,
    fetchImplementation,
    ledgerExecute,
    replay,
    receipt,
  };
}
