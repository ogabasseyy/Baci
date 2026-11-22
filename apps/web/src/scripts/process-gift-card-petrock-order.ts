import { createCipheriv, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { z } from 'zod';
import {
  type GiftCardWorkerOrder,
  runGiftCardWorker,
} from '../lib/gift-cards/petrock-worker';
import { readPilotPetrockOffer } from '../lib/gift-cards/pilot-petrock-offer';
import {
  PILOT_APPROVED_KOBO,
  PILOT_PRODUCT_ID,
  PILOT_SUPPLIER_USD,
} from '../lib/gift-cards/pilot-wallet-config';
import { createPetrockClient } from '../lib/imei-providers/petrock/petrock-client';

const config = z.object({
  mode: z.enum(['submit', 'poll']),
  orderId: z.uuid(),
  databaseUrl: z.url({ protocol: /^postgres(?:ql)?$/ }),
  petrockUrl: z.url({ protocol: /^https$/, hostname: /(^|\.)petrock\.biz$/ }),
  petrockToken: z.string().min(1),
  feedbackUrl: z.url({ protocol: /^https$/ }),
  evidenceKey: z.string().regex(/^[a-fA-F0-9]{64}$/),
});

async function main() {
  const options = config.parse({
    mode: process.argv[2],
    orderId: process.argv[3],
    databaseUrl: process.env.GIFT_CARD_WORKER_DATABASE_URL,
    petrockUrl: process.env.PETROCK_API_BASE_URL,
    petrockToken: process.env.PETROCK_API_TOKEN,
    feedbackUrl: process.env.GIFT_CARD_PETROCK_FEEDBACK_URL,
    evidenceKey: process.env.GIFT_CARD_EVIDENCE_KEY_HEX,
  });
  const petrockUrl = options.petrockUrl.replace(/\/+$/, '');
  const provider = createPetrockClient({ baseUrl: petrockUrl, token: options.petrockToken });
  const sql = postgres(options.databaseUrl, {
    ssl: 'verify-full',
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
    // The URL authenticates a dedicated LOGIN member of this NOLOGIN role.
    // Set it on every connection so reconnects retain the same privileges.
    connection: { role: 'gift_card_petrock_worker' },
  });
  try {
    const result = await runGiftCardWorker(options, {
      async read(id) {
        const [row] = await sql<{
          id: string; product_id: string; amount_kobo: string; status: string; provider_order_id: string | null;
        }[]>`
          select id, product_id, amount_kobo, status, provider_order_id
          from public.read_gift_card_worker_order(${id}::uuid)
        `;
        if (!row || row.product_id !== PILOT_PRODUCT_ID || Number(row.amount_kobo) !== PILOT_APPROVED_KOBO) return null;
        return { id: row.id, productId: row.product_id, amountKobo: Number(row.amount_kobo), status: row.status, providerOrderId: row.provider_order_id ?? undefined };
      },
      async claim(order: GiftCardWorkerOrder) {
        const [row] = await sql<{ ok: boolean }[]>`
          select public.claim_gift_card_petrock_attempt(${order.id}::uuid, ${order.productId}, ${order.amountKobo}::bigint) as ok
        `;
        return row?.ok ? order : null;
      },
      async recordSubmission(id, providerOrderId) {
        const [row] = await sql<{ ok: boolean }[]>`
          select public.record_gift_card_petrock_submission(${id}::uuid, ${providerOrderId}) as ok
        `;
        if (!row?.ok) throw new Error('Submission receipt was not persisted');
      },
      async recordResult(id, providerOrderId, status, sealedReplay) {
        const [row] = await sql<{ ok: boolean }[]>`
          select public.capture_gift_card_petrock_result(${id}::uuid, ${providerOrderId}, ${status}, ${sealedReplay}) as ok
        `;
        if (!row?.ok) throw new Error('Fulfillment evidence was not persisted');
      },
      async verifySupplierPrice(order) {
        if (order.productId !== PILOT_PRODUCT_ID) return false;
        return readPilotPetrockOffer(PILOT_SUPPLIER_USD, petrockUrl, options.petrockToken);
      },
      submit: (order) => provider.submitGiftCardOrder({
        productId: order.productId,
        referenceId: order.id,
        feedbackUrl: options.feedbackUrl,
      }),
      poll: (providerId) => provider.getOrder(providerId, { requireOrderUuid: true }),
      seal(replay, orderId) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', Buffer.from(options.evidenceKey, 'hex'), iv);
        cipher.setAAD(Buffer.from(orderId, 'utf8'));
        const ciphertext = Buffer.concat([cipher.update(replay, 'utf8'), cipher.final()]);
        return ['v1', iv, cipher.getAuthTag(), ciphertext]
          .map((value) => typeof value === 'string' ? value : value.toString('base64url'))
          .join('.');
      },
    });
    console.log(JSON.stringify({ orderId: options.orderId, ...result }));
    if (result.status === 'review' || result.status === 'submission_unknown') process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // Driver exceptions can contain connection settings or SQL values. Emit
  // only a known category and a validated database error code.
  const databaseError = error instanceof Error && error.name === 'PostgresError';
  const errorCode = databaseError && 'code' in error && typeof error.code === 'string'
    && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({
    event: 'gift_card_worker_failed',
    category: error instanceof z.ZodError ? 'invalid_configuration'
      : databaseError ? 'database_failure' : 'worker_failure',
    errorCode,
    instruction: 'Check persisted order state before taking further action.',
  }));
  process.exitCode = 1;
});
