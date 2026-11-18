export interface CryptoPaymentData {
  address: string;
  chain: string;
  currency: string;
  amount: number;
  confirmation_time: string;
  orderId: string;
  reference: string;
  paymentId: string;
  qrcode?: string;
  trackingToken?: string | null;
}

export type CryptoStatus =
  | 'loading'
  | 'ready'
  | 'verifying'
  | 'confirmed'
  | 'failed'
  | 'error';

interface CryptoInitRequest {
  merchantId?: string;
  orderId: string;
  amount: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  cryptoChain: string;
  cryptoCurrency: string;
  trackingToken: string | null;
}

interface CryptoInitHandlers {
  setStatus: (status: CryptoStatus) => void;
  setErrorMessage: (message: string | null) => void;
  setCryptoData: (data: CryptoPaymentData | null) => void;
}

// Module-scope helper: throw-inside-try and the loading-state bookkeeping live
// here so the component body stays compilable by React Compiler.
export async function initializeCryptoPayment(
  request: CryptoInitRequest,
  {
    setStatus: setStatusNow,
    setErrorMessage: setErrorMessageNow,
    setCryptoData: setCryptoDataNow,
  }: CryptoInitHandlers,
  // False once a newer request (another order or a retry) replaced this one.
  isCurrent: () => boolean = () => true
) {
  const setStatus = (status: CryptoStatus) => {
    if (isCurrent()) setStatusNow(status);
  };
  const setErrorMessage = (message: string | null) => {
    if (isCurrent()) setErrorMessageNow(message);
  };
  const setCryptoData = (data: CryptoPaymentData | null) => {
    if (isCurrent()) setCryptoDataNow(data);
  };
  try {
    setStatus('loading');
    setErrorMessage(null);

    const res = await fetch('/api/payments/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: request.merchantId,
        order_id: request.orderId,
        currency: 'NGN',
        customer_email: request.customerEmail,
        customer_name: request.customerName,
        customer_phone: request.customerPhone,
        gateway: 'juicyway',
        crypto_chain: request.cryptoChain,
        crypto_currency: request.cryptoCurrency,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(
        errorData.details || errorData.error || 'Payment initialization failed'
      );
    }

    const result = await res.json();

    if (result.success && result.crypto_payment?.payment_id) {
      setCryptoData({
        address: result.crypto_payment.address,
        chain: result.crypto_payment.chain,
        currency: result.crypto_payment.currency,
        amount: result.crypto_payment.amount / 100,
        confirmation_time: result.crypto_payment.confirmation_time,
        orderId: request.orderId,
        reference: result.reference,
        paymentId: result.crypto_payment.payment_id,
        qrcode: result.crypto_payment.qrcode,
        trackingToken: request.trackingToken,
      });
      setStatus('ready');
    } else {
      throw new Error('Failed to generate crypto payment address');
    }
  } catch (error) {
    console.error('Crypto payment init error:', error);
    setStatus('error');
    setErrorMessage(
      error instanceof Error ? error.message : 'Failed to initialize crypto payment'
    );
  }
}
