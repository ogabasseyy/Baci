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

    const data: PaystackApiResponse<T> = await response.json();

    logger.info({
      message: 'Paystack API Response',
      endpoint,
      status: response.status,
      success: data.status,
    });

    if (!response.ok || !data.status) {
      logger.error({
        message: 'Paystack API Error',
        status: response.status,
        error: data.message,
      });
      return {
        success: false,
        error: data.message || `API request failed: ${response.status}`,
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
