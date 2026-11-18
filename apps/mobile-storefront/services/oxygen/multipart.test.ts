import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';
import { createOxygenClient } from './client';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Directory: jest.fn().mockImplementation(() => ({
    create: jest.fn(),
    delete: jest.fn(),
  })),
  File: jest
    .fn()
    .mockImplementation(() => ({ create: jest.fn(), write: jest.fn() })),
  Paths: { cache: 'file:///cache' },
}));

const id = '11111111-1111-4111-8111-111111111111';
const file = {
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  type: 'image/png',
  name: 'signature.png',
};
const submission = {
  workflowId: id,
  version: 1,
  idempotencyKey: id,
  command: { action: 'approve_booking', otp: '123456', accepted: true },
} as const;
const transport = jest.fn();
const nativeFetch = jest.mocked(expoFetch);
const client = createOxygenClient({
  profile: {
    apiOrigin: 'https://staging.example',
    authOrigin: 'https://auth.example',
    merchantId: id,
    merchantSlug: 'shop',
  },
  getSession: async () => ({ access_token: 'test', user: { id } }),
  fetch: transport,
});

afterEach(() => {
  Object.assign(Platform, { OS: 'ios' });
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

it.each([
  'ios',
  'android',
])('uploads a real Expo file through Expo fetch on %s and cleans it up on HTTP failure', async (platform) => {
  Object.assign(Platform, { OS: platform });
  const append = jest
    .spyOn(FormData.prototype, 'append')
    .mockImplementation(() => {});
  nativeFetch.mockImplementationOnce(async () => {
    expect(jest.mocked(File).mock.results[0].value.write).toHaveBeenCalledWith(
      file.bytes
    );
    expect(
      jest.mocked(Directory).mock.results[0].value.delete
    ).not.toHaveBeenCalled();
    return { ok: false, status: 409, redirected: false, url: '' } as Awaited<
      ReturnType<typeof expoFetch>
    >;
  });

  await expect(client.action(submission, file)).rejects.toMatchObject({
    status: 409,
  });
  expect(File).toHaveBeenCalledWith(
    jest.mocked(Directory).mock.results[0].value,
    file.name
  );
  expect(append).toHaveBeenCalledWith(
    'file',
    jest.mocked(File).mock.results[0].value
  );
  expect(nativeFetch).toHaveBeenCalledWith(
    'https://staging.example/api/payments/oxygen/workflows/actions',
    expect.objectContaining({
      body: expect.any(FormData),
      redirect: 'error',
      credentials: 'omit',
    })
  );
  expect(transport).not.toHaveBeenCalled();
  expect(
    jest.mocked(Directory).mock.results[0].value.delete
  ).toHaveBeenCalledTimes(1);
});

it('uploads a browser Blob through browser fetch', async () => {
  Object.assign(Platform, { OS: 'web' });
  const append = jest
    .spyOn(FormData.prototype, 'append')
    .mockImplementation(() => {});
  transport.mockResolvedValueOnce(new Response(null, { status: 409 }));

  await expect(client.action(submission, file)).rejects.toMatchObject({
    status: 409,
  });
  expect(append).toHaveBeenCalledWith('file', expect.any(Blob), file.name);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(nativeFetch).not.toHaveBeenCalled();
  expect(Directory).not.toHaveBeenCalled();
});
