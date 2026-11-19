import {
  DEVICE_GRADING_FRAME_TYPES,
  DEVICE_GRADING_MAX_FRAMES,
  DEVICE_GRADING_MAX_UPLOAD_BYTES,
  DEVICE_GRADING_VIDEO_TYPES,
} from '@/schemas/device-grading';

export interface DeviceMediaPart {
  data: string;
  mimeType: string;
}

export type DeviceMediaResult =
  | { ok: true; merchantSlug: string | null; files: File[] }
  | { ok: false; error: string; status: 400 | 413 };

const FRAME_TYPES = new Set<string>(DEVICE_GRADING_FRAME_TYPES);
const VIDEO_TYPES = new Set<string>(DEVICE_GRADING_VIDEO_TYPES);

function isFile(value: FormDataEntryValue | null): value is File {
  return typeof value === 'object' && value !== null && 'arrayBuffer' in value;
}

/**
 * Base64-encodes validated media for the model. Kept apart from validation so
 * the route can reject an unknown storefront before paying for the encoding.
 */
export function encodeDeviceMedia(files: File[]): Promise<DeviceMediaPart[]> {
  return Promise.all(
    files.map(async (file) => ({
      data: Buffer.from(await file.arrayBuffer()).toString('base64'),
      mimeType: file.type,
    }))
  );
}

/**
 * Validates the device media in the upload without reading its bytes:
 * still frames (`frames`, sent by the web storefront) or one short clip
 * (`video`, sent by the mobile app).
 */
export function readDeviceMedia(formData: FormData): DeviceMediaResult {
  const slugEntry = formData.get('merchantSlug');
  const merchantSlug =
    typeof slugEntry === 'string' && slugEntry.trim()
      ? slugEntry.trim().toLowerCase()
      : null;

  const frames = formData.getAll('frames').filter(isFile);
  const video = formData.get('video');
  const files = frames.length > 0 ? frames : isFile(video) ? [video] : [];

  if (files.length === 0) {
    return { ok: false, status: 400, error: 'No video file provided' };
  }
  if (frames.length > DEVICE_GRADING_MAX_FRAMES) {
    return { ok: false, status: 400, error: 'Too many images provided' };
  }

  const typesAreValid =
    frames.length > 0
      ? frames.every((frame) => FRAME_TYPES.has(frame.type))
      : VIDEO_TYPES.has(files[0].type);
  if (!typesAreValid) {
    return { ok: false, status: 400, error: 'Unsupported file type' };
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes === 0) {
    return { ok: false, status: 400, error: 'No video file provided' };
  }
  if (totalBytes > DEVICE_GRADING_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'That video is too large. Please record a shorter clip.',
    };
  }

  return { ok: true, merchantSlug, files };
}
