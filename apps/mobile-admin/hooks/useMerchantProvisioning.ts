import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { getRuntimePlatform } from '@/config/runtime-platform';
import { useAuth } from '@/hooks/useAuth';
import { apiClient, NetworkError } from '@/lib/api-client';
import { signupAttemptIdSchema } from '@/schemas/signup-attempt-id';
import {
  captureMobileSignupLifecycle,
  type SignupFailureClass,
} from '@/services/signup-lifecycle-telemetry';
import { generateUUID } from '@/utils/uuid';

export interface MerchantProvisioningPayload {
  firstName: string;
  lastName: string;
  phone?: string;
  businessName: string;
  businessType: string;
  otherBusinessType?: string;
  country: string;
  slug?: string;
  slugIsCustom: boolean;
  logoUrl?: string;
  brandColors?: {
    primary: string;
    background: string;
    accent: string;
  };
}

interface MerchantProvisioningResponse {
  success: true;
  merchant: { id: string; slug: string };
  created: boolean;
}

function provisioningFailureClass(error: unknown): SignupFailureClass {
  if (!(error instanceof NetworkError)) return 'unexpected';
  if (error.isTimeout) return 'timeout';
  if (error.isOffline) return 'connectivity_transport';
  if ((error.statusCode ?? 0) >= 500) return 'server';
  if ((error.statusCode ?? 0) >= 400) return 'server_rejected';
  return 'unexpected';
}

export function useMerchantProvisioning() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fallbackAttemptRef = useRef<{
    attemptId: string;
    userId: string;
  } | null>(null);

  return useMutation({
    retry: false,
    mutationFn: async (
      payload: MerchantProvisioningPayload
    ): Promise<MerchantProvisioningResponse> => {
      const platform = getRuntimePlatform();
      if (platform !== 'ios' && platform !== 'android') {
        throw new Error(`Unsupported mobile platform: ${platform}`);
      }
      if (!user?.id) {
        throw new Error('Authenticated user is required for store setup');
      }

      const parsedAttemptId = signupAttemptIdSchema.safeParse(
        user.user_metadata?.signup_attempt_id
      );
      let attemptId: string;
      if (parsedAttemptId.success) {
        attemptId = parsedAttemptId.data;
      } else if (fallbackAttemptRef.current?.userId === user.id) {
        attemptId = fallbackAttemptRef.current.attemptId;
      } else {
        const fallbackAttempt = {
          attemptId: generateUUID(),
          userId: user.id,
        };
        fallbackAttemptRef.current = fallbackAttempt;
        attemptId = fallbackAttempt.attemptId;
      }
      const startedAt = Date.now();
      void captureMobileSignupLifecycle({
        attemptId,
        eventCode: 'merchant_provisioning_started',
        flow: 'merchant',
        outcome: 'started',
        stage: 'provisioning',
      });

      let result: MerchantProvisioningResponse;
      try {
        result = await apiClient<MerchantProvisioningResponse>(
          '/api/mobile/merchant-provisioning',
          {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
              'X-Baci-Platform': platform,
              'X-Baci-Signup-Attempt-Id': attemptId,
            },
          }
        );

        void captureMobileSignupLifecycle({
          attemptId,
          durationMs: Date.now() - startedAt,
          eventCode: 'merchant_signup_completed',
          flow: 'merchant',
          outcome: 'completed',
          stage: 'provisioning',
        });
      } catch (error) {
        void captureMobileSignupLifecycle({
          attemptId,
          durationMs: Date.now() - startedAt,
          error,
          eventCode: 'merchant_provisioning_failed',
          failureClass: provisioningFailureClass(error),
          flow: 'merchant',
          outcome: 'failed',
          stage: 'provisioning',
        });
        throw error;
      }

      await queryClient.invalidateQueries({
        queryKey: ['merchant', user.id],
        refetchType: 'active',
      });
      return result;
    },
  });
}
