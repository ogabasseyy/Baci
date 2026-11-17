import type { SwapMedia, SwapPhoto } from './select-swap-media';

/** Longest edge of an uploaded still; the same size the website sends. */
const STILL_MAX_EDGE = 768;
const STILL_QUALITY = 0.8;
const VIDEO_STILL_COUNT = 4;
/** Used when the picker does not report how long the clip is. */
const FALLBACK_STILL_TIMES_MS = [0, 1500, 3000, 4500];

export const UNREADABLE_PHOTO_MESSAGE =
  'We could not read one of your photos. Please try another photo.';
export const UNREADABLE_VIDEO_MESSAGE =
  'We could not read this video on your device. Please try a shorter clip or use photos.';

type ImageManipulator = typeof import('expo-image-manipulator');

/**
 * Shrinks a picture to a small JPEG. Phone photos and video frames are
 * several MB each, far above the device-check upload budget.
 */
async function shrink(
  manipulator: ImageManipulator,
  picture: SwapPhoto
): Promise<string> {
  const longestEdge = Math.max(picture.width, picture.height);
  // A small picture is only re-encoded, never enlarged. When the picker gives
  // no size the picture is treated as large, so it can never go up full-size.
  const fits = longestEdge > 0 && longestEdge <= STILL_MAX_EDGE;
  const resize = fits
    ? null
    : picture.width >= picture.height
      ? { width: STILL_MAX_EDGE }
      : { height: STILL_MAX_EDGE };
  const shrunk = await manipulator.manipulateAsync(
    picture.uri,
    resize ? [{ resize }] : [],
    { compress: STILL_QUALITY, format: manipulator.SaveFormat.JPEG }
  );
  return shrunk.uri;
}

function videoStillTimes(durationMs: number | null): number[] {
  if (!durationMs) return FALLBACK_STILL_TIMES_MS;
  // Evenly spread, avoiding the very first and last frames (often black).
  return Array.from({ length: VIDEO_STILL_COUNT }, (_, index) =>
    Math.round((durationMs * (index + 0.5)) / VIDEO_STILL_COUNT)
  );
}

async function videoStills(
  uri: string,
  durationMs: number | null
): Promise<string[]> {
  const stills: string[] = [];
  try {
    // Loaded on use: these are native modules, absent on web and in tests
    // that only render the screen.
    const manipulator = await import('expo-image-manipulator');
    const { getThumbnailAsync } = await import('expo-video-thumbnails');
    for (const time of videoStillTimes(durationMs)) {
      try {
        const frame = await getThumbnailAsync(uri, { time, quality: 1 });
        stills.push(await shrink(manipulator, frame));
      } catch {
        // A time past the end of a short clip has no frame; keep the others.
      }
    }
  } catch {
    throw new Error(UNREADABLE_VIDEO_MESSAGE);
  }
  if (stills.length === 0) throw new Error(UNREADABLE_VIDEO_MESSAGE);
  return stills;
}

async function photoStills(photos: SwapPhoto[]): Promise<string[]> {
  const stills: string[] = [];
  try {
    const manipulator = await import('expo-image-manipulator');
    // One at a time: decoding several full-size photos at once can exhaust
    // memory on a low-end phone.
    for (const photo of photos) {
      stills.push(await shrink(manipulator, photo));
    }
  } catch {
    throw new Error(UNREADABLE_PHOTO_MESSAGE);
  }
  return stills;
}

/**
 * Turns the shopper's photos or video into small JPEG stills on the device.
 * Only these stills are uploaded, so the size of the original never matters.
 */
export function buildSwapStills(media: SwapMedia): Promise<string[]> {
  return media.kind === 'video'
    ? videoStills(media.uri, media.durationMs)
    : photoStills(media.photos);
}
