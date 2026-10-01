/**
 * React Native file upload types.
 *
 * React Native image pickers return local URIs. Transport helpers convert those
 * assets to native-supported file parts or ArrayBuffers before they are sent.
 */

/**
 * Describes a picked local file before it is converted for transport.
 */
export interface RNFile {
  /** Local file URI (e.g., file://, content://, or ph:// on iOS) */
  uri: string;
  /** File name with extension */
  name: string;
  /** MIME type (e.g., 'image/jpeg', 'image/png') */
  type: string;
}

/** Legacy FormData value type for callers that still use native XHR. */
export type FormDataValue = string | RNFile;

/** Legacy React Native FormData shape. */
export interface RNFormData extends Omit<FormData, 'append'> {
  append(name: string, value: string | Blob | RNFile, fileName?: string): void;
}
