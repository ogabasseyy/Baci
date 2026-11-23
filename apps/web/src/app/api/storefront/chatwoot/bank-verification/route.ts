import { createHmac } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { authenticateApiRequest } from '@/lib/api-auth';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  challengePrivateKeyPem,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
import { checkCsrfProtection } from '@/lib/csrf';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOrRefreshSupportedBanks } from '@/lib/payments/oxygen/supported-bank-read-or-refresh';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';
import { chatwootBankVerificationRequestSchema } from '@/schemas/chatwoot-bank-verification';
import {
  oxygenBankProviderListSchema,
  oxygenProviderAccountNameSchema,
} from '@/schemas/oxygen-bank-details';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
const VERIFICATION_TTL_MS = 15 * 60_000;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

function maskAccountNumber(accountNumber: string) {
  return `••••••${accountNumber.slice(-4)}`;
}

function signVerificationReference(input: {
  conversationId: number;
  userId: string;
  bankCode: string;
  maskedAccountNumber: string;
  accountName: string;
  expiresAt: number;
}) {
  return createHmac('sha256', challengePrivateKeyPem(process.env))
    .update(
      JSON.stringify([
        'ekaette-bank-verification-v1',
        input.conversationId,
        input.userId,
        input.bankCode,
        input.maskedAccountNumber,
        input.accountName,
        input.expiresAt,
      ])
    )
    .digest('hex');
}

/**
 * Authenticated, session-bound conversational bank lookup for Ekaette checkout.
 * Reuses Oxygen bank list and name_enquiry; returns only masked account number
 * and a signed verification reference so raw account numbers are never stored.
 */
export async function POST(request: NextRequest) {
  if (
    !isOxygenStorefrontStagingEnabled() ||
    process.env.EKAETTE_CHATWOOT_CHECKOUT_ENABLED !== 'true'
  ) {
    return fail(404, 'Bank verification unavailable');
  }
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return csrf.response ?? fail(403, 'Invalid request');

  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user) return fail(401, 'Unauthorized');

  const limit = await checkOxygenProviderRateLimit(
    auth.user.id,
    'chatwoot-bank-verification',
    15
  );
  if (!limit.allowed) return fail(429, 'Too many requests');

  const rawBody = await readCartJsonBody(request);
  const parsed = chatwootBankVerificationRequestSchema.safeParse(
    rawBody.ok ? rawBody.body : null
  );
  if (!parsed.success) return fail(400, 'Invalid bank verification request');

  const cartContext = await loadChatwootCartContext(request);
  if (!cartContext.ok)
    return fail(cartContext.status, 'Chat session unavailable');

  try {
    const capability = await verifyChatwootSessionCapability({
      binding: cartContext.binding,
      state: cartContext.state,
      sessionToken: parsed.data.sessionToken,
    });
    if (capability.conversationId !== parsed.data.conversationId) {
      return fail(403, 'Chat session mismatch');
    }
  } catch {
    return fail(403, 'Chat session unavailable');
  }

  try {
    if (parsed.data.action === 'banks') {
      const config = readOxygenRuntimeConfiguration();
      const cache = getRedis();
      if (config && cache) {
        const cached = await readOrRefreshSupportedBanks(
          cache,
          config.environment,
          config.reference,
          () => {
            const connection = connectOxygenRuntime();
            return connection?.provider.environment === config.environment
              ? connection.provider
              : null;
          }
        );
        if (cached) {
          return NextResponse.json({ banks: cached }, { headers: HEADERS });
        }
      }
      const connection = connectOxygenRuntime();
      if (!connection) return fail(503, 'Bank list unavailable');
      const result = oxygenBankProviderListSchema.parse(
        await connection.provider.call('banks', {})
      );
      return NextResponse.json(
        {
          banks: result.Result.map((bank) => ({
            name: bank.Name,
            code: bank.SortCode,
          })),
        },
        { headers: HEADERS }
      );
    }

    const phone = parsed.data.phone.replace(/\D/g, '').replace(/^0/, '234');
    if (!/^234\d{10}$/.test(phone)) {
      return fail(400, 'Valid Nigerian phone number required');
    }

    const connection = connectOxygenRuntime();
    if (!connection) return fail(503, 'Bank verification unavailable');
    const result = oxygenProviderAccountNameSchema.parse(
      await connection.provider.call('name_enquiry', {
        bank_code: parsed.data.bankCode,
        account_number: parsed.data.accountNumber,
        phone_number: phone,
        type: 'EXTERNAL',
      })
    );
    const maskedAccountNumber = maskAccountNumber(parsed.data.accountNumber);
    const expiresAt = Date.now() + VERIFICATION_TTL_MS;
    const verificationReference = signVerificationReference({
      conversationId: parsed.data.conversationId,
      userId: auth.user.id,
      bankCode: parsed.data.bankCode,
      maskedAccountNumber,
      accountName: result.accountName,
      expiresAt,
    });

    return NextResponse.json(
      {
        accountName: result.accountName,
        maskedAccountNumber,
        verificationReference,
        expiresAt,
      },
      { headers: HEADERS }
    );
  } catch {
    return fail(
      503,
      'Unable to verify bank details. Check the bank and account number.'
    );
  }
}
