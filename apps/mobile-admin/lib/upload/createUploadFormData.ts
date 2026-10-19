import { File as ExpoFile } from 'expo-file-system';
import type { RNFile } from '@/types/upload';

type ExpoFilePart = {
  bytes: () => ReturnType<ExpoFile['bytes']>;
  name: string;
  type: string;
};

type ExpoUploadFormData = FormData & {
  append(name: string, value: ExpoFilePart, filename?: string): void;
};

/**
 * Builds a multipart body that Expo's Winter fetch can serialize.
 *
 * React Native URI descriptors and Blob constructors backed by ArrayBuffers
 * are not supported by the native fetch bridge. Expo File implements the
 * native `bytes()` contract consumed by Winter fetch without copying the file
 * into a JS Blob first.
 */
export function createUploadFormData(file: RNFile): FormData {
  const formData = new FormData() as ExpoUploadFormData;
  const nativeFile = new ExpoFile(file.uri);
  const filePart: ExpoFilePart = {
    bytes: () => nativeFile.bytes(),
    name: file.name,
    type: file.type,
  };
  formData.append('file', filePart, file.name);
  return formData;
}
