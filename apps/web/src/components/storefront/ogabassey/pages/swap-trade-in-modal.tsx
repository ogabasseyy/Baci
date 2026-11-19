'use client';

import { ArrowRight, Camera, Check, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { COMPACT_OPTIONS, formatCurrency } from '@/lib/currency';
import {
  type DeviceGradingResult,
  requestDeviceGrading,
} from '@/lib/storefront/request-device-grading';
import { selectDeviceMedia } from '@/lib/storefront/select-device-media';
import { SparklesIcon } from './swap-sparkles-icon';

// /api/ai/grade-device prices come from NGN product rows without conversion;
// keep compact NGN formatting regardless of storefront display currency.
const formatNairaCompact = (amount: number) =>
  formatCurrency(amount, 'NG', COMPACT_OPTIONS);

/**
 * Callers must mount this only while it is open (as the swap page does): its
 * upload, result and error state lives for the life of the component, so
 * unmounting on close is what gives each visit a fresh upload step.
 */
export function TradeInModal({
  isOpen,
  onClose,
  supportPhone,
  merchantSlug
}: {
  isOpen: boolean;
  onClose: () => void;
  supportPhone: string;
  merchantSlug?: string;
}) {
  const [step, setStep] = useState<'upload' | 'analyzing' | 'result'>('upload');
  const [media, setMedia] = useState<{ files: File[]; label: string } | null>(null);
  const [result, setResult] = useState<DeviceGradingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Digits only: the number is interpolated into wa.me links below.
  const supportDigits = supportPhone.replace(/\D/g, '');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Let the same files be picked again after a refusal or a removal.
    e.target.value = '';
    if (picked.length === 0) return;

    const selection = selectDeviceMedia(picked);
    if (!selection.ok) {
      // Drop any earlier selection too, so Analyze cannot grade files the
      // shopper has just tried to replace.
      setMedia(null);
      setError(selection.error);
      return;
    }
    setMedia({ files: selection.files, label: selection.label });
    setError(null);
  };

  const startAnalysis = async () => {
    if (!media) return;

    setStep('analyzing');

    try {
      const analysis = await requestDeviceGrading(media.files, merchantSlug);
      setResult(analysis);
      setStep('result');
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStep('upload');
    }
  };

  const handleCompleteTradeIn = () => {
    if (!result) return;

    const message = encodeURIComponent(
      `Hello! I did an AI trade-in check.\n\n` +
      `📱 Device: ${result.model}\n` +
      `✨ Grade: ${result.grade}\n` +
      (result.estimatedValue > 0
        ? `💰 Estimate: ${formatNairaCompact(result.estimatedValue)}\n`
        : '') +
      `📝 Observations: ${result.observations.join(', ')}\n\n` +
      `I'd like to proceed with the swap.`
    );

    window.open(`https://wa.me/${supportDigits}?text=${message}`, '_blank');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <SparklesIcon className="text-red-600" /> AI Trade-in Valuator
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 hover:bg-gray-200 rounded-full transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'upload' && (
            <div className="text-center space-y-6">
              <div className="bg-blue-50 border-2 border-dashed border-blue-200 rounded-xl p-8 transition-all hover:bg-blue-100/50">
                <div className="size-16 bg-white text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <Camera size={32} />
                </div>
                <h4 className="font-semibold text-gray-900 mb-2">Upload Photos or a Video of Your Device</h4>
                <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
                  Show the screen and back clearly. Up to 6 photos, or one video under 15 seconds.
                </p>

                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/*"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  aria-label="Upload a video or photos of your device"
                />

                {!media ? (
                  <button type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                  >
                    <Upload size={18} /> Select Photos or Video
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full flex items-center gap-1">
                      <Check size={14} /> {media.label}
                    </span>
                    <button type="button"
                      onClick={() => {
                        setMedia(null);
                        setError(null);
                      }}
                      className="text-xs text-red-500 hover:text-red-700 underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded-lg">
                  <p>{error}</p>
                  <a
                    href={`https://wa.me/${supportDigits}?text=${encodeURIComponent("Hello! I'd like to swap my device.")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block font-semibold underline"
                  >
                    Chat with support instead
                  </a>
                </div>
              )}

              <button type="button"
                onClick={startAnalysis}
                disabled={!media}
                className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-100 flex items-center justify-center gap-2"
              >
                Analyze Device <ArrowRight size={20} />
              </button>
            </div>
          )}

          {step === 'analyzing' && (
            <div className="text-center py-12">
              <div className="relative size-20 mx-auto mb-6">
                <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-red-600 rounded-full border-t-transparent animate-spin"></div>
                <SparklesIcon className="absolute inset-0 m-auto text-red-600 animate-pulse" size={24} />
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-2">Checking your device…</h4>
              <p className="text-gray-500 text-sm animate-pulse">
                Checking screen condition… Identification model…
              </p>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
                <p className="text-sm text-green-800 font-medium mb-1">Estimated Trade-in Value</p>
                <div className="text-3xl font-extrabold text-green-700">
                  {result.estimatedValue > 0
                    ? formatNairaCompact(result.estimatedValue)
                    : 'Confirmed in chat'}
                </div>
                {result.basePrice > 0 && (
                  <div className="text-xs text-green-600 mt-1">
                    Based on market price: {formatNairaCompact(result.basePrice)}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <span className="text-xs text-gray-500 block mb-1">Model</span>
                  <span className="font-bold text-gray-900">{result.model}</span>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <span className="text-xs text-gray-500 block mb-1">Condition Grade</span>
                  <span className={`font-bold ${result.grade === 'Excellent' ? 'text-green-600' :
                    result.grade === 'Good' ? 'text-blue-600' :
                      result.grade === 'Fair' ? 'text-orange-600' : 'text-red-600'
                    }`}>{result.grade}</span>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h5 className="text-sm font-semibold text-gray-900 mb-2">AI Observations:</h5>
                <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                  {result.observations.map((obs, i) => (
                    <li key={i}>{obs}</li>
                  ))}
                  <li className="text-xs text-gray-400 mt-2 italic">
                    *Final verification required in-store.
                  </li>
                </ul>
              </div>

              <button type="button"
                onClick={handleCompleteTradeIn}
                className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 transition-all shadow-lg shadow-green-100 flex items-center justify-center gap-2"
              >
                {result.estimatedValue > 0 ? 'Accept Offer & Chat' : 'Get My Value in Chat'} <Check size={20} />
              </button>

              <button type="button"
                onClick={() => setStep('upload')}
                className="w-full text-gray-500 text-sm py-2 hover:text-gray-700"
              >
                Try Another Device
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
