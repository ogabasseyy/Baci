import { fetchWithCsrf } from '@/lib/api-client';
import { extractVideoFrames } from '@/lib/storefront/extract-video-frames';
import { resizeDevicePhoto } from '@/lib/storefront/resize-device-photo';
import { selectDeviceMedia } from '@/lib/storefront/select-device-media';
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
const UNREADABLE_PHOTO_MESSAGE =
  'We could not read one of your photos. Please try a JPG or PNG photo.';
const GENERIC_FAILURE_MESSAGE =
  'We could not check this device right now. Please try again.';

const STILLS_TOO_LARGE_MESSAGE =
  'Your photos are too large to send together. Please try fewer photos.';

/**
 * Photos are shrunk in the browser, one at a time so a low-end phone never
 * holds several full-size photos in memory. One that cannot be read stops
 * the check.
 */
async function photoStills(photos: File[]): Promise<Blob[]> {
  const stills: Blob[] = [];
  try {
    for (const photo of photos) {
      stills.push(await resizeDevicePhoto(photo));
    }
  } catch {
    throw new Error(UNREADABLE_PHOTO_MESSAGE);
  }
  return stills;
}

/**
 * Still frames taken from the video in the browser. Empty when the browser
 * cannot decode the clip.
 */
async function videoStills(videoFile: File): Promise<Blob[]> {
  try {
    return await extractVideoFrames(videoFile);
  } catch {
    return [];
  }
}

/**
 * Builds the upload from the shopper's photos or their one video: always
 * small stills. When the browser cannot decode a clip, a small clip is sent
 * as-is; a large one cannot be uploaded at all, so the customer is told.
 */
async function buildUpload(
  media: File[],
  merchantSlug: string | undefined
): Promise<FormData> {
  const formData = new FormData();
  if (merchantSlug) formData.append('merchantSlug', merchantSlug);

  // Callers pass one video or a few photos. Re-check here so a mixed or
  // unsupported set is refused instead of being graded from its first file.
  const selection = selectDeviceMedia(media);
  if (!selection.ok) throw new Error(selection.error);
  const [first] = selection.files;
  if (!first) throw new Error(GENERIC_FAILURE_MESSAGE);
  const isVideo = first.type.startsWith('video/');
  const stills = isVideo
    ? await videoStills(first)
    : await photoStills(selection.files);

  if (stills.length > 0) {
    // The server would refuse this with a message written for videos.
    const totalBytes = stills.reduce((sum, still) => sum + still.size, 0);
    if (!isVideo && totalBytes > DEVICE_GRADING_MAX_UPLOAD_BYTES) {
      throw new Error(STILLS_TOO_LARGE_MESSAGE);
    }
    stills.forEach((still, index) => {
      formData.append('frames', still, `frame-${index + 1}.jpg`);
    });
    return formData;
  }

  if (first.size > DEVICE_GRADING_MAX_UPLOAD_BYTES) {
    throw new Error(UNREADABLE_VIDEO_MESSAGE);
  }
  formData.append('video', first);
  return formData;
}

/** `media` is one video, or the photos, the shopper picked. */
export async function requestDeviceGrading(
  media: File[],
  merchantSlug?: string
): Promise<DeviceGradingResult> {
  const res = await fetchWithCsrf('/api/ai/grade-device', {
    method: 'POST',
    body: await buildUpload(media, merchantSlug),
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
