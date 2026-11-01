import { NextResponse } from 'next/server';
import {
  BlogFeaturedImageError,
  generateFeaturedImageVariants,
} from '@/lib/blog-featured-image-variants';
import type { MediaDeletionClient } from '@/lib/media/delete-merchant-media';
import {
  cleanupUploadedPaths,
  getCanonicalBlogMediaUrl,
  toFeaturedUploadErrorResponse,
} from './upload-route-utils';

type FeaturedImageVariant = {
  url: string;
  path: string;
  width: number;
  height: number;
  contentType: string;
};

type FeaturedImageStorageClient = Pick<MediaDeletionClient, 'rpc'> & {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Buffer,
        options: { contentType: string; cacheControl: string; upsert: boolean }
      ): Promise<{ error: unknown | null }>;
      remove(paths: string[]): Promise<{ error: unknown | null }>;
    };
  };
};

type FeaturedImageUploadInput = {
  supabase: FeaturedImageStorageClient;
  merchantId: string;
  file: File;
  sourceBuffer: Buffer;
  fileToken: string;
  filename: string;
  filePath: string;
  uploadedPaths: string[];
};

export async function uploadFeaturedBlogImage(input: FeaturedImageUploadInput) {
  const {
    supabase,
    merchantId,
    file,
    sourceBuffer,
    fileToken,
    filename,
    filePath,
    uploadedPaths,
  } = input;
  let generated: Awaited<ReturnType<typeof generateFeaturedImageVariants>>;
  try {
    generated = await generateFeaturedImageVariants(sourceBuffer, {
      mimeType: file.type,
    });
  } catch (error) {
    if (error instanceof BlogFeaturedImageError) {
      return toFeaturedUploadErrorResponse(error);
    }
    throw error;
  }

  const { error: originalUploadError } = await supabase.storage
    .from('media')
    .upload(filePath, sourceBuffer, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
  if (originalUploadError) {
    console.error('Featured original upload failed', {
      merchantId,
      error: originalUploadError,
      purpose: 'featured',
      type: file.type,
      size: file.size,
    });
    return NextResponse.json(
      { error: 'Failed to upload file', code: 'UPLOAD_FAILED' },
      { status: 500 }
    );
  }
  uploadedPaths.push(filePath);

  const featuredImageVariants: Record<string, FeaturedImageVariant> = {};
  try {
    for (const variant of Object.values(generated.variants)) {
      const variantPath = `${merchantId}/blog/${fileToken}/${variant.key}.webp`;
      const { error: variantUploadError } = await supabase.storage
        .from('media')
        .upload(variantPath, variant.buffer, {
          contentType: variant.contentType,
          cacheControl: '31536000',
          upsert: false,
        });
      if (variantUploadError) throw variantUploadError;
      uploadedPaths.push(variantPath);
      featuredImageVariants[variant.key] = {
        url: getCanonicalBlogMediaUrl(variantPath, merchantId),
        path: variantPath,
        width: variant.width,
        height: variant.height,
        contentType: variant.contentType,
      };
    }
  } catch (error) {
    await cleanupUploadedPaths(supabase, merchantId, uploadedPaths);
    console.error('Featured variant upload failed; partial cleanup attempted', {
      merchantId,
      error,
      uploadedPaths,
    });
    return NextResponse.json(
      { error: 'Failed to upload file', code: 'UPLOAD_FAILED' },
      { status: 500 }
    );
  }

  console.info('Processed featured blog media upload', {
    merchantId,
    purpose: 'featured',
    sourceWidth: generated.source.width,
    sourceHeight: generated.source.height,
    sourceTotalPixels: generated.source.totalPixels,
    variantKeys: Object.keys(featuredImageVariants),
    size: file.size,
    type: file.type,
  });
  const variants = Object.fromEntries(
    Object.entries(featuredImageVariants).map(([key, value]) => [
      key,
      value.url,
    ])
  );
  const variantPaths = Object.fromEntries(
    Object.entries(featuredImageVariants).map(([key, value]) => [
      key,
      value.path,
    ])
  );
  return NextResponse.json({
    url: getCanonicalBlogMediaUrl(filePath, merchantId),
    path: filePath,
    filename,
    size: file.size,
    type: file.type,
    width: generated.source.width,
    height: generated.source.height,
    variants,
    variantPaths,
    featuredImageVariants,
  });
}
