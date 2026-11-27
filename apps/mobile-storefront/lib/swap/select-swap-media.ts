/** Most photos one device check accepts; matches the server's frame limit. */
export const SWAP_MAX_PHOTOS = 6;

/** The fields of a picked library or camera item the swap flow relies on. */
export type SwapPickedAsset = {
  uri: string;
  type?: string | null;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number | null;
};

export type SwapPhoto = { uri: string; width: number; height: number };

export type SwapMedia =
  | { kind: 'video'; uri: string; durationMs: number | null }
  | { kind: 'photos'; photos: SwapPhoto[] };

export type SwapMediaSelection =
  | { ok: true; media: SwapMedia; label: string }
  | { ok: false; error: string };

type MediaKind = 'photo' | 'video' | 'other';

function kindOf(asset: SwapPickedAsset): MediaKind {
  if (
    asset.type === 'video' ||
    asset.type === 'pairedVideo' ||
    asset.mimeType?.startsWith('video/')
  ) {
    return 'video';
  }
  if (
    asset.type === 'image' ||
    asset.type === 'livePhoto' ||
    asset.mimeType?.startsWith('image/')
  ) {
    return 'photo';
  }
  return 'other';
}

/**
 * A device check takes either one video or a few photos, never a mix: the
 * server grades one set of stills, taken from the clip or sent as photos.
 */
export function selectSwapMedia(picked: SwapPickedAsset[]): SwapMediaSelection {
  const kinds = picked.map(kindOf);
  const videos = picked.filter((_, index) => kinds[index] === 'video');
  const photos = picked.filter((_, index) => kinds[index] === 'photo');

  if (picked.length === 0 || kinds.includes('other')) {
    return { ok: false, error: 'Please choose photos or a video.' };
  }
  if (videos.length > 0 && photos.length > 0) {
    return {
      ok: false,
      error: `Please choose either one video or up to ${SWAP_MAX_PHOTOS} photos, not both.`,
    };
  }
  if (videos.length > 1) {
    return { ok: false, error: 'Please choose just one video.' };
  }
  if (photos.length > SWAP_MAX_PHOTOS) {
    return {
      ok: false,
      error: `Please choose up to ${SWAP_MAX_PHOTOS} photos.`,
    };
  }

  const [video] = videos;
  if (video) {
    return {
      ok: true,
      media: {
        kind: 'video',
        uri: video.uri,
        durationMs:
          video.duration && video.duration > 0 ? video.duration : null,
      },
      label: 'Video selected',
    };
  }

  return {
    ok: true,
    media: {
      kind: 'photos',
      photos: photos.map((photo) => ({
        uri: photo.uri,
        width: photo.width ?? 0,
        height: photo.height ?? 0,
      })),
    },
    label:
      photos.length === 1
        ? '1 photo selected'
        : `${photos.length} photos selected`,
  };
}
