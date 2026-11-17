import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithCsrf: vi.fn(),
  extractVideoFrames: vi.fn(),
  resizeDevicePhoto: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetchWithCsrf }));
vi.mock('@/lib/storefront/extract-video-frames', () => ({
  extractVideoFrames: mocks.extractVideoFrames,
}));
vi.mock('@/lib/storefront/resize-device-photo', () => ({
  resizeDevicePhoto: mocks.resizeDevicePhoto,
}));

import { DEVICE_GRADING_MAX_UPLOAD_BYTES } from '@/schemas/device-grading';
import { requestDeviceGrading } from './request-device-grading';

const result = {
  model: 'iPhone 14',
  grade: 'Good' as const,
  observations: [],
  basePrice: 400000,
  estimatedValue: 320000,
  deductionPercent: 20,
  matchedProduct: 'iPhone 14',
};

function smallVideo(): File {
  return new File(['video'], 'device.mp4', { type: 'video/mp4' });
}

function sentBody(): FormData {
  const request = mocks.fetchWithCsrf.mock.calls[0]?.[1] as RequestInit;
  expect(request).toMatchObject({ method: 'POST' });
  return request.body as FormData;
}

describe('requestDeviceGrading', () => {
  afterEach(() => vi.clearAllMocks());

  it('uploads still frames instead of the full video', async () => {
    const frames = [
      new Blob(['a'], { type: 'image/jpeg' }),
      new Blob(['b'], { type: 'image/jpeg' }),
    ];
    mocks.extractVideoFrames.mockResolvedValue(frames);
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({ data: result }),
    });

    await expect(
      requestDeviceGrading([smallVideo()], 'ogabassey')
    ).resolves.toEqual(result);

    const body = sentBody();
    expect(body.getAll('frames')).toHaveLength(2);
    expect(body.get('video')).toBeNull();
    expect(body.get('merchantSlug')).toBe('ogabassey');
  });

  it('falls back to a small video when the browser cannot read frames', async () => {
    mocks.extractVideoFrames.mockRejectedValue(new Error('unsupported'));
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({ data: result }),
    });
    const video = smallVideo();

    await requestDeviceGrading([video]);

    const body = sentBody();
    expect((body.get('video') as File).name).toBe('device.mp4');
    expect(body.getAll('frames')).toHaveLength(0);
  });

  it('does not upload a large video the server would reject', async () => {
    mocks.extractVideoFrames.mockRejectedValue(new Error('unsupported'));
    const largeVideo = new File(
      [new Uint8Array(DEVICE_GRADING_MAX_UPLOAD_BYTES + 1)],
      'device.mov',
      {
        type: 'video/quicktime',
      }
    );

    await expect(requestDeviceGrading([largeVideo])).rejects.toThrow(
      /could not read this video/i
    );
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('uploads each photo as a resized still and never as a video', async () => {
    const photos = [
      new File(['front'], 'front.heic', { type: 'image/heic' }),
      new File(['back'], 'back.jpg', { type: 'image/jpeg' }),
    ];
    mocks.resizeDevicePhoto.mockImplementation(
      async () => new Blob(['small'], { type: 'image/jpeg' })
    );
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({ data: result }),
    });

    await expect(requestDeviceGrading(photos, 'ogabassey')).resolves.toEqual(
      result
    );

    const frames = sentBody().getAll('frames') as File[];
    expect(frames.map((frame) => [frame.name, frame.type])).toEqual([
      ['frame-1.jpg', 'image/jpeg'],
      ['frame-2.jpg', 'image/jpeg'],
    ]);
    expect(sentBody().get('video')).toBeNull();
    expect(mocks.extractVideoFrames).not.toHaveBeenCalled();
  });

  it('stops without uploading when a photo cannot be read', async () => {
    mocks.resizeDevicePhoto.mockRejectedValue(new Error('unsupported'));

    await expect(
      requestDeviceGrading([
        new File(['front'], 'front.heic', { type: 'image/heic' }),
      ])
    ).rejects.toThrow(/could not read one of your photos/i);
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a video mixed with a photo',
      [
        new File(['video'], 'device.mp4', { type: 'video/mp4' }),
        new File(['front'], 'front.jpg', { type: 'image/jpeg' }),
      ],
      /either one video or up to 6 photos/i,
    ],
    [
      'a file that is neither a photo nor a video',
      [new File(['x'], 'notes.pdf', { type: 'application/pdf' })],
      /choose photos or a video/i,
    ],
    ['nothing', [], /choose photos or a video/i],
  ])('refuses %s without reading or uploading anything', async (_label, media, message) => {
    await expect(requestDeviceGrading(media)).rejects.toThrow(message);
    expect(mocks.extractVideoFrames).not.toHaveBeenCalled();
    expect(mocks.resizeDevicePhoto).not.toHaveBeenCalled();
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('throws the API error when grading is rejected', async () => {
    mocks.extractVideoFrames.mockResolvedValue([new Blob(['a'])]);
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Video is unreadable' }),
    });

    await expect(requestDeviceGrading([smallVideo()])).rejects.toThrow(
      'Video is unreadable'
    );
  });

  it('shows a plain message when the server reply is not JSON', async () => {
    mocks.extractVideoFrames.mockResolvedValue([new Blob(['a'])]);
    mocks.fetchWithCsrf.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token R in JSON');
      },
    });

    await expect(requestDeviceGrading([smallVideo()])).rejects.toThrow(
      'We could not check this device right now. Please try again.'
    );
  });
});
