import { Platform } from 'react-native';
import { appendOxygenFile } from './multipart';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const file = {
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  type: 'image/png',
  name: 'signature.png',
};
afterEach(() => {
  Object.assign(Platform, { OS: 'ios' });
  jest.restoreAllMocks();
});
it('uses an Expo-compatible in-memory file part on native', async () => {
  const form = new FormData();
  const append = jest.spyOn(form, 'append');
  appendOxygenFile(form, file);
  expect(append).toHaveBeenCalledWith('file', {
    name: 'signature.png',
    type: 'image/png',
    bytes: expect.any(Function),
  });
  const part = append.mock.calls[0][1] as unknown as {
    bytes: () => Promise<Uint8Array>;
  };
  expect(await part.bytes()).toEqual(file.bytes);
});
it('uses the browser Blob contract on web instead of stringifying a native file part', () => {
  Object.assign(Platform, { OS: 'web' });
  const form = new FormData();
  const append = jest.spyOn(form, 'append');
  appendOxygenFile(form, file);
  expect(append).toHaveBeenCalledWith(
    'file',
    expect.any(Blob),
    'signature.png'
  );
});
