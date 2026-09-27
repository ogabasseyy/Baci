'use client';

import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  X,
} from 'lucide-react';
import type { CryptoPaymentData, CryptoVerificationStatus } from '../types';
import { CHAIN_DISPLAY_NAMES } from '../utils';

interface CryptoPaymentModalProps {
  data: CryptoPaymentData;
  verificationStatus: CryptoVerificationStatus;
  isVerifying: boolean;
  copiedText: string | null;
  onVerify: () => void;
  onCopyToClipboard: (text: string) => void;
  onClose: () => void;
  onCloseConfirm: () => void;
  onBack?: () => void;
}

export function CryptoPaymentModal({
  data,
  verificationStatus,
  isVerifying,
  copiedText,
  onVerify,
  onCopyToClipboard,
  onClose,
  onCloseConfirm,
  onBack,
}: CryptoPaymentModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-linear-to-r from-store-primary to-store-primary/80 p-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-2">
            {onBack && !isVerifying ? (
              <button
                type="button"
                onClick={onBack}
                className="size-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                aria-label="Change network or coin"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <div className="size-8 bg-white/20 rounded-lg flex items-center justify-center">
                <CreditCard size={16} className="text-white" />
              </div>
            )}
            <h2 className="font-bold text-white">Pay with Crypto</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close crypto payment modal"
            className="size-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Top Row: QR & Amount */}
          <div className="flex gap-4 items-center">
            <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-200">
              <img
                src={
                  data.qrcode ||
                  `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${data.address}&margin=10`
                }
                alt="Scan"
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
                  {data.amount.toLocaleString()}{' '}
                  <span className="text-store-primary">{data.currency}</span>
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 border border-gray-200">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                <p className="text-xs font-semibold text-gray-700">
                  Network: {CHAIN_DISPLAY_NAMES[data.chain] || data.chain}
                </p>
              </div>
            </div>
          </div>

          {/* Wallet Address */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
              Recipient Address
            </p>
            <div className="relative group">
              <div className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-3 pr-12 font-mono text-xs text-gray-600 break-all">
                {data.address}
              </div>
              <button
                type="button"
                onClick={() => onCopyToClipboard(data.address)}
                className={`absolute right-1 top-1 bottom-1 px-3 bg-white border rounded-lg shadow-sm transition-all flex items-center justify-center group-hover:shadow-md ${
                  copiedText === data.address
                    ? 'border-green-300 text-green-600'
                    : 'border-gray-200 hover:border-store-primary/40 hover:text-store-primary'
                }`}
                title={copiedText === data.address ? 'Copied!' : 'Copy Address'}
              >
                {copiedText === data.address ? (
                  <Check size={16} />
                ) : (
                  <Copy size={16} />
                )}
              </button>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <p className="text-[11px] leading-relaxed text-amber-800">
              <strong className="font-bold">Warning:</strong> Only send{' '}
              <span className="font-bold">{data.currency}</span> on the{' '}
              <span className="font-bold">
                {CHAIN_DISPLAY_NAMES[data.chain] || data.chain}
              </span>{' '}
              network. Using the wrong network will result in permanent loss.
            </p>
          </div>

          {/* Confirmation Time */}
          <div className="flex items-center gap-3 bg-store-primary/5 rounded-xl p-4 border border-store-primary/20">
            <div className="size-10 bg-store-primary/10 rounded-full flex items-center justify-center shrink-0">
              <Clock size={20} className="text-store-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Expected confirmation
              </p>
              <p className="text-xs text-gray-500">{data.confirmation_time}</p>
            </div>
          </div>

          {/* Reference */}
          <div className="text-center text-xs text-gray-400">
            Reference: {data.reference}
          </div>

          {/* Verification Status */}
          {isVerifying && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Loader2 size={18} className="animate-spin text-blue-600" />
                <span className="text-sm font-medium text-blue-800">
                  {verificationStatus === 'checking' &&
                    'Checking payment status...'}
                  {verificationStatus === 'pending' &&
                    'Waiting for blockchain confirmation...'}
                </span>
              </div>
              <p className="text-xs text-blue-600">
                This may take a few minutes. Do not close this window.
              </p>
            </div>
          )}

          {verificationStatus === 'confirmed' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-sm font-medium text-green-800">
                Payment confirmed! Redirecting to order confirmation…
              </p>
            </div>
          )}

          {verificationStatus === 'failed' && (
            <div className="bg-store-primary/5 border border-store-primary/30 rounded-xl p-4 text-center">
              <p className="text-sm font-medium text-red-800">
                Payment verification failed. Please contact support.
              </p>
            </div>
          )}

          {/* Verify Payment Button */}
          <button
            type="button"
            onClick={onVerify}
            disabled={isVerifying}
            className={`w-full py-3.5 font-bold rounded-xl transition-colors shadow-lg ${
              isVerifying
                ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                : 'bg-store-primary text-white hover:bg-store-primary/90 shadow-store-primary/20'
            }`}
          >
            {isVerifying ? (
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

          {/* Close without verifying */}
          {!isVerifying && (
            <button
              type="button"
              onClick={onCloseConfirm}
              className="w-full py-2.5 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
            >
              Close and check order status later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
