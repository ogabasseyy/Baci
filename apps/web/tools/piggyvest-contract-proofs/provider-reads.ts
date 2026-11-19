import { z } from 'zod';
import {
  PiggyvestApiError,
  type PiggyvestClientConfig,
  piggyvestRequest,
} from '@/lib/piggyvest/client';
import { queryTransactionStatus } from '@/lib/piggyvest/transfers';
import { retrievePiggyvestFundingAccounts } from '@/lib/piggyvest/wallet-funding';
import { retrievePiggyvestWallet } from '@/lib/piggyvest/wallets';
import { piggyvestAccruedInterestSchemas } from '@/schemas/piggyvest-accrued-interest';
import { piggyvestTransactionListSchemas } from '@/schemas/piggyvest-transaction-list';
import type { MutationGate } from './mutation-gate';
import type { ResponseCapture } from './response-capture';
import { HarnessRefusal } from './safety-guards';

/**
 * Read side of the thin operations layer over the EXISTING typed PiggyVest client
 * (src/lib/piggyvest). Typed functions are used wherever they exist; the
 * response side-channel (ResponseCapture) supplies the HTTP status and the
 * full envelope that the strict typed schemas strip, and `typedAccepted`
 * records whether the existing schema accepted the live shape (itself a
 * contract finding for the provider-fix phase).
 */

export interface CallResult {
  ok: boolean;
  httpStatus: number | null;
  data: unknown;
  envelope: unknown;
  /** Raw provider message. Always pass through Redactor.message() before use. */
  message: string | null;
  declined: boolean;
  errorCode: string | null;
  /** Whether the existing typed schema accepted the response; null if none applies. */
  typedAccepted: boolean | null;
}

export type Query = Record<string, string>;

function envelopeParts(envelope: unknown): {
  status?: unknown;
  message?: unknown;
  data?: unknown;
} {
  return envelope !== null && typeof envelope === 'object'
    ? (envelope as Record<string, unknown>)
    : {};
}

export class ProviderReads {
  constructor(
    protected readonly config: PiggyvestClientConfig,
    protected readonly capture: ResponseCapture,
    protected readonly gate: MutationGate
  ) {}

  protected async runCall(
    run: () => Promise<unknown>,
    typed: 'client' | ((envelope: unknown) => boolean) | null = 'client'
  ): Promise<CallResult> {
    this.capture.reset();
    let error: unknown = null;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }
    const { response, refusal } = this.capture.take();
    if (refusal) throw refusal;
    if (error instanceof HarnessRefusal) throw error;
    const parts = envelopeParts(response?.envelope);
    const apiError = error instanceof PiggyvestApiError ? error : null;
    const httpStatus = response?.httpStatus ?? apiError?.status ?? null;
    const ok =
      response !== null &&
      response.httpStatus >= 200 &&
      response.httpStatus < 300 &&
      parts.status === true;
    return {
      ok,
      httpStatus,
      data: parts.data,
      envelope: response?.envelope ?? null,
      message:
        typeof parts.message === 'string'
          ? parts.message
          : (apiError?.message ?? null),
      declined:
        apiError?.declined ?? (response !== null && parts.status === false),
      errorCode: apiError?.code ?? (error ? 'UNKNOWN_ERROR' : null),
      typedAccepted:
        typed === null
          ? null
          : typed === 'client'
            ? error === null
            : ok && typed(response?.envelope),
    };
  }

  protected get(
    path: string,
    query?: Query,
    typedCheck?: (envelope: unknown) => boolean
  ) {
    return this.runCall(
      () =>
        piggyvestRequest(this.config, z.unknown(), path, {
          method: 'GET',
          query,
        }),
      typedCheck
    );
  }

  // ---- reads (GET only) ---------------------------------------------------

  customersByIdentifier(identifier: string) {
    return this.get('/api/v1/customers', {
      third_party_identifier: identifier,
      limit: '20',
    });
  }

  customerWallets(customerId: string, orderBy: 'ASC' | 'DESC' = 'DESC') {
    return this.get('/api/v1/wallet/api/wallet-type', {
      customer_id: customerId,
      limit: '100',
      orderBy,
    });
  }

  wallet(walletId: string) {
    return this.runCall(() => retrievePiggyvestWallet(this.config, walletId));
  }

  walletAccounts(walletId: string) {
    return this.runCall(() =>
      retrievePiggyvestFundingAccounts(this.config, walletId)
    );
  }

  verify(reference: string, walletId?: string) {
    return this.runCall(() =>
      queryTransactionStatus(this.config, { reference, walletId })
    );
  }

  transactions(query: Query) {
    return this.get(
      '/api/v1/transaction',
      query,
      (envelope) =>
        piggyvestTransactionListSchemas.response.safeParse(envelope).success
    );
  }

  transaction(id: string, walletId?: string) {
    return this.get(
      `/api/v1/transaction/${encodeURIComponent(id)}`,
      walletId ? { wallet_id: walletId } : undefined
    );
  }

  accrued(walletId: string, query: Query = {}) {
    return this.get(
      `/api/v1/wallet/interests/accrued/${encodeURIComponent(walletId)}`,
      query,
      (envelope) =>
        piggyvestAccruedInterestSchemas.response.safeParse(envelope).success
    );
  }
}
