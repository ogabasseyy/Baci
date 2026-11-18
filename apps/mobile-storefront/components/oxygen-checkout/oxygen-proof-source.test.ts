import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { pickOxygenProofSource } from './oxygen-proof-source';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }), {
  virtual: true,
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
it('opens the document picker with the accepted proof formats', async () => {
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  await pickOxygenProofSource('files');
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
    type: ['application/pdf', 'image/jpeg', 'image/png'],
    copyToCacheDirectory: false,
    multiple: false,
  });
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
