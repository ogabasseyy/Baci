import type { AIAnalysisResult } from '@/lib/validation';

export const SWAP_ELIGIBLE_DEVICES = [
  'iPhones (11 and newer)',
  'Samsung Galaxy S Series',
  'MacBooks (2018+)',
  'PlayStation 4 & 5',
  'iPads',
] as const;

export const SWAP_HOW_IT_WORKS = [
  {
    title: 'Photos or Video',
    desc: 'A few photos or a quick 10s video of screen and body',
    icon: 'camera-outline',
  },
  {
    title: 'AI Analysis',
    desc: 'Gemini grades condition automatically',
    icon: 'sparkles-outline',
  },
  {
    title: 'Get Paid',
    desc: 'Accept offer and swap instantly',
    icon: 'cash-outline',
  },
] as const;

interface SwapGradeColors {
  error: string;
  primary: string;
  success: string;
  warning: string;
}

export function getSwapGradeColor(
  grade: string,
  colors: SwapGradeColors
): string {
  switch (grade) {
    case 'Excellent':
      return colors.success;
    case 'Good':
      return colors.primary;
    case 'Fair':
      return colors.warning;
    default:
      return colors.error;
  }
}

export function buildSwapInquiryMessage(result: AIAnalysisResult): string {
  const cleanObservations = result.observations
    .map((observation) => observation.replace(/\n/g, ' ').trim())
    .join(', ');

  return (
    `Hello! I did an AI trade-in check.\n\n` +
    `Device: ${result.model}\n` +
    `Grade: ${result.grade}\n` +
    `Estimate: N${result.estimatedValue.toLocaleString()}\n` +
    `Observations: ${cleanObservations}\n\n` +
    `I'd like to proceed with the swap.`
  );
}

export function buildSwapWhatsappUrl(
  result: AIAnalysisResult,
  supportPhone: string
): string {
  return `https://wa.me/${supportPhone}?text=${encodeURIComponent(buildSwapInquiryMessage(result))}`;
}
