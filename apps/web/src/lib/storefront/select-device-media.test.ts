import { describe, expect, it } from 'vitest';
import { selectDeviceMedia } from './select-device-media';

function photo(name = 'front.jpg'): File {
  return new File(['photo'], name, { type: 'image/jpeg' });
}

function video(name = 'device.mp4'): File {
  return new File(['video'], name, { type: 'video/mp4' });
}

describe('selectDeviceMedia', () => {
  it('accepts one video and labels it by name', () => {
    const clip = video();

    expect(selectDeviceMedia([clip])).toEqual({
      ok: true,
      files: [clip],
      label: 'device.mp4',
    });
  });

  it('accepts a single photo', () => {
    const front = photo();

    expect(selectDeviceMedia([front])).toEqual({
      ok: true,
      files: [front],
      label: '1 photo selected',
    });
  });

  it('accepts up to six photos and counts them', () => {
    const photos = Array.from({ length: 6 }, (_, i) => photo(`p${i}.jpg`));

    expect(selectDeviceMedia(photos)).toEqual({
      ok: true,
      files: photos,
      label: '6 photos selected',
    });
  });

  it('refuses more than six photos', () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo(`p${i}.jpg`));

    expect(selectDeviceMedia(photos)).toEqual({
      ok: false,
      error: 'Please choose up to 6 photos.',
    });
  });

  it('refuses a mix of photos and a video', () => {
    expect(selectDeviceMedia([photo(), video()])).toEqual({
      ok: false,
      error: 'Please choose either one video or up to 6 photos, not both.',
    });
  });

  it('refuses more than one video', () => {
    expect(selectDeviceMedia([video('a.mp4'), video('b.mp4')])).toEqual({
      ok: false,
      error: 'Please choose just one video.',
    });
  });

  it('refuses a video above 50MB', () => {
    const huge = video('huge.mp4');
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1 });

    expect(selectDeviceMedia([huge])).toEqual({
      ok: false,
      error: 'Video is too large. Please keep it under 50MB and 15 seconds.',
    });
  });

  it('refuses a photo above 25MB', () => {
    const huge = photo('huge.jpg');
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 + 1 });

    expect(selectDeviceMedia([photo(), huge])).toEqual({
      ok: false,
      error: 'One of your photos is too large. Please keep each under 25MB.',
    });
  });

  it.each([
    ['nothing', []],
    [
      'a file that is neither a photo nor a video',
      [new File(['x'], 'notes.pdf', { type: 'application/pdf' })],
    ],
  ])('refuses %s', (_label, files) => {
    expect(selectDeviceMedia(files)).toEqual({
      ok: false,
      error: 'Please choose photos or a video.',
    });
  });
});
