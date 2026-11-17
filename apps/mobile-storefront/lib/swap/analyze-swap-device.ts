import { fetchWithTimeout, LONG_TIMEOUT } from '@/lib/fetch-with-timeout';
import { createLogger } from '@/lib/logger';
import {
  type AIAnalysisResult,
  AIGradeDeviceApiResponseSchema,
  parseApiResponse,
} from '@/lib/validation';
import { buildSwapStills } from './build-swap-stills';
import type { SwapMedia } from './select-swap-media';

const log = createLogger('Swap');
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://ogabassey.com';

export type SwapAnalysisOutcome =
  | { ok: true; data: AIAnalysisResult }
  | { ok: false; message: string };

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string' && payload.error) {
      return payload.error;
    }
  } catch {
    // ignore non-JSON error bodies
  }
  return `Server error (HTTP ${response.status})`;
}

/**
 * Sends the device check as small stills made on the phone. Never rejects:
 * the screen reads the outcome instead of catching, which React Compiler
 * cannot yet optimise inside a component body.
 */
export async function analyzeSwapDevice(
  media: SwapMedia
): Promise<SwapAnalysisOutcome> {
  try {
    const stills = await buildSwapStills(media);
    const formData = new FormData();
    stills.forEach((uri, index) => {
      // React Native sends a file part from a { uri, type, name } descriptor.
      formData.append('frames', {
        uri,
        type: 'image/jpeg',
        name: `frame-${index + 1}.jpg`,
      } as unknown as Blob);
    });

    const response = await fetchWithTimeout(
      `${API_BASE_URL}/api/ai/grade-device`,
      { method: 'POST', body: formData, timeout: LONG_TIMEOUT }
    );
    if (!response.ok) throw new Error(await readErrorMessage(response));

    const validated = parseApiResponse(
      AIGradeDeviceApiResponseSchema,
      await response.json(),
      'AI grade device API'
    );
    if (!validated?.data) {
      throw new Error(
        'We could not process the AI analysis result. Please try again.'
      );
    }
    return { ok: true, data: validated.data };
  } catch (analysisError) {
    log.error('Analysis error:', analysisError);
    return {
      ok: false,
      message:
        analysisError instanceof Error
          ? analysisError.message
          : 'Analysis failed. Please try again.',
    };
  }
}
