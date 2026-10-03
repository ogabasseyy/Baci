import { logger } from './logger';
import type { PaystackResult } from './paystack';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

interface PaystackApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export async function paystackRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<PaystackResult<T>> {
  const url = `${PAYSTACK_BASE_URL}${endpoint}`;

  if (!PAYSTACK_SECRET_KEY) {
    return {
      success: false,
      error: 'PAYSTACK_SECRET_KEY is not configured',
      code: 'CONFIG_ERROR',
    };
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        ...options.headers,
      },
    });

    // Parse defensively: a non-JSON or empty error body (block
    // page, truncated 429) must not erase the HTTP status below.
    let data: PaystackApiResponse<T> | null = null;
    try {
      data = (await response.json()) as PaystackApiResponse<T>;
    } catch {
      data = null;
    }

    logger.info({
      message: 'Paystack API Response',
      endpoint,
      status: response.status,
      success: data?.status,
    });

    if (data === null && response.ok) {
      // 2xx with an unusable body: acceptance is unknown (a POST may
      // have executed), so keep the historical ambiguous
      // NETWORK_ERROR classification.
      const message = `Paystack response parsing failed: ${response.status}`;
      logger.error({ message: 'Paystack request failed', error: message });
      return { success: false, error: message, code: 'NETWORK_ERROR' };
    }

    if (!response.ok || !data?.status) {
      logger.error({
        message: 'Paystack API Error',
        status: response.status,
        error: data?.message,
      });
      return {
        success: false,
        error: data?.message || `API request failed: ${response.status}`,
        code: `HTTP_${response.status}`,
      };
    }

    return { success: true, data: data.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    logger.error({ message: 'Paystack request failed', error: message });
    return { success: false, error: message, code: 'NETWORK_ERROR' };
  }
}
