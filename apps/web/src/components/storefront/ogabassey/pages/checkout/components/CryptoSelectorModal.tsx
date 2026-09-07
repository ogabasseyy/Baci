'use client';

import { CreditCard, Clock, Loader2, X } from 'lucide-react';
import { useId } from 'react';
import { CRYPTO_CHAIN_SUPPORT, CHAIN_DISPLAY_NAMES } from '../utils';
import type { CryptoChain, CryptoCurrency } from '../types';

interface CryptoSelectorModalProps {
  selectedCryptoCurrency: CryptoCurrency;
  selectedCryptoChain: CryptoChain;
  isInitializingCrypto: boolean;
  onCurrencyChange: (currency: CryptoCurrency) => void;
  onChainChange: (chain: CryptoChain) => void;
  onInitialize: () => void;
  onClose: () => void;
  supportedChains?: CryptoChain[];
}

export function CryptoSelectorModal({
  selectedCryptoCurrency,
  selectedCryptoChain,
  isInitializingCrypto,
  onCurrencyChange,
  onChainChange,
  onInitialize,
  onClose,
  supportedChains,
}: CryptoSelectorModalProps) {
  const cryptoSelectorId = useId();
  const currencyLabelId = `${cryptoSelectorId}-currency-label`;
  const networkLabelId = `${cryptoSelectorId}-network-label`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--store-overlay)]/50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-linear-to-r from-store-primary to-store-primary/80 p-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="size-8 bg-white/20 rounded-lg flex items-center justify-center">
              <CreditCard size={16} className="text-white" />
            </div>
            <h2 className="font-bold text-white">Select Crypto Payment</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Currency Selection */}
          <div className="space-y-3">
            <p
              id={currencyLabelId}
              className="text-sm font-bold text-gray-700"
            >
              Select Stablecoin
            </p>
            <div
              className="grid grid-cols-2 gap-3"
              role="group"
              aria-labelledby={currencyLabelId}
            >
              {(['USDT', 'USDC'] as const).map((currency) => (
                <button
                  key={currency}
                  type="button"
                  onClick={() => onCurrencyChange(currency)}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    selectedCryptoCurrency === currency
                      ? 'border-store-primary bg-store-primary/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">
                      {currency}
                    </p>
                    <p className="text-xs text-gray-500">
                      {currency === 'USDT' ? 'Tether USD' : 'USD Coin'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Network Selection */}
          <div className="space-y-3">
            <p
              id={networkLabelId}
              className="text-sm font-bold text-gray-700"
            >
              Select Network
            </p>
            <div
              className="grid grid-cols-2 gap-3"
              role="group"
              aria-labelledby={networkLabelId}
            >
              {(supportedChains ?? CRYPTO_CHAIN_SUPPORT[selectedCryptoCurrency]).map((chain) => (
                <button
                  key={chain}
                  type="button"
                  onClick={() => onChainChange(chain)}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    selectedCryptoChain === chain
                      ? 'border-store-primary bg-store-primary/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{chain}</p>
                    <p className="text-xs text-gray-500">
                      {CHAIN_DISPLAY_NAMES[chain]
                        ?.replace(/\s*\([^)]*\)/, '') || chain}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Network Info */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Clock size={18} className="text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {selectedCryptoChain === 'TRX' && '1-3 minutes'}
                  {selectedCryptoChain === 'ETH' && '5-30 minutes'}
                  {selectedCryptoChain === 'MATIC' && '1-5 minutes'}
                  {selectedCryptoChain === 'AVAXC' && '1-5 minutes'}
                </p>
                <p className="text-xs text-gray-500">
                  Expected confirmation time
                </p>
              </div>
            </div>
          </div>

          {/* Continue Button */}
          <button
            type="button"
            onClick={onInitialize}
            disabled={isInitializingCrypto}
            className="w-full py-3.5 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors shadow-lg shadow-store-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isInitializingCrypto ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Generating Address…
              </>
            ) : (
              <>
                Continue with {selectedCryptoCurrency} on{' '}
                {selectedCryptoChain}
              </>
            )}
          </button>

          <p className="text-center text-xs text-gray-400">
            You'll receive a wallet address to send your{' '}
            {selectedCryptoCurrency} payment
          </p>
        </div>
      </div>
    </div>
  );
}
