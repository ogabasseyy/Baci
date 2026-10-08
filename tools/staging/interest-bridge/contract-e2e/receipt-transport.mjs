import { createHmac } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { resolve } from 'node:path';
import { CONTRACT_E2E } from './constants.mjs';

const RPCS = {
  accept_signed_piggyvest_staging_receipt: {
    role: 'pvb_staging_ingest',
    parameters: [
      'p_payload_sha256',
      'p_ciphertext',
      'p_nonce',
      'p_auth_tag',
      'p_key_version',
      'p_original_signature',
    ],
    types: ['text', 'text', 'text', 'text', 'text', 'text'],
  },
  claim_piggyvest_staging_receipts: {
    role: 'pvb_staging_worker',
    table: true,
    parameters: ['p_limit', 'p_lease_seconds'],
    types: ['integer', 'integer'],
  },
  read_piggyvest_staging_receipt_signature: {
    role: 'pvb_staging_worker',
    parameters: ['p_receipt_id', 'p_payload_sha256', 'p_claim_token'],
    types: ['uuid', 'text', 'uuid'],
  },
  resolve_piggyvest_staging_receipt: {
    role: 'pvb_staging_worker',
    parameters: ['p_receipt_id', 'p_claim_token', 'p_status', 'p_last_error'],
    types: ['uuid', 'uuid', 'text', 'text'],
  },
  quarantine_piggyvest_staging_receipt: {
    role: 'pvb_staging_worker',
    parameters: [
      'p_receipt_id',
      'p_claim_token',
      'p_event_id',
      'p_reason',
      'p_detail',
    ],
    types: ['uuid', 'uuid', 'text', 'text', 'jsonb'],
  },
};

export function createReceiptTransport(database, loader) {
  const receiver = (name) =>
    loader.load(
      resolve(
        CONTRACT_E2E.receiverRoot,
        'apps/web/tools/piggyvest-staging',
        name
      )
    );
  let refuseResolution = false;
  const store = {
    async call(name, parameters) {
      const rpc = Object.hasOwn(RPCS, name) ? RPCS[name] : null;
      if (
        !rpc ||
        Object.keys(parameters).length !== rpc.parameters.length ||
        !rpc.parameters.every((key) => Object.hasOwn(parameters, key))
      )
        throw new Error('Non-contract receipt RPC refused');
      if (name === 'resolve_piggyvest_staging_receipt' && refuseResolution) {
        refuseResolution = false;
        throw new Error('Synthetic acknowledgement loss');
      }
      const placeholders = rpc.types
        .map((type, index) => `$${index + 1}::${type}`)
        .join(',');
      const statement = rpc.table
        ? `SELECT * FROM public.${name}(${placeholders})`
        : `SELECT public.${name}(${placeholders}) AS result`;
      const { rows } = await database.execute(
        statement,
        rpc.parameters.map((key) => parameters[key]),
        'supabase_admin',
        rpc.role
      );
      return rpc.table ? rows : rows[0].result;
    },
  };
  const persist = receiver('intake-persist.ts').createIntakePersistence(
    'synthetic-local-rest-token-not-provider-material',
    async (url, options) => {
      if (
        url !==
          'http://pvb-staging-receipts-rest:3000/rpc/accept_signed_piggyvest_staging_receipt' ||
        options.method !== 'POST'
      )
        throw new Error('Network transport refused');
      const receipt = await store.call(
        'accept_signed_piggyvest_staging_receipt',
        JSON.parse(options.body)
      );
      return new Response(JSON.stringify(receipt), { status: 200 });
    }
  );
  const handler = receiver('intake-handler.ts').createIntakeHandler({
    integrationToken: CONTRACT_E2E.integrationToken,
    providerSecret: CONTRACT_E2E.signingSecret,
    encryptionKey: CONTRACT_E2E.encryptionKey,
    persist,
  });

  return {
    store,
    loseNextResolution() {
      refuseResolution = true;
    },
    async submit(raw, signature) {
      const request = new IncomingMessage(new Socket());
      request.url = '/piggyvest/intake';
      request.method = 'POST';
      request.headers.authorization = `Bearer ${CONTRACT_E2E.integrationToken}`;
      request.headers['x-pvb-signature'] =
        signature ??
        createHmac('sha512', CONTRACT_E2E.signingSecret)
          .update(raw)
          .digest('hex');
      const response = new ServerResponse(request);
      let body;
      response.end = (value) => {
        body = JSON.parse(String(value));
        return response;
      };
      request.push(raw);
      request.push(null);
      await handler(request, response);
      request.destroy();
      return { status: response.statusCode, body };
    },
  };
}
