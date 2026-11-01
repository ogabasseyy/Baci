import 'server-only';

import {
  petrockAccountResponseSchema,
  petrockOrderResponseSchema,
  petrockProductsResponseSchema,
  petrockSubmitOrderResponseSchema,
} from './petrock.schemas';
import type {
  PetrockClientFailure,
  PetrockClientResult,
  PetrockOrderStatus,
  PetrockOrderSubmission,
} from './petrock.types';

interface CreatePetrockClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  token: string;
}

interface PetrockSubmittedOrder {
  orderUuid: string;
  referenceId?: string;
}

interface PetrockOrder {
  orderUuid: string;
  referenceId?: string;
  replay: string;
  status: PetrockOrderStatus;
}

interface PetrockAccount {
  balance: number;
  currency: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function requestFailure(error: unknown): PetrockClientFailure {
  const isTimeout =
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError');
  return {
    kind: isTimeout ? 'timeout' : 'network',
    message: isTimeout ? 'Petrock request timed out' : 'Petrock request failed',
    ok: false,
  };
}

export function createPetrockClient({
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  token,
}: CreatePetrockClientOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  async function request(
    path: string,
    init: RequestInit = {}
  ): Promise<PetrockClientResult<unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        ...init,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return requestFailure(error);
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (error) {
      return requestFailure(error);
    }
    if (!response.ok) {
      return {
        kind: 'http',
        message: `Petrock returned HTTP ${response.status}`,
        ok: false,
        status: response.status,
      };
    }

    try {
      return { data: JSON.parse(rawText) as unknown, ok: true, rawText };
    } catch {
      return {
        kind: 'invalid_response',
        message: 'Petrock returned invalid JSON',
        ok: false,
        status: response.status,
      };
    }
  }

  return {
    async getAccount(): Promise<PetrockClientResult<PetrockAccount>> {
      const result = await request('/account');
      if (!result.ok) return result;
      const parsed = petrockAccountResponseSchema.safeParse(result.data);
      if (!parsed.success) {
        return {
          kind: 'invalid_response',
          message: 'Petrock account response did not match the expected schema',
          ok: false,
        };
      }
      return { data: parsed.data.data, ok: true, rawText: result.rawText };
    },

    async getOrder(
      orderUuid: string
    ): Promise<PetrockClientResult<PetrockOrder>> {
      const result = await request(
        `/order?order_uuid=${encodeURIComponent(orderUuid)}`
      );
      if (!result.ok) return result;

      const parsed = petrockOrderResponseSchema.safeParse(result.data);
      if (
        !parsed.success ||
        (parsed.data.data.order_uuid !== undefined &&
          parsed.data.data.order_uuid !== orderUuid)
      ) {
        return {
          kind: 'invalid_response',
          message: 'Petrock order response did not match the expected schema',
          ok: false,
        };
      }

      return {
        data: {
          orderUuid: parsed.data.data.order_uuid ?? orderUuid,
          referenceId: parsed.data.data.reference_id,
          replay: parsed.data.data.replay,
          status: parsed.data.data.status,
        },
        ok: true,
        rawText: result.rawText,
      };
    },

    async getProducts(): Promise<
      PetrockClientResult<
        ReturnType<typeof petrockProductsResponseSchema.parse>
      >
    > {
      const result = await request('/products');
      if (!result.ok) return result;
      const parsed = petrockProductsResponseSchema.safeParse(result.data);
      if (!parsed.success) {
        return {
          kind: 'invalid_response',
          message:
            'Petrock products response did not match the expected schema',
          ok: false,
        };
      }
      return { data: parsed.data, ok: true, rawText: result.rawText };
    },

    async submitOrder(
      submission: PetrockOrderSubmission
    ): Promise<PetrockClientResult<PetrockSubmittedOrder>> {
      const result = await request('/order', {
        body: JSON.stringify([
          {
            fields: [
              {
                [submission.orderFieldName]: submission.identifier,
                feedback_url: submission.feedbackUrl,
                reference_id: submission.referenceId,
                Quantity: 1,
              },
            ],
            ...(/^\d+$/.test(submission.productId)
              ? { product_id: Number(submission.productId) }
              : { product_uuid: submission.productId }),
          },
        ]),
        method: 'POST',
      });
      if (!result.ok) return result;

      const parsed = petrockSubmitOrderResponseSchema.safeParse(result.data);
      const order = parsed.success ? parsed.data.data[0]?.[0] : undefined;
      if (
        !order ||
        (order.reference_id !== undefined &&
          order.reference_id !== submission.referenceId)
      ) {
        return {
          kind: 'invalid_response',
          message: 'Petrock submit response did not include an order UUID',
          ok: false,
        };
      }

      return {
        data: {
          orderUuid: order.order_uuid,
          referenceId: order.reference_id,
        },
        ok: true,
        rawText: result.rawText,
      };
    },
  };
}
