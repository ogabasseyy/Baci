const PHOTO_MAX_EDGE = 768;
const PHOTO_QUALITY = 0.8;
const LOAD_TIMEOUT_MS = 8_000;

const UNREADABLE_PHOTO = 'Photo could not be read';

function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(
      () => reject(new Error(UNREADABLE_PHOTO)),
      LOAD_TIMEOUT_MS
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error(UNREADABLE_PHOTO));
    };
    image.src = objectUrl;
  });
}

/**
 * Shrinks a device photo in the browser to a small JPEG. Phone photos are
 * several MB each, far above the device-check upload budget, so the resized
 * copy is uploaded instead. Rejects when the browser cannot decode the photo
 * (for example a HEIC file on a browser without HEIC support).
 */
export async function resizeDevicePhoto(photo: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(photo);
  try {
    const image = await loadImage(objectUrl);
    const { naturalWidth, naturalHeight } = image;
    if (!naturalWidth || !naturalHeight) throw new Error(UNREADABLE_PHOTO);

    const scale = Math.min(
      1,
      PHOTO_MAX_EDGE / Math.max(naturalWidth, naturalHeight)
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(naturalWidth * scale);
    canvas.height = Math.round(naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error(UNREADABLE_PHOTO);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_PHOTO))),
        'image/jpeg',
        PHOTO_QUALITY
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
