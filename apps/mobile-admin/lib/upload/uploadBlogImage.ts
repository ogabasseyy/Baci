import { supabase } from '@/lib/supabase';
import { readUploadBytes } from './readUploadBytes';

/** Uploads a blog cover image to the merchant's storage namespace. */
export async function uploadBlogImage(
  uri: string,
  merchantId: string | undefined
): Promise<string> {
  const fileExt = uri.split('.').pop() || 'jpg';
  const fileName = `${merchantId}/blog/${Date.now()}.${fileExt}`;
  const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
  const fileData = await readUploadBytes(uri);

  const { error: uploadError } = await supabase.storage
    .from('merchant-assets')
    .upload(fileName, fileData, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('merchant-assets')
    .getPublicUrl(fileName);

  return data.publicUrl;
}
