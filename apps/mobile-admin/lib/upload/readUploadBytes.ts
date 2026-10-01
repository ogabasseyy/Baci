/**
 * Reads a local picker URI into bytes suitable for Supabase Storage uploads.
 * Storage's React Native guidance recommends ArrayBuffer bodies.
 */
export async function readUploadBytes(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (response.ok === false) {
    throw new Error(
      'Unable to read the selected file. Please choose it again.'
    );
  }
  return response.arrayBuffer();
}
