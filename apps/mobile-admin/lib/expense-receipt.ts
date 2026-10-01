import * as Crypto from 'expo-crypto';
import { assertOwnedExpenseReceiptPath } from '@/lib/expense-receipt-path';
import { supabase } from '@/lib/supabase';

const BUCKET = 'expense-receipts';
const LOCAL_URI_PATTERN = /^(?:file|content|ph):\/\//i;
const EXTENSION_MIME_TYPES: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const MIME_TYPE_EXTENSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_MIME_TYPES).map(([extension, mimeType]) => [
    mimeType,
    extension === 'jpeg' ? 'jpg' : extension,
  ])
);

function receiptExtension(
  localUri: string,
  fileName?: string | null,
  mimeType?: string | null
): string {
  const mimeExtension = mimeType
    ? MIME_TYPE_EXTENSIONS[
        mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
      ]
    : undefined;
  if (mimeExtension) return mimeExtension;

  const pathname = (fileName ?? localUri).split(/[?#]/, 1)[0] ?? '';
  const candidateName = pathname.split('/').pop() ?? '';
  const extension = candidateName.includes('.')
    ? (candidateName.split('.').pop()?.toLowerCase() ?? '')
    : '';

  if (!extension && /^(?:content|ph):\/\//i.test(localUri)) {
    return 'jpg';
  }

  if (!EXTENSION_MIME_TYPES[extension]) {
    throw new Error('Receipt image type is not supported');
  }

  return extension;
}

export const expenseReceiptStorage = {
  async upload(
    merchantId: string,
    localUri: string,
    metadata?: { fileName?: string | null; mimeType?: string | null }
  ): Promise<{ storagePath: string }> {
    if (!LOCAL_URI_PATTERN.test(localUri)) {
      throw new Error('Receipt uploads must use a local file URI');
    }

    const extension = receiptExtension(
      localUri,
      metadata?.fileName,
      metadata?.mimeType
    );
    const fileName = `${Crypto.randomUUID()}.${extension}`;
    const storagePath = `${merchantId}/expenses/${fileName}`;
    assertOwnedExpenseReceiptPath(merchantId, storagePath);
    const contentType = EXTENSION_MIME_TYPES[extension];
    const response = await fetch(localUri);
    if (!response.ok) {
      throw new Error('Failed to read expense receipt');
    }
    const fileData = await response.arrayBuffer();

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileData, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error('Failed to upload expense receipt');
    }

    return { storagePath };
  },

  async removeOwned(merchantId: string, storagePath: string): Promise<void> {
    assertOwnedExpenseReceiptPath(merchantId, storagePath);

    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);

    if (error) {
      throw new Error('Failed to remove expense receipt');
    }
  },
};
