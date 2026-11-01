import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';

import { loadMediaDeletionStates } from '@/lib/media/load-media-deletion-states';

const BUCKET_NAME = 'media';

// Security constants for file upload
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max file size
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

// File extension to MIME type mapping for validation
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export async function GET(_request: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  // Get current user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get merchant (supports both owners and staff)
  const merchantContext = await getMerchantForApiRequest(supabase, user.id);
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  // Permission check
  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'products', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const merchantId = merchantContext.merchantId;

  // List files from Supabase Storage
  const merchantFolder = `${merchantId}/`;

  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET_NAME)
    .list(merchantFolder, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (listError) {
    console.error('Error listing files:', listError);
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    );
  }

  // Get public URLs for all files
  const filesWithUrls = files.map((file) => {
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(`${merchantFolder}${file.name}`);

    return {
      id: file.id,
      name: file.name,
      url: urlData.publicUrl,
      size: file.metadata?.size || 0,
      type: file.metadata?.mimetype || 'image/*',
      createdAt: file.created_at || new Date().toISOString(),
    };
  });

  const qualifiedFiles = await loadMediaDeletionStates(
    supabase,
    merchantId,
    filesWithUrls
  );
  if (!qualifiedFiles)
    return NextResponse.json(
      { error: 'Unable to load deletion status' },
      { status: 503 }
    );
  return NextResponse.json({ files: qualifiedFiles });
}

export async function POST(request: NextRequest) {
  // CSRF Protection
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid && response) {
    return response;
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  // Get current user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get merchant (supports both owners and staff)
  const merchantContext = await getMerchantForApiRequest(supabase, user.id);
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  // Permission check
  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'products', 'create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const merchantId = merchantContext.merchantId;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 }
      );
    }

    // Validate file type against whitelist
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: 'Invalid file type. Allowed types: JPEG, PNG, GIF, WebP, SVG',
        },
        { status: 400 }
      );
    }

    // Validate file extension matches MIME type (prevents extension spoofing)
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (
      !ext ||
      !EXTENSION_TO_MIME[ext] ||
      EXTENSION_TO_MIME[ext] !== file.type
    ) {
      return NextResponse.json(
        {
          error: 'File extension does not match file type',
        },
        { status: 400 }
      );
    }

    // Generate unique filename with sanitized extension
    const timestamp = Date.now();
    const randomStr = crypto.randomUUID().replace(/-/g, '');
    const fileName = `${timestamp}-${randomStr}.${ext}`;
    const filePath = `${merchantId}/${fileName}`;

    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Upload error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return NextResponse.json({
      success: true,
      file: {
        id: data.id || fileName,
        name: fileName,
        url: urlData.publicUrl,
        size: file.size,
        type: file.type,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error('Upload error:', error);
    const message = 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export { DELETE } from './delete';
