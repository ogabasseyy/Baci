import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface OnboardingBrandColors {
  primary: string;
  background: string;
  accent: string;
}

export interface OnboardingAssistRequest {
  task: 'generate_names' | 'generate_logos' | 'extract_colors';
  businessName: string;
  businessType: string;
  brandPreferences: string;
  description?: string;
  tone?: string;
  logoUrl?: string;
}

export interface OnboardingAssistResponse {
  businessNames?: string[];
  logos?: string[];
  brandColors?: OnboardingBrandColors;
}

export const ONBOARDING_ASSIST_TIMEOUT_MS = 55_000;

export async function requestOnboardingAssist(
  payload: OnboardingAssistRequest
): Promise<OnboardingAssistResponse> {
  return await apiClient<OnboardingAssistResponse>(
    '/api/mobile/onboarding-assist',
    {
      method: 'POST',
      body: JSON.stringify(payload),
      timeout: ONBOARDING_ASSIST_TIMEOUT_MS,
    }
  );
}

export function useOnboardingAssist() {
  return useMutation({
    retry: false,
    mutationFn: requestOnboardingAssist,
  });
}
