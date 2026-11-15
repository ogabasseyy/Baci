const FRAME_COUNT = 4;
const FRAME_MAX_EDGE = 768;
const FRAME_QUALITY = 0.8;
const STEP_TIMEOUT_MS = 8_000;

function waitForEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(eventName, onDone);
      video.removeEventListener('error', onError);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video could not be read'));
    };
    const timer = setTimeout(onError, STEP_TIMEOUT_MS);
    video.addEventListener(eventName, onDone);
    video.addEventListener('error', onError);
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Video could not be read')),
      'image/jpeg',
      FRAME_QUALITY
    );
  });
}

/**
 * Pulls a few evenly spaced still frames out of a device video in the
 * browser. The stills (a few hundred KB) are uploaded instead of the clip,
 * which is usually far above the hosting platform's request-size limit.
 * Rejects when the browser cannot decode the video.
 */
export async function extractVideoFrames(videoFile: File): Promise<Blob[]> {
  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    const metadataLoaded = waitForEvent(video, 'loadedmetadata');
    video.src = objectUrl;
    await metadataLoaded;

    const { videoWidth, videoHeight } = video;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!videoWidth || !videoHeight) {
      throw new Error('Video could not be read');
    }

    const scale = Math.min(
      1,
      FRAME_MAX_EDGE / Math.max(videoWidth, videoHeight)
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(videoWidth * scale);
    canvas.height = Math.round(videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video could not be read');

    const frames: Blob[] = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const seeked = waitForEvent(video, 'seeked');
      video.currentTime = (duration * (index + 0.5)) / FRAME_COUNT;
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(await canvasToJpeg(canvas));
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
