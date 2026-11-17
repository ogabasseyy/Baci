import { fetchWithCsrf } from '@/lib/api-client';
import { extractVideoFrames } from '@/lib/storefront/extract-video-frames';
import { DEVICE_GRADING_MAX_UPLOAD_BYTES } from '@/schemas/device-grading';

export interface DeviceGradingResult {
  model: string;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  observations: string[];
  basePrice: number;
  estimatedValue: number;
  deductionPercent: number;
  matchedProduct: string;
}

interface GradingResponseBody {
  data?: DeviceGradingResult;
  error?: string;
}

const UNREADABLE_VIDEO_MESSAGE =
  'We could not read this video on your device. Please try a shorter clip.';
const GENERIC_FAILURE_MESSAGE =
  'We could not check this device right now. Please try again.';

/**
 * Builds the upload: still frames taken from the video in the browser. When
 * the browser cannot decode the clip, a small clip is sent as-is; a large one
 * cannot be uploaded at all, so the customer is told instead.
 */
async function buildUpload(
  videoFile: File,
  merchantSlug: string | undefined
): Promise<FormData> {
  const formData = new FormData();
  if (merchantSlug) formData.append('merchantSlug', merchantSlug);

  let frames: Blob[] = [];
  try {
    frames = await extractVideoFrames(videoFile);
  } catch {
    frames = [];
  }

  if (frames.length > 0) {
    frames.forEach((frame, index) => {
      formData.append('frames', frame, `frame-${index + 1}.jpg`);
    });
    return formData;
  }

  if (videoFile.size > DEVICE_GRADING_MAX_UPLOAD_BYTES) {
    throw new Error(UNREADABLE_VIDEO_MESSAGE);
  }
  formData.append('video', videoFile);
  return formData;
}

export async function requestDeviceGrading(
  videoFile: File,
  merchantSlug?: string
): Promise<DeviceGradingResult> {
  const res = await fetchWithCsrf('/api/ai/grade-device', {
    method: 'POST',
    body: await buildUpload(videoFile, merchantSlug),
  });

  // Platform-level rejections (size, timeout) are not JSON.
  const payload = await res
    .json()
    .then((body) => body as GradingResponseBody)
    .catch((): GradingResponseBody => ({}));

  if (!res.ok || !payload.data) {
    throw new Error(payload.error || GENERIC_FAILURE_MESSAGE);
  }

  return payload.data;
}
