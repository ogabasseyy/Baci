import type { OxygenTransientFile } from '@baci/shared/oxygen';
import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export function prepareOxygenMultipart(
  body: unknown,
  file: OxygenTransientFile
) {
  const form = new FormData();
  form.append('payload', JSON.stringify(body));
  if (Platform.OS === 'web') {
    form.append(
      'file',
      new Blob([new Uint8Array(file.bytes)], { type: file.type }),
      file.name
    );
    return { form };
  }

  // Expo fetch reads the File bytes before dispatch. Keep the copy in the
  // app's private cache and delete it as soon as the request settles.
  const directory = new Directory(Paths.cache, `oxygen-upload-${randomUUID()}`);
  directory.create();
  const dispose = () => {
    try {
      directory.delete();
    } catch {
      // Cleanup failure must not change the outcome of a dispatched request.
    }
  };
  try {
    const source = new File(directory, file.name);
    source.create();
    source.write(file.bytes);
    form.append('file', source);
    return { form, fetch: expoFetch, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
