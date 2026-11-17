import type { AIAnalysisResult } from '@/lib/validation';

export type SwapColors = typeof import('@/constants/Colors').default['light'];

export type SwapModalStep = 'upload' | 'analyzing' | 'result';

export type SwapTradeInModalProps = {
  colors: SwapColors;
  error: string | null;
  isAnalyzing: boolean;
  result: AIAnalysisResult | null;
  step: SwapModalStep;
  mediaLabel: string | null;
  visible: boolean;
  onAcceptOffer: () => void;
  onClose: () => void;
  onClearMedia: () => void;
  onPickMedia: () => void;
  onRecordVideo: () => void;
  onReset: () => void;
  onStartAnalysis: () => void;
};

export type SwapUploadStepProps = Pick<
  SwapTradeInModalProps,
  | 'colors'
  | 'error'
  | 'isAnalyzing'
  | 'onClearMedia'
  | 'onPickMedia'
  | 'onRecordVideo'
  | 'onStartAnalysis'
  | 'mediaLabel'
>;

export type SwapResultStepProps = Pick<
  SwapTradeInModalProps,
  'colors' | 'onAcceptOffer' | 'onReset' | 'result'
>;
