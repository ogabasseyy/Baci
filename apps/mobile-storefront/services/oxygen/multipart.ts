import type { OxygenTransientFile } from '@baci/shared/oxygen';
import { Platform } from 'react-native';

export function appendOxygenFile(form: FormData, file: OxygenTransientFile) {
  // Browser FormData stringifies native URI descriptors; native Blob rejects
  // typed-array parts. Keep this transport-only divergence shared by iOS/Android.
  if (Platform.OS === 'web') {
    form.append(
      'file',
      new Blob([new Uint8Array(file.bytes)], { type: file.type }),
      file.name
    );
  } else {
    // Expo's fetch accepts a file-like object with bytes(); URI descriptors are
    // rejected by its multipart encoder. Keep the evidence in memory.
    form.append('file', {
      name: file.name,
      type: file.type,
      bytes: async () => file.bytes,
    } as unknown as Blob);
  }
}
