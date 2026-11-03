import 'server-only';

import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';
import type { ImeiProvider } from '../types';
import type { createPetrockClient } from './petrock-client';
import { parsePetrockReplay } from './petrock-parser';
import { isDefinitivePetrockSubmissionRejection } from './petrock-submission-outcome';

type PetrockOrderClient = Pick<
  ReturnType<typeof createPetrockClient>,
  'getOrder' | 'submitOrder'
>;

function buildResult({
  identifier,
  replay,
}: {
  identifier: string;
  replay: string;
}): ImeiCheckResult {
  const parsed = parsePetrockReplay(replay);
  const device = parsed.device || 'Unknown Device';
  return {
    imei: identifier,
    device,
    modelNumber: parsed.modelNumber || '',
    status: parsed.status || 'Unknown',
    icloud: parsed.icloud || 'Unknown',
    icloudLock: parsed.icloudLock || 'Unknown',
    simLock: parsed.simLock || 'Unknown',
    blacklistStatus: parsed.blacklistStatus || 'Unknown',
    carrier: parsed.carrier || 'Unknown',
    deviceImage: '',
    deviceProfile: parsed.deviceProfile,
    score: parsed.score ?? 50,
    activationStatus: parsed.activationStatus,
    serialNumber: parsed.serialNumber,
    purchaseDate: parsed.purchaseDate,
    purchaseCountry: parsed.purchaseCountry,
    warranty: parsed.warranty,
    refurbished: parsed.refurbished,
    demoUnit: parsed.demoUnit,
    mdmStatus: parsed.mdmStatus,
    knoxGuardStatus: parsed.knoxGuardStatus,
    miLockStatus: parsed.miLockStatus,
    miLostStatus: parsed.miLostStatus,
    partNumber: parsed.partNumber,
    repairEligibility: parsed.repairEligibility,
    gsxCoverage: parsed.gsxCoverage,
    repairHistory: parsed.repairHistory,
    replacementHistory: parsed.replacementHistory,
    esimCompatibility: parsed.esimCompatibility,
    financeStatus: parsed.financeStatus,
    knoxEnrollment: parsed.knoxEnrollment,
    soldBy: parsed.soldBy,
    wifiMac: parsed.wifiMac,
    devicePhoto: parsed.devicePhoto,
    deviceType: parsed.deviceType || 'other',
    verdict: parsed.verdict || 'Unable to determine device status.',
    verdictType: parsed.verdictType || 'caution',
  };
}

export function createPetrockProvider({
  client,
}: {
  client: PetrockOrderClient;
}): ImeiProvider & {
  name: 'petrock';
  poll: NonNullable<ImeiProvider['poll']>;
} {
  return {
    isConfigured: () => true,
    name: 'petrock',
    async poll(request) {
      const result = await client.getOrder(request.providerOrderId);
      if (!result.ok) {
        return {
          kind: 'pending',
          providerOrderId: request.providerOrderId,
          providerStatus: `poll_${result.kind}`,
        };
      }

      if (result.data.status === 'new' || result.data.status === 'in-process') {
        return {
          kind: 'pending',
          providerOrderId: result.data.orderUuid,
          providerStatus: result.data.status,
        };
      }

      if (result.data.status === 'reject') {
        const unavailable =
          /unable to check|temporarily unavailable|service unavailable/i.test(
            result.data.replay
          );
        return {
          body: {
            code: unavailable ? 'PETROCK_UNAVAILABLE' : 'PETROCK_REJECTED',
            error: unavailable
              ? 'The provider could not complete this check; your wallet will be refunded.'
              : 'IMEI result was rejected; your wallet will be refunded.',
            success: false,
          },
          kind: 'failure',
          providerStatus: 'reject',
          rawResponseText: result.rawText,
          refundReason: unavailable ? 'error' : 'not_found',
          status: unavailable ? 502 : 404,
        };
      }

      return {
        body: {
          data: buildResult({
            identifier: request.identifier,
            replay: result.data.replay,
          }),
          success: true,
          tier: {
            checksIncluded: request.checksIncluded,
            name: request.tierName,
          },
        },
        kind: 'complete',
        providerStatus: 'success',
        rawResponseText: result.rawText,
        status: 200,
      };
    },
    async submit(request) {
      const result = await client.submitOrder({
        feedbackUrl: request.feedbackUrl,
        identifier: request.identifier,
        orderFieldName: request.binding.orderFieldName,
        productId: request.binding.productId,
        referenceId: request.referenceId,
      });

      if (!result.ok) {
        if (isDefinitivePetrockSubmissionRejection(result)) {
          return {
            body: {
              code: 'PETROCK_REJECTED',
              error:
                'IMEI order could not be placed; your wallet was refunded.',
              success: false,
            },
            kind: 'failure',
            providerStatus: `submit_http_${result.status}`,
            refundReason: 'error',
            status: 502,
          };
        }

        return {
          kind: 'submission_unknown',
          providerStatus: `submit_${result.kind}`,
          reason: result.message,
        };
      }

      return {
        kind: 'pending',
        providerOrderId: result.data.orderUuid,
        providerStatus: 'new',
      };
    },
  };
}
