'use client';

import { Building2, Check, Clock, Copy, X } from 'lucide-react';
import type { DvaData } from '../types';

interface DvaModalProps {
  data: DvaData;
  copiedText: string | null;
  onCopyToClipboard: (text: string) => void;
  onClose: () => void;
  formatCurrency: (amount: number) => string;
  isVerifying: boolean;
  onConfirmTransfer: () => void;
}

export function DvaModal({
  data,
  copiedText,
  onCopyToClipboard,
  onClose,
  formatCurrency,
  isVerifying,
  onConfirmTransfer,
}: DvaModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-linear-to-r from-store-primary to-store-primary/80 p-6 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="size-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white leading-none">
                Bank Transfer
              </h2>
              <p className="text-white/70 text-xs mt-1">
                Automatic verification
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close bank transfer modal"
            onClick={onClose}
            className="size-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Amount to Pay */}
          <div className="text-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
              Send Exactly
            </p>
            <p className="text-3xl font-black text-gray-900">
              {formatCurrency(data.amount)}
            </p>
          </div>

          {/* Bank Details */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
                Account Number
              </p>
              <div className="relative group">
                <div className="w-full bg-gray-50 border border-gray-200 rounded-xl py-4 px-4 font-mono text-xl font-bold text-gray-900 tracking-wider">
                  {data.account_number}
                </div>
                <button
                  type="button"
                  aria-label="Copy account number"
                  onClick={() => onCopyToClipboard(data.account_number)}
                  className={`absolute right-2 top-2 bottom-2 px-4 bg-white border rounded-lg shadow-sm transition-all flex items-center justify-center group-hover:shadow-md ${
                    copiedText === data.account_number
                      ? 'border-green-300 text-green-600'
                      : 'border-gray-200 hover:border-store-primary/40 hover:text-store-primary'
                  }`}
                >
                  {copiedText === data.account_number ? (
                    <Check size={18} />
                  ) : (
                    <Copy size={18} />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Bank Name
                </p>
                <p className="font-bold text-gray-900">{data.bank_name}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Account Name
                </p>
                <p className="font-bold text-gray-900 truncate">
                  {data.account_name}
                </p>
              </div>
            </div>
          </div>

          {/* Instruction & Timer */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex gap-4">
            <div className="size-10 bg-white rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <Clock size={20} className="text-blue-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-blue-900">
                Transfer expires in 60:00
              </h4>
              <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                Make your transfer within the next hour. Your order will be
                confirmed automatically once the payment is detected.
              </p>
            </div>
          </div>

          {/* Waiting Status */}
          <div className="flex flex-col items-center justify-center py-4 gap-3">
            <div className="flex items-center gap-3 text-store-primary">
              <div className="flex gap-1">
                <div className="size-1.5 bg-store-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="size-1.5 bg-store-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="size-1.5 bg-store-primary rounded-full animate-bounce" />
              </div>
              <span className="text-sm font-bold" role="status">
                {isVerifying ? 'Verifying transfer…' : 'Waiting for transfer…'}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 text-center">
              Reference: {data.reference}
            </p>
          </div>

          {/* Buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={onConfirmTransfer}
              disabled={isVerifying}
              className="w-full py-4 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors shadow-lg shadow-store-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVerifying ? 'Verifying transfer…' : 'Confirm Transfer Sent'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
            >
              Close and check later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
