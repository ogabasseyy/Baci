import { NextRequest } from 'next/server';

const ROUTE_URL = 'https://ogabassey.com/api/ai/grade-device';

export function videoUpload(bytes = 3): FormData {
  const formData = new FormData();
  formData.append(
    'video',
    new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }),
    'device-video.mp4'
  );
  return formData;
}

export function framesUpload(count: number, type = 'image/jpeg'): FormData {
  const formData = new FormData();
  for (let index = 0; index < count; index += 1) {
    formData.append(
      'frames',
      new Blob([new Uint8Array([1, 2, 3])], { type }),
      `frame-${index + 1}.jpg`
    );
  }
  return formData;
}

/** Sent the way the mobile app sends it: no cookie, no CSRF header. */
export function post(body: FormData): NextRequest {
  return new NextRequest(ROUTE_URL, { method: 'POST', body });
}

/** Sent the way a browser sends it: with the shopper's cookies. */
export function postWithCookies(body: FormData): NextRequest {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    body,
    headers: { cookie: 'sid=abc' },
  });
}
