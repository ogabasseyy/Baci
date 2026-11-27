import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import type { SwapMedia, SwapPhoto } from './select-swap-media';

/** Longest edge & compression tiers; starts at the size the website sends. */
const STILL_TIERS = [
  { maxEdge: 768, quality: 0.8 },
  { maxEdge: 640, quality: 0.65 },
  { maxEdge: 512, quality: 0.5 },
  { maxEdge: 384, quality: 0.4 },
] as const;
const VIDEO_STILL_COUNT = 4;
const VIDEO_LOAD_TIMEOUT_MS = 10_000;
/** Used when the picker does not report how long the clip is (seconds). */
const FALLBACK_STILL_TIMES_SEC = [0, 1.5, 3, 4.5];
/** Leaves headroom under the server's 1,900,000-byte grading limit + multipart overhead. */
export const SWAP_STILLS_MAX_BYTES = 1_800_000;

export const UNREADABLE_PHOTO_MESSAGE =
  'We could not read one of your photos. Please try another photo.';
export const UNREADABLE_VIDEO_MESSAGE =
  'We could not read this video on your device. Please try a shorter clip or use photos.';
export const UPLOAD_TOO_LARGE_MESSAGE =
  'These photos are too large to upload together. Please choose fewer or smaller photos.';

type ImageManipulatorModule = typeof import('expo-image-manipulator');
type ShrunkStill = { uri: string; width: number; height: number };

/**
 * Shrinks a photo or video frame to a small JPEG. Phone photos and video frames
 * are several MB each, far above the device-check upload budget.
 */
async function shrink(
  manipulator: ImageManipulatorModule,
  source: string | VideoThumbnail,
  width: number,
  height: number,
  maxEdge: number,
  quality: number
): Promise<ShrunkStill> {
  const longestEdge = Math.max(width, height);
  // A small picture is only re-encoded, never enlarged. When the picker gives
  // no size the picture is treated as large, so it can never go up full-size.
  const fits = longestEdge > 0 && longestEdge <= maxEdge;
  const context = manipulator.ImageManipulator.manipulate(source);
  try {
    if (!fits) {
      context.resize(
        width >= height ? { width: maxEdge } : { height: maxEdge }
      );
    }
    const rendered = await context.renderAsync();
    try {
      const saved = await rendered.saveAsync({
        compress: quality,
        format: manipulator.SaveFormat.JPEG,
      });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      rendered.release?.();
    }
  } finally {
    context.release?.();
  }
}

function videoStillTimesSec(durationMs: number | null): number[] {
  if (!durationMs) return FALLBACK_STILL_TIMES_SEC;
  // Evenly spread in seconds, avoiding the very first and last frames (often black).
  return Array.from(
    { length: VIDEO_STILL_COUNT },
    (_, index) =>
      Math.round((durationMs * (index + 0.5)) / VIDEO_STILL_COUNT) / 1000
  );
}

async function waitForVideoPlayerReady(player: VideoPlayer): Promise<void> {
  if (player.status === 'readyToPlay') return;
  if (player.status === 'error') {
    throw new Error(UNREADABLE_VIDEO_MESSAGE);
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: { remove: () => void } | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error(UNREADABLE_VIDEO_MESSAGE));
    }, VIDEO_LOAD_TIMEOUT_MS);
    subscription = player.addListener?.('statusChange', ({ status }) => {
      if (status === 'readyToPlay') finish();
      else if (status === 'error') finish(new Error(UNREADABLE_VIDEO_MESSAGE));
    });
    // Check after attaching the listener in case status changed synchronously.
    if (player.status === 'readyToPlay') finish();
    else if (player.status === 'error') {
      finish(new Error(UNREADABLE_VIDEO_MESSAGE));
    }
  });
}

async function videoStills(
  uri: string,
  durationMs: number | null
): Promise<ShrunkStill[]> {
  const stills: ShrunkStill[] = [];
  const manipulator = await import('expo-image-manipulator');
  const { createVideoPlayer } = await import('expo-video');
  let player: VideoPlayer | null = null;
  try {
    try {
      player = createVideoPlayer(uri);
    } catch {
      throw new Error(UNREADABLE_VIDEO_MESSAGE);
    }

    await waitForVideoPlayerReady(player);

    const initialTier = STILL_TIERS[0];
    for (const timeSec of videoStillTimesSec(durationMs)) {
      let thumbnail: VideoThumbnail | undefined;
      try {
        const frames = await player.generateThumbnailsAsync(timeSec);
        thumbnail = frames[0];
      } catch {
        // A time past the end of a short clip has no frame; keep the others.
        continue;
      }
      if (!thumbnail) continue;
      try {
        stills.push(
          await shrink(
            manipulator,
            thumbnail,
            thumbnail.width,
            thumbnail.height,
            initialTier.maxEdge,
            initialTier.quality
          )
        );
      } catch {
        throw new Error(UNREADABLE_VIDEO_MESSAGE);
      } finally {
        thumbnail.release?.();
      }
    }
  } finally {
    player?.release?.();
  }
  if (stills.length === 0) throw new Error(UNREADABLE_VIDEO_MESSAGE);
  return stills;
}

async function photoStills(photos: SwapPhoto[]): Promise<ShrunkStill[]> {
  const stills: ShrunkStill[] = [];
  try {
    const manipulator = await import('expo-image-manipulator');
    const initialTier = STILL_TIERS[0];
    // One at a time: decoding several full-size photos at once can exhaust
    // memory on a low-end phone.
    for (const photo of photos) {
      stills.push(
        await shrink(
          manipulator,
          photo.uri,
          photo.width,
          photo.height,
          initialTier.maxEdge,
          initialTier.quality
        )
      );
    }
  } catch {
    throw new Error(UNREADABLE_PHOTO_MESSAGE);
  }
  return stills;
}

async function measureTotalBytes(stills: ShrunkStill[]): Promise<number> {
  const { File } = await import('expo-file-system');
  let total = 0;
  for (const still of stills) {
    const size = new File(still.uri).size;
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
      total += size;
    }
  }
  return total;
}

async function fitUploadBudget(
  initialStills: ShrunkStill[],
  unreadableMessage: string
): Promise<string[]> {
  let current = initialStills;
  if ((await measureTotalBytes(current)) <= SWAP_STILLS_MAX_BYTES) {
    return current.map((still) => still.uri);
  }

  try {
    const manipulator = await import('expo-image-manipulator');
    for (const tier of STILL_TIERS.slice(1)) {
      const next: ShrunkStill[] = [];
      for (const still of current) {
        next.push(
          await shrink(
            manipulator,
            still.uri,
            still.width,
            still.height,
            tier.maxEdge,
            tier.quality
          )
        );
      }
      current = next;
      if ((await measureTotalBytes(current)) <= SWAP_STILLS_MAX_BYTES) {
        return current.map((still) => still.uri);
      }
    }
  } catch {
    throw new Error(unreadableMessage);
  }

  if ((await measureTotalBytes(current)) > SWAP_STILLS_MAX_BYTES) {
    throw new Error(UPLOAD_TOO_LARGE_MESSAGE);
  }

  return current.map((still) => still.uri);
}

/**
 * Turns the shopper's photos or video into small JPEG stills on the device.
 * Only these stills are uploaded, so the size of the original never matters.
 */
export async function buildSwapStills(media: SwapMedia): Promise<string[]> {
  if (media.kind === 'video') {
    const stills = await videoStills(media.uri, media.durationMs);
    return fitUploadBudget(stills, UNREADABLE_VIDEO_MESSAGE);
  }
  const stills = await photoStills(media.photos);
  return fitUploadBudget(stills, UNREADABLE_PHOTO_MESSAGE);
}
