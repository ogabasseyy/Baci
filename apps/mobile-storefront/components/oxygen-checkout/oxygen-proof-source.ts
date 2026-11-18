import * as DocumentPicker from 'expo-document-picker';
import type { OxygenProofPicker } from './use-oxygen-proof';

export type OxygenProofSource = 'photos' | 'files';
let photoModule: Promise<typeof import('expo-image-picker')> | undefined;
/** Load while the upload choices are visible, not on the customer's first tap. */
export function warmOxygenPhotoPicker() {
  photoModule ??= import('expo-image-picker').catch((error: unknown) => {
    photoModule = undefined;
    throw error;
  });
  return photoModule;
}

export async function pickOxygenProofSource(
  source: OxygenProofSource = 'files'
): ReturnType<OxygenProofPicker['pick']> {
  if (source === 'files')
    return DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: false,
      multiple: false,
    });
  const { launchImageLibraryAsync } = await warmOxygenPhotoPicker();
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled) return { canceled: true };
  return {
    canceled: false,
    assets: result.assets.map((asset) => ({
      uri: asset.uri,
      name:
        asset.fileName ??
        (asset.mimeType === 'image/png'
          ? 'address-proof.png'
          : 'address-proof.jpg'),
      mimeType: asset.mimeType,
      size: asset.fileSize,
    })),
  };
}
