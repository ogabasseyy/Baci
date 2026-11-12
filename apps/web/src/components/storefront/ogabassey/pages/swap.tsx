// Template preview
'use client';


import {
  ArrowRight,
  Camera,
  Check,
  DollarSign,
  Leaf,
  Recycle,
  RefreshCw,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  type DeviceGradingResult,
  requestDeviceGrading,
} from '@/lib/storefront/request-device-grading';

function TradeInModal({
  isOpen,
  onClose,
  supportPhone
}: {
  isOpen: boolean;
  onClose: () => void;
  supportPhone: string;
}) {
  const { formatCurrency } = useCurrency();
  const [step, setStep] = useState<'upload' | 'analyzing' | 'result'>('upload');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [result, setResult] = useState<DeviceGradingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        setError("Video is too large. Please keep it under 50MB and 15 seconds.");
        return;
      }
      setVideoFile(file);
      setError(null);
    }
  };

  const startAnalysis = async () => {
    if (!videoFile) return;

    setStep('analyzing');

    try {
      const analysis = await requestDeviceGrading(videoFile);
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
      `💰 Estimate: ${formatCurrency(result.estimatedValue)}\n` +
      `📝 Observations: ${result.observations.join(', ')}\n\n` +
      `I'd like to proceed with the swap.`
    );

    window.open(`https://wa.me/${supportPhone}?text=${message}`, '_blank');
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
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'upload' && (
            <div className="text-center space-y-6">
              <div className="bg-blue-50 border-2 border-dashed border-blue-200 rounded-xl p-8 transition-all hover:bg-blue-100/50">
                <div className="size-16 bg-white text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <Video size={32} />
                </div>
                <h4 className="font-semibold text-gray-900 mb-2">Upload a Video of Your Device</h4>
                <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
                  Show the screen and back clearly. Keep it under 15 seconds.
                </p>

                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  aria-label="Upload a video of your device"
                />

                {!videoFile ? (
                  <button type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                  >
                    <Upload size={18} /> Select Video
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full flex items-center gap-1">
                      <Check size={14} /> {videoFile.name}
                    </span>
                    <button type="button"
                      onClick={() => setVideoFile(null)}
                      className="text-xs text-red-500 hover:text-red-700 underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded-lg">{error}</p>
              )}

              <button type="button"
                onClick={startAnalysis}
                disabled={!videoFile}
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
              <h4 className="text-xl font-bold text-gray-900 mb-2">Gemini AI is Analyzing…</h4>
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
                  {formatCurrency(result.estimatedValue)}
                </div>
                {result.basePrice > 0 && (
                  <div className="text-xs text-green-600 mt-1">
                    Based on market price: {formatCurrency(result.basePrice)}
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
                Accept Offer & Chat <Check size={20} />
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

const SparklesIcon = ({ className, size = 20 }: { className?: string; size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

export function OgabasseyV2Swap() {
  const merchantContext = useMerchantSafe();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Clean phone number for links
  const supportPhone = merchantContext?.merchant?.support_phone?.replace(/\D/g, '') || '2348146978921';

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <TradeInModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        supportPhone={supportPhone}
      />

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <RefreshCw className="text-red-600" />
          Swap & Trade-in
        </h1>
        <p className="text-gray-500 text-sm mb-8 max-w-xl">
          Upgrade to the latest tech for less. Trade in your old device and use
          the value towards a new purchase.
        </p>

        {/* Hero Section */}
        <div className="bg-linear-to-r from-red-600 to-red-800 text-white rounded-2xl p-8 md:p-12 mb-10 relative overflow-hidden shadow-xl">
          <div className="relative z-10 max-w-lg">
            <span className="inline-block bg-white/20 backdrop-blur-md text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wider">
              Powered by Gemini 3.0 Flash ✨
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4 leading-tight">
              Get an Instant AI Valuation in Seconds.
            </h2>
            <p className="text-white/80 mb-8 text-sm md:text-base">
              Simply upload a short video of your device. Our AI will analyze the condition and give you an instant trade-in offer.
            </p>
            <button type="button"
              onClick={() => setIsModalOpen(true)}
              className="bg-white text-red-700 font-bold py-3.5 px-8 rounded-xl hover:bg-gray-100 transition-colors shadow-lg active:scale-95 flex items-center gap-2"
            >
              Start AI Trade-in <Camera size={18} />
            </button>
          </div>

          {/* Background Decorations */}
          <div className="absolute right-0 bottom-0 size-64 bg-white/10 rounded-full blur-3xl transform translate-y-1/2 translate-x-1/2" />
          <RefreshCw className="absolute -right-12 top-1/2 -translate-y-1/2 text-white/10 size-80 rotate-12" />
        </div>

        {/* How it Works */}
        <div className="mb-10">
          <h3 className="font-bold text-lg text-gray-900 mb-6 text-center">
            How it Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: '1. Record Video',
                desc: 'Take a Quick 10s video showing your device screen and body.',
                icon: Video,
              },
              {
                title: '2. AI Analysis',
                desc: 'Gemini grades your phone condition automatically.',
                icon: SparklesIcon,
              },
              {
                title: '3. Get Paid',
                desc: 'Accept the offer and swap instantly.',
                icon: DollarSign,
              },
            ].map((step, idx) => (
              <div
                key={step.title}
                className="bg-white p-6 rounded-2xl border border-gray-100 text-center shadow-sm relative"
              >
                <div className="size-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
                  <step.icon size={24} />
                </div>
                <h4 className="font-bold text-gray-900 mb-2">{step.title}</h4>
                <p className="text-sm text-gray-500">{step.desc}</p>

                {idx < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10 bg-white p-1 rounded-full border border-gray-200 text-gray-400">
                    <ArrowRight size={14} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Eligible Devices */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 mb-10">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-lg text-gray-900">
              What can you trade in?
            </h3>
          </div>
          <div className="space-y-3">
            {[
              'iPhones (11 and newer)',
              'Samsung Galaxy S Series',
              'MacBooks (2018+)',
              'PlayStation 4 & 5',
              'iPads',
            ].map((item, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: Static list
                key={i}
                className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl transition-colors border-b border-gray-50 last:border-0"
              >
                <div className="size-6 rounded-full bg-green-100 flex items-center justify-center text-green-600 shrink-0">
                  <Check size={14} strokeWidth={3} />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Sustainability Impact */}
        <div className="bg-green-50 rounded-2xl p-6 md:p-8 border border-green-100 flex flex-col md:flex-row items-center gap-6 text-center md:text-left shadow-sm">
          <div className="size-16 bg-white text-green-600 rounded-full flex items-center justify-center shadow-sm shrink-0 border border-green-100">
            <Leaf size={32} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <Recycle size={20} className="text-green-600" />
              <h3 className="font-bold text-green-900 text-lg">
                Trade-in is Recycling
              </h3>
            </div>
            <p className="text-green-800 text-sm leading-relaxed max-w-2xl">
              By swapping your device, you keep e-waste out of landfills. We
              refurbish and re-home your old gadgets, extending their lifecycle
              and reducing the carbon footprint of manufacturing new ones.{' '}
              <span className="font-bold">
                It's a win for your wallet and the planet.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
