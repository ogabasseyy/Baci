import { describe, expect, it } from 'vitest';
import { DEVICE_GRADING_MAX_UPLOAD_BYTES } from '@/schemas/device-grading';
import { readDeviceMedia } from './read-device-media';

function file(bytes: number, type: string, name = 'media'): File {
  return new File([new Uint8Array(bytes).fill(1)], name, { type });
}

function upload(entries: [string, File | string][]): FormData {
  const formData = new FormData();
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
}

describe('readDeviceMedia', () => {
  it('reads a video as one base64 part', async () => {
    const result = await readDeviceMedia(
      upload([['video', file(3, 'video/mp4')]])
    );

    expect(result).toEqual({
      ok: true,
      merchantSlug: null,
      parts: [{ data: 'AQEB', mimeType: 'video/mp4' }],
    });
  });

  it('prefers still frames over a video and keeps their order', async () => {
    const result = await readDeviceMedia(
      upload([
        ['video', file(3, 'video/mp4')],
        ['frames', file(1, 'image/jpeg')],
        ['frames', file(2, 'image/webp')],
      ])
    );

    expect(result).toMatchObject({
      ok: true,
      parts: [
        { data: 'AQ==', mimeType: 'image/jpeg' },
        { data: 'AQE=', mimeType: 'image/webp' },
      ],
    });
  });

  it('normalises the store slug and ignores a blank one', async () => {
    const named = await readDeviceMedia(
      upload([
        ['video', file(3, 'video/mp4')],
        ['merchantSlug', '  OgaBassey '],
      ])
    );
    const blank = await readDeviceMedia(
      upload([
        ['video', file(3, 'video/mp4')],
        ['merchantSlug', '   '],
      ])
    );

    expect(named).toMatchObject({ ok: true, merchantSlug: 'ogabassey' });
    expect(blank).toMatchObject({ ok: true, merchantSlug: null });
  });

  it.each([
    ['nothing is uploaded', [] as [string, File | string][]],
    ['the video field is text', [['video', 'not-a-file']]],
    ['the video is empty', [['video', file(0, 'video/mp4')]]],
  ])('returns 400 when %s', async (_label, entries) => {
    expect(
      await readDeviceMedia(upload(entries as [string, File | string][]))
    ).toEqual({ ok: false, status: 400, error: 'No video file provided' });
  });

  it('rejects a video field that is not a video', async () => {
    expect(
      await readDeviceMedia(upload([['video', file(3, 'application/pdf')]]))
    ).toEqual({ ok: false, status: 400, error: 'Unsupported file type' });
  });

  it('rejects a frame that is not a supported image', async () => {
    expect(
      await readDeviceMedia(
        upload([
          ['frames', file(3, 'image/jpeg')],
          ['frames', file(3, 'image/svg+xml')],
        ])
      )
    ).toEqual({ ok: false, status: 400, error: 'Unsupported file type' });
  });

  it('accepts six frames and rejects a seventh', async () => {
    const frames = (count: number) =>
      upload(
        Array.from({ length: count }, () => [
          'frames',
          file(1, 'image/png'),
        ]) as [string, File][]
      );

    expect((await readDeviceMedia(frames(6))).ok).toBe(true);
    expect(await readDeviceMedia(frames(7))).toEqual({
      ok: false,
      status: 400,
      error: 'Too many images provided',
    });
  });

  it('applies the size budget to the total of all frames', async () => {
    const half = DEVICE_GRADING_MAX_UPLOAD_BYTES / 2;
    const atLimit = await readDeviceMedia(
      upload([
        ['frames', file(half, 'image/jpeg')],
        ['frames', file(half, 'image/jpeg')],
      ])
    );
    const overLimit = await readDeviceMedia(
      upload([
        ['frames', file(half, 'image/jpeg')],
        ['frames', file(half + 1, 'image/jpeg')],
      ])
    );

    expect(atLimit.ok).toBe(true);
    expect(overLimit).toMatchObject({ ok: false, status: 413 });
  });
});
