import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
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

// Expo ImagePicker exports native photos to the app cache. File/provider
// URIs outside that directory may refer to a customer's original.
function isPhotoCacheCopy(uri: string): boolean {
  if (!uri.startsWith('file:///')) return false;
  const cache = new URL(Paths.cache.uri).href.replace(/\/+$/, '');
  const path = new URL(uri).href;
  const prefix = `${cache}/`;
  return (
    path.startsWith(prefix) && /^[a-z\d._/-]+$/i.test(path.slice(prefix.length))
  );
}

export async function pickOxygenProofSource(
  source: OxygenProofSource = 'files'
): ReturnType<OxygenProofPicker['pick']> {
  if (source === 'files') {
    const result = await getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return { canceled: true };
    return {
      canceled: false,
      assets: result.assets.map((asset) => ({
        ...asset,
        release: () => new File(asset.uri).delete(),
      })),
    };
  }
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
      ...(isPhotoCacheCopy(asset.uri)
        ? { release: () => new File(asset.uri).delete() }
        : {}),
    })),
  };
}
