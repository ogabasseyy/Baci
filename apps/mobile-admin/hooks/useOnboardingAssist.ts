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

export function useOnboardingAssist() {
  return useMutation({
    retry: false,
    mutationFn: async (
      payload: OnboardingAssistRequest
    ): Promise<OnboardingAssistResponse> => {
      return await apiClient<OnboardingAssistResponse>(
        '/api/mobile/onboarding-assist',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
    },
  });
}
