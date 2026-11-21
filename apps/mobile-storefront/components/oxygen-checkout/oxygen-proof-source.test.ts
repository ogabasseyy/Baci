import type { DocumentPickerResult } from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { pickOxygenProofSource } from './oxygen-proof-source';

const mockGetDocumentAsync = jest.fn<
  Promise<DocumentPickerResult>,
  [unknown]
>();
const mockDeleteCopy = jest.fn();
const mockFile = jest.fn<void, [string]>();

jest.mock(
  'expo-document-picker',
  () => ({
    getDocumentAsync: (options: unknown) => mockGetDocumentAsync(options),
  }),
  { virtual: true }
);
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///app/cache/' } },
  File: class {
    constructor(uri: string) {
      mockFile(uri);
    }

    delete = mockDeleteCopy;
  },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
it('opens the document picker with the accepted proof formats', async () => {
  mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
  await pickOxygenProofSource('files');
  expect(mockGetDocumentAsync).toHaveBeenCalledWith({
    type: ['application/pdf', 'image/jpeg', 'image/png'],
    copyToCacheDirectory: true,
    multiple: false,
  });
});
it('releases the document picker cache copy', async () => {
  const uri = 'file:///cache/proof.pdf';
  mockGetDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [
      { uri, name: 'proof.pdf', mimeType: 'application/pdf', lastModified: 0 },
    ],
  });
  const result = await pickOxygenProofSource('files');
  expect(mockDeleteCopy).not.toHaveBeenCalled();
  result.assets?.[0]?.release?.();
  expect(mockFile).toHaveBeenCalledWith(uri);
  expect(mockDeleteCopy).toHaveBeenCalledTimes(1);
});
it('normalizes a gallery image for the existing proof validation', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///proof.png',
        width: 100,
        height: 100,
        mimeType: 'image/png',
        fileSize: 200,
      },
    ],
  });
  expect(await pickOxygenProofSource('photos')).toEqual({
    canceled: false,
    assets: [
      {
        uri: 'file:///proof.png',
        name: 'address-proof.png',
        mimeType: 'image/png',
        size: 200,
      },
    ],
  });
});

it('preserves cancellation from the gallery', async () => {
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  expect(await pickOxygenProofSource('photos')).toEqual({ canceled: true });
});

it('releases the image picker cache copy only after the reader requests cleanup', async () => {
  const uri = 'file:///app/cache/ImagePicker/proof.png';
  mockFile.mockClear();
  mockDeleteCopy.mockClear();
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri, width: 100, height: 100, mimeType: 'image/png' }],
  });

  const result = await pickOxygenProofSource('photos');
  expect(mockDeleteCopy).not.toHaveBeenCalled();
  result.assets?.[0]?.release?.();
  expect(mockFile).toHaveBeenCalledWith(uri);
  expect(mockDeleteCopy).toHaveBeenCalledTimes(1);
});

it.each([
  'file:///app/original.png',
  'file:///app/cache/../original.png',
  'content://media/external/images/1',
])('does not schedule deletion of a gallery original outside the cache: %s', async (uri) => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri, width: 100, height: 100, mimeType: 'image/png' }],
  });
  const result = await pickOxygenProofSource('photos');
  expect(result.assets?.[0]?.release).toBeUndefined();
});
