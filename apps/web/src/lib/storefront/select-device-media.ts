import { DEVICE_GRADING_MAX_FRAMES } from '@/schemas/device-grading';

/**
 * Local cap for a picked clip. The clip stays on the device and only still
 * frames are uploaded, so this is not the (much smaller) server upload budget.
 */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type DeviceMediaSelection =
  | { ok: true; files: File[]; label: string }
  | { ok: false; error: string };

/**
 * A device check takes either one video or a few photos, never a mix: the
 * server grades one set of stills, taken from the clip or sent as photos.
 */
export function selectDeviceMedia(picked: File[]): DeviceMediaSelection {
  const videos = picked.filter((file) => file.type.startsWith('video/'));
  const photos = picked.filter((file) => file.type.startsWith('image/'));

  if (picked.length === 0 || videos.length + photos.length !== picked.length) {
    return { ok: false, error: 'Please choose photos or a video.' };
  }
  if (videos.length > 0 && photos.length > 0) {
    return {
      ok: false,
      error: `Please choose either one video or up to ${DEVICE_GRADING_MAX_FRAMES} photos, not both.`,
    };
  }
  if (videos.length > 1) {
    return { ok: false, error: 'Please choose just one video.' };
  }
  if (photos.length > DEVICE_GRADING_MAX_FRAMES) {
    return {
      ok: false,
      error: `Please choose up to ${DEVICE_GRADING_MAX_FRAMES} photos.`,
    };
  }

  const [video] = videos;
  if (video) {
    if (video.size > MAX_VIDEO_BYTES) {
      return {
        ok: false,
        error: 'Video is too large. Please keep it under 50MB and 15 seconds.',
      };
    }
    return { ok: true, files: [video], label: video.name };
  }

  return {
    ok: true,
    files: photos,
    label:
      photos.length === 1
        ? '1 photo selected'
        : `${photos.length} photos selected`,
  };
}
