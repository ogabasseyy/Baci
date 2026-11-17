import { describe, expect, it, vi } from 'vitest';
import { DEVICE_GRADING_MAX_UPLOAD_BYTES } from '@/schemas/device-grading';
import { encodeDeviceMedia, readDeviceMedia } from './read-device-media';

function file(bytes: number, type: string, name = 'media'): File {
  return new File([new Uint8Array(bytes).fill(1)], name, { type });
}

function upload(entries: [string, File | string][]): FormData {
  const formData = new FormData();
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
}

describe('readDeviceMedia', () => {
  it('accepts a video without reading its bytes', () => {
    const video = file(3, 'video/mp4');
    const arrayBuffer = vi.spyOn(video, 'arrayBuffer');

    const result = readDeviceMedia(upload([['video', video]]));

    expect(result).toMatchObject({ ok: true, merchantSlug: null });
    expect(result.ok && result.files).toHaveLength(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('prefers still frames over a video and keeps their order', async () => {
    const result = readDeviceMedia(
      upload([
        ['video', file(3, 'video/mp4')],
        ['frames', file(1, 'image/jpeg')],
        ['frames', file(2, 'image/webp')],
      ])
    );

    expect(result.ok && result.files.map((frame) => frame.type)).toEqual([
      'image/jpeg',
      'image/webp',
    ]);
  });

  it('encodes validated files as base64 parts in order', async () => {
    expect(
      await encodeDeviceMedia([file(1, 'image/jpeg'), file(3, 'video/mp4')])
    ).toEqual([
      { data: 'AQ==', mimeType: 'image/jpeg' },
      { data: 'AQEB', mimeType: 'video/mp4' },
    ]);
  });

  it('normalises the store slug and ignores a blank one', async () => {
    const named = readDeviceMedia(
      upload([
        ['video', file(3, 'video/mp4')],
        ['merchantSlug', '  OgaBassey '],
      ])
    );
    const blank = readDeviceMedia(
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
      readDeviceMedia(upload(entries as [string, File | string][]))
    ).toEqual({ ok: false, status: 400, error: 'No video file provided' });
  });

  it('rejects a video field that is not a video', async () => {
    expect(
      readDeviceMedia(upload([['video', file(3, 'application/pdf')]]))
    ).toEqual({ ok: false, status: 400, error: 'Unsupported file type' });
  });

  it('rejects a frame that is not a supported image', async () => {
    expect(
      readDeviceMedia(
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

    expect(readDeviceMedia(frames(6)).ok).toBe(true);
    expect(readDeviceMedia(frames(7))).toEqual({
      ok: false,
      status: 400,
      error: 'Too many images provided',
    });
  });

  it('applies the size budget to the total of all frames', async () => {
    const half = DEVICE_GRADING_MAX_UPLOAD_BYTES / 2;
    const atLimit = readDeviceMedia(
      upload([
        ['frames', file(half, 'image/jpeg')],
        ['frames', file(half, 'image/jpeg')],
      ])
    );
    const overLimit = readDeviceMedia(
      upload([
        ['frames', file(half, 'image/jpeg')],
        ['frames', file(half + 1, 'image/jpeg')],
      ])
    );

    expect(atLimit.ok).toBe(true);
    expect(overLimit).toMatchObject({ ok: false, status: 413 });
  });
});
