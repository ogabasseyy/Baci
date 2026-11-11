'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivateSearchParams } from '@/hooks/use-private-search-params';
import {
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
  Clock,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useMerchant } from '@/hooks/use-merchant-client';

const CHAIN_LABELS: Record<string, string> = {
  TRX: 'Tron (TRC-20)',
  ETH: 'Ethereum (ERC-20)',
  MATIC: 'Polygon',
  AVAXC: 'Avalanche C-Chain',
};

interface CryptoPaymentData {
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

type CryptoStatus =
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
async function initializeCryptoPayment(
  request: CryptoInitRequest,
  { setStatus, setErrorMessage, setCryptoData }: CryptoInitHandlers,
) {
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

    if (result.success && result.crypto_payment) {
      setCryptoData({
        address: result.crypto_payment.address,
        chain: result.crypto_payment.chain,
        currency: result.crypto_payment.currency,
        amount: result.crypto_payment.amount / 100,
        confirmation_time: result.crypto_payment.confirmation_time,
        orderId: request.orderId,
        reference: result.reference,
        paymentId: result.crypto_payment.payment_id || '',
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

export function CryptoCheckoutPage() {
  const router = useRouter();
  const searchParams = usePrivateSearchParams();
  const { merchant, loading } = useMerchant();

  const orderId = searchParams.get('orderId');
  const amount = searchParams.get('amount');
  const customerEmail = searchParams.get('customer_email') || '';
  const customerName = searchParams.get('customer_name') || '';
  const customerPhone = searchParams.get('customer_phone') || '';
  const cryptoChain = searchParams.get('crypto_chain') || 'TRX';
  const cryptoCurrency = searchParams.get('crypto_currency') || 'USDT';
  const merchantSlugParam = searchParams.get('merchant_slug');
  const trackingToken =
    searchParams.get('trackingToken') ||
    searchParams.get('tracking_token') ||
    searchParams.get('token');

  const [status, setStatus] = useState<CryptoStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cryptoData, setCryptoData] = useState<CryptoPaymentData | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const pollingRef = useRef<{
    intervalId: ReturnType<typeof setInterval> | null;
    attempts: number;
  }>({ intervalId: null, attempts: 0 });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  // Initialize payment on mount; the missing-params error is derived during
  // render instead of being set synchronously from this effect.
  useEffect(() => {
    if (loading) return;
    if (!orderId || !amount) return;

    initializeCryptoPayment(
      {
        merchantId: merchant?.id,
        orderId,
        amount,
        customerEmail,
        customerName,
        customerPhone,
        cryptoChain,
        cryptoCurrency,
        trackingToken,
      },
      { setStatus, setErrorMessage, setCryptoData }
    );
  }, [
    orderId,
    amount,
    customerEmail,
    customerName,
    customerPhone,
    cryptoChain,
    cryptoCurrency,
    merchant?.id,
    merchant?.slug,
    merchantSlugParam,
    trackingToken,
    loading,
  ]);

  const verifyCryptoPayment = async () => {
    const verificationId = cryptoData?.paymentId;
    if (!verificationId) {
      setStatus('failed');
      return;
    }

    setStatus('verifying');
    pollingRef.current.attempts = 0;

    const checkStatus = async (): Promise<'confirmed' | 'failed' | 'pending'> => {
      try {
        const response = await fetch(
          `/api/payments/status?gateway=juicyway&payment_id=${verificationId}`
        );
        if (!response.ok) return 'pending';
        const data = await response.json();
        if (data.status === 'confirmed' || data.status === 'captured') {
          return 'confirmed';
        }
        if (data.status === 'failed' || data.status === 'expired') {
          return 'failed';
        }
        return 'pending';
      } catch {
        return 'pending';
      }
    };

    const redirectToSuccess = () => {
      const slug = merchantSlugParam || merchant?.slug || 'ogabassey';
      const successQuery = new URLSearchParams({
        type: 'crypto',
        orderId: cryptoData?.orderId || '',
        reference: cryptoData?.reference || '',
      });
      if (cryptoData?.trackingToken) {
        successQuery.set('trackingToken', cryptoData.trackingToken);
      }
      router.push(`/${slug}/order-success?${successQuery.toString()}`);
    };

    // Poll every 10 seconds, max 30 attempts (5 minutes)
    const MAX_POLL = 30;
    pollingRef.current.intervalId = setInterval(async () => {
      pollingRef.current.attempts++;
      const result = await checkStatus();

      if (result === 'confirmed') {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
        }
        setStatus('confirmed');
        // Post message for mobile WebView to detect
        window.parent?.postMessage(
          JSON.stringify({ type: 'crypto_success', orderId: cryptoData?.orderId }),
          window.location.origin
        );
        // Redirect after short delay
        setTimeout(() => {
          redirectToSuccess();
        }, 1500);
      } else if (
        result === 'failed' ||
        pollingRef.current.attempts >= MAX_POLL
      ) {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
        }
        setStatus(result === 'failed' ? 'failed' : 'ready');
      }
    }, 10000);

    // Also check immediately
    const immediateResult = await checkStatus();
    if (immediateResult === 'confirmed') {
      if (pollingRef.current.intervalId) {
        clearInterval(pollingRef.current.intervalId);
      }
      setStatus('confirmed');
      window.parent?.postMessage(
        JSON.stringify({ type: 'crypto_success', orderId: cryptoData?.orderId }),
        window.location.origin
      );
      setTimeout(() => {
        redirectToSuccess();
      }, 1500);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current.intervalId) {
        clearInterval(pollingRef.current.intervalId);
      }
    };
  }, []);

  const missingOrderParams = !loading && (!orderId || !amount);

  if (status === 'error' || missingOrderParams) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="size-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="size-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Payment Initialization Failed
          </h2>
          <p className="text-gray-600 mb-6">
            {missingOrderParams ? 'Missing order ID or amount.' : errorMessage}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading' || !cryptoData) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <div className="relative size-20 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-gray-100 rounded-full" />
            <div className="absolute inset-0 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin" />
            <ShieldCheck className="absolute inset-0 m-auto text-emerald-500 size-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Preparing Crypto Payment
          </h1>
          <p className="text-gray-500">
            Generating wallet address…
          </p>
          <p className="text-xs text-gray-400 mt-8">
            Please do not close this window.
          </p>
        </div>
      </div>
    );
  }

  const chainLabel = CHAIN_LABELS[cryptoData.chain] || cryptoData.chain;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-linear-to-r from-emerald-600 to-emerald-500 p-4 flex items-center gap-2">
          <div className="size-8 bg-white/20 rounded-lg flex items-center justify-center">
            <ShieldCheck size={16} className="text-white" />
          </div>
          <h2 className="font-bold text-white">Pay with Crypto</h2>
        </div>

        <div className="p-5 space-y-4">
          {/* QR & Amount */}
          <div className="flex gap-4 items-center">
            <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-200">
              <img
                src={
                  cryptoData.qrcode ||
                  `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${cryptoData.address}&margin=10`
                }
                alt="Scan to pay"
                className="size-24"
                loading="lazy"
              />
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Send Exactly
                </p>
                <p className="text-2xl font-black text-gray-900 leading-tight">
                  {cryptoData.amount.toLocaleString()}{' '}
                  <span className="text-emerald-600">{cryptoData.currency}</span>
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 border border-gray-200">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                <p className="text-xs font-semibold text-gray-700">
                  Network: {chainLabel}
                </p>
              </div>
            </div>
          </div>

          {/* Wallet Address */}
          <div className="space-y-1.5">
            <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
              Recipient Address
            </span>
            <div className="relative group">
              <div className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-3 pr-12 font-mono text-xs text-gray-600 break-all">
                {cryptoData.address}
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(cryptoData.address)}
                className={`absolute right-1 top-1 bottom-1 px-3 bg-white border rounded-lg shadow-sm transition-all flex items-center justify-center group-hover:shadow-md ${
                  copiedText === cryptoData.address
                    ? 'border-green-300 text-green-600'
                    : 'border-gray-200 hover:border-emerald-400 hover:text-emerald-600'
                }`}
                title={
                  copiedText === cryptoData.address ? 'Copied!' : 'Copy Address'
                }
              >
                {copiedText === cryptoData.address ? (
                  <Check size={16} />
                ) : (
                  <Copy size={16} />
                )}
              </button>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] leading-relaxed text-amber-800">
                <strong className="font-bold">Warning:</strong> Only send{' '}
                <span className="font-bold">{cryptoData.currency}</span> on the{' '}
                <span className="font-bold">{chainLabel}</span> network. Using the
                wrong network will result in permanent loss.
              </p>
            </div>
          </div>

          {/* Confirmation Time */}
          {cryptoData.confirmation_time && (
            <div className="flex items-center gap-3 bg-emerald-50 rounded-xl p-4 border border-emerald-100">
              <div className="size-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                <Clock size={20} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Expected confirmation
                </p>
                <p className="text-xs text-gray-500">
                  {cryptoData.confirmation_time}
                </p>
              </div>
            </div>
          )}

          {/* Reference */}
          <div className="text-center text-xs text-gray-400">
            Reference: {cryptoData.reference}
          </div>

          {/* Verification Status */}
          {status === 'verifying' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Loader2 size={18} className="animate-spin text-blue-600" />
                <span className="text-sm font-medium text-blue-800">
                  Checking payment status…
                </span>
              </div>
              <p className="text-xs text-blue-600">
                This may take a few minutes. Do not close this window.
              </p>
            </div>
          )}

          {status === 'confirmed' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-sm font-medium text-green-800">
                Payment confirmed! Redirecting…
              </p>
            </div>
          )}

          {status === 'failed' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-sm font-medium text-red-800">
                Payment verification failed. Please contact support.
              </p>
            </div>
          )}

          {/* Verify Button */}
          <button
            type="button"
            onClick={verifyCryptoPayment}
            disabled={status === 'verifying' || status === 'confirmed'}
            className={`w-full py-3.5 font-bold rounded-xl transition-colors shadow-lg ${
              status === 'verifying' || status === 'confirmed'
                ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200'
            }`}
          >
            {status === 'verifying' ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Verifying Payment…
              </span>
            ) : (
              "I've Sent the Payment"
            )}
          </button>

          <p className="text-center text-xs text-gray-400">
            Click the button above after sending. We'll verify the payment on
            the blockchain.
          </p>
        </div>
      </div>
    </div>
  );
}
