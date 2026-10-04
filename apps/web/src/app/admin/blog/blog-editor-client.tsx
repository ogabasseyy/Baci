'use client';
// Client component: handles editor state, uploads, and imperative navigation.

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  createPlatformBlogPost,
  updatePlatformBlogPost,
} from '@/app/admin/blog/blog-api';
import { BlogEditorFields } from '@/app/admin/blog/blog-editor-fields';
import { BlogReviewHandoffImporter } from '@/app/admin/blog/blog-review-handoff-importer';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogFormState,
  type PlatformAdminBlogPostDetail,
} from '@/app/admin/blog/blog-types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import { generateSlug } from '@/lib/blog-utils';

type BlogEditorClientProps = {
  initialPost?: PlatformAdminBlogPostDetail | null;
  mode: 'create' | 'edit';
  postId?: string;
};

type BlogMediaUploadResult = {
  height?: number | null;
  url: string;
  variants?: Record<string, string>;
  width?: number | null;
};

async function uploadBlogMedia(
  file: File,
  purpose: 'featured' | 'inline'
): Promise<BlogMediaUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);

  const response = await fetchWithCsrf('/api/admin/blog/upload', {
    body: formData,
    method: 'POST',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || 'Failed to upload image');
  }

  const payload = (await response.json()) as Partial<BlogMediaUploadResult>;
  if (!payload.url) {
    throw new Error('Upload response did not include a URL');
  }

  return {
    height: payload.height ?? null,
    url: payload.url,
    variants: payload.variants ?? {},
    width: payload.width ?? null,
  };
}

type SubmitBlogPostArgs = {
  form: PlatformAdminBlogFormState;
  isEditMode: boolean;
  postId?: string;
  initialPost?: PlatformAdminBlogPostDetail | null;
  setSaving: (saving: boolean) => void;
  toast: ReturnType<typeof useToast>['toast'];
  router: ReturnType<typeof useRouter>;
};

// Module-scope helper so the try/catch/finally control flow lives outside the
// component body, keeping it compilable by the React Compiler.
async function submitBlogPost({
  form,
  isEditMode,
  postId,
  initialPost,
  setSaving,
  toast,
  router,
}: SubmitBlogPostArgs): Promise<void> {
  try {
    setSaving(true);
    if (!form.title.trim() || !form.content.trim()) {
      throw new Error('Title and content are required');
    }

    const payload: PlatformAdminBlogFormState = {
      ...form,
      slug: form.slug.trim() || generateSlug(form.title.trim()),
    };

    if (isEditMode) {
      if (!postId) {
        throw new Error('Missing post id for edit mode');
      }
      await updatePlatformBlogPost(postId, payload, initialPost);
    } else {
      await createPlatformBlogPost(payload);
    }

    toast({ title: isEditMode ? 'Post updated' : 'Post created' });
    router.push('/admin/blog');
    router.refresh();
  } catch (error) {
    toast({
      title: 'Save failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      variant: 'destructive',
    });
  } finally {
    setSaving(false);
  }
}

function toFormState(
  post?: PlatformAdminBlogPostDetail | null
): PlatformAdminBlogFormState {
  if (!post) {
    return DEFAULT_PLATFORM_BLOG_FORM_STATE;
  }

  return {
    author_name: post.author_name || 'Baci Editorial',
    category: post.category || '',
    content: post.content || '',
    excerpt: post.excerpt || '',
    featured_image_alt: post.featured_image_alt || '',
    featured_image_height: post.featured_image_height ?? null,
    featured_image_url: post.featured_image_url || '',
    featured_image_variants: post.featured_image_variants ?? {},
    featured_image_width: post.featured_image_width ?? null,
    focus_keyword: post.focus_keyword ?? '',
    intent: post.intent ?? null,
    intent_source: post.intent_source ?? null,
    seo_description: post.seo_description || '',
    seo_title: post.seo_title || '',
    slug: post.slug,
    status: post.status,
    tags: post.tags?.join(', ') || '',
    title: post.title,
  };
}

export function BlogEditorClient({
  initialPost,
  mode,
  postId,
}: BlogEditorClientProps) {
  const isEditMode = mode === 'edit';
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [contentResetKey, setContentResetKey] = useState(0);
  const [uploadingFeatured, setUploadingFeatured] = useState(false);
  const [form, setForm] = useState<PlatformAdminBlogFormState>(
    toFormState(initialPost)
  );

  const pageTitle = isEditMode
    ? 'Edit Platform Blog Post'
    : 'New Platform Blog Post';

  const handleUploadFeatured = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      setUploadingFeatured(true);
      uploadBlogMedia(file, 'featured')
        .then((upload) => {
          setForm((current) => ({
            ...current,
            featured_image_height: upload.height ?? null,
            featured_image_url: upload.url,
            featured_image_variants: upload.variants ?? {},
            featured_image_width: upload.width ?? null,
          }));
          toast({ title: 'Featured image uploaded' });
        })
        .catch((error) => {
          toast({
            title: 'Upload failed',
            description:
              error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          });
        })
        .finally(() => {
          setUploadingFeatured(false);
        });
    };
    input.click();
  };

  const handleSubmit = () =>
    submitBlogPost({
      form,
      isEditMode,
      postId,
      initialPost,
      setSaving,
      toast,
      router,
    });

  if (isEditMode && !initialPost) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Post not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" className="px-0">
          <Link href="/admin/blog">
            <ArrowLeft className="mr-2 size-4" />
            Back to posts
          </Link>
        </Button>
        <h1 className="text-page-title">{pageTitle}</h1>
      </div>

      {!isEditMode && (
        <BlogReviewHandoffImporter
          onImport={(draft) => {
            const changed = Object.entries(form).some(
              ([key, value]) =>
                JSON.stringify(value) !==
                JSON.stringify(
                  DEFAULT_PLATFORM_BLOG_FORM_STATE[
                    key as keyof PlatformAdminBlogFormState
                  ]
                )
            );
            if (
              changed &&
              !window.confirm(
                'Replace your unsaved article with this review handoff?'
              )
            ) {
              return false;
            }
            setForm(draft);
            setContentResetKey((current) => current + 1);
            return true;
          }}
        />
      )}

      <BlogEditorFields
        contentResetKey={contentResetKey}
        form={form}
        isEditMode={isEditMode}
        onContentChange={(content) => {
          setForm((current) => ({ ...current, content }));
        }}
        onFormChange={(updater) => {
          setForm((current) =>
            typeof updater === 'function' ? updater(current) : updater
          );
        }}
        onInlineImageUpload={(file) =>
          uploadBlogMedia(file, 'inline').then((upload) => upload.url)
        }
        onSubmit={handleSubmit}
        onUploadFeatured={handleUploadFeatured}
        saving={saving}
        uploadingFeatured={uploadingFeatured}
      />
    </div>
  );
}
