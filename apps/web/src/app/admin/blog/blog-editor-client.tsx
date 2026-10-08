'use client';
// Client component: handles editor state, uploads, and imperative navigation.

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type RefObject, useRef, useState } from 'react';
import {
  createPlatformBlogPost,
  deleteBlogMediaUpload,
  updatePlatformBlogPost,
} from '@/app/admin/blog/blog-api';
import { BlogEditorFields } from '@/app/admin/blog/blog-editor-fields';
import { BlogReviewHandoffImporter } from '@/app/admin/blog/blog-review-handoff-importer';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogCoverState,
  type PlatformAdminBlogFormState,
  type PlatformAdminBlogPostDetail,
} from '@/app/admin/blog/blog-types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { generateSlug } from '@/lib/blog-utils';
import { uploadBlogMedia } from './blog-media-upload';
import { useBlogFeaturedImageUpload } from './use-blog-featured-image-upload';
import { useBlogInlineImageUpload } from './use-blog-inline-image-upload';
import { useBlogReviewHandoffImport } from './use-blog-review-handoff-import';

type BlogEditorClientProps = {
  initialPost?: PlatformAdminBlogPostDetail | null;
  mode: 'create' | 'edit';
  postId?: string;
};

type SubmitBlogPostArgs = {
  form: PlatformAdminBlogFormState;
  isEditMode: boolean;
  postId?: string;
  initialPost?: PlatformAdminBlogPostDetail | null;
  savedFormRef: RefObject<PlatformAdminBlogFormState | null>;
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
  savedFormRef,
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

    // Snapshot the submitted payload (frozen before the request, so
    // edits made while saving cannot shrink it) and protect it while
    // the mutation is in flight: leaving the page before the request
    // resolves must retain what the server is about to persist.
    const previousSaved = savedFormRef.current;
    savedFormRef.current = payload;
    try {
      if (isEditMode) {
        if (!postId) {
          throw new Error('Missing post id for edit mode');
        }
        await updatePlatformBlogPost(postId, payload, initialPost);
      } else {
        await createPlatformBlogPost(payload);
      }
    } catch (error) {
      // A failed save restores the previous snapshot (when no later
      // save replaced it) so teardown deletes the abandoned draft
      // instead of leaking it as falsely persisted.
      if (savedFormRef.current === payload) {
        savedFormRef.current = previousSaved;
      }
      throw error;
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
    featured_image_alt_edited: false,
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
  const contentGenerationRef = useRef(0);
  const coverStashRef = useRef<PlatformAdminBlogCoverState | null>(null);
  const pendingContentEditRef = useRef(false);
  const [form, setForm] = useState<PlatformAdminBlogFormState>(
    toFormState(initialPost)
  );
  // Last payload the server confirmed: the unmount delete flush
  // retains only this, since live-form references are unpersisted by
  // definition once the page is left.
  const savedFormRef = useRef<PlatformAdminBlogFormState | null>(null);
  const {
    uploadingFeatured,
    uploadFeatured,
    cleanupSettledSessionUploads,
    invalidateFeaturedUploads,
    noteAltEdit,
  } = useBlogFeaturedImageUpload({
    coverStashRef,
    deleteUpload: ({ path, variantPaths }) =>
      deleteBlogMediaUpload(path, variantPaths),
    savedFormRef,
    upload: (file) => uploadBlogMedia(file, 'featured'),
    setForm,
    toast,
  });
  const {
    cleanupSettledInlineUploads,
    inlineUploadsPending,
    uploadInlineImage,
  } = useBlogInlineImageUpload({
    deleteUpload: ({ path, variantPaths }) =>
      deleteBlogMediaUpload(path, variantPaths),
    savedFormRef,
    upload: (file) => uploadBlogMedia(file, 'inline'),
  });
  const handleReviewHandoffImport = useBlogReviewHandoffImport({
    cleanupSettledInlineUploads,
    cleanupSettledSessionUploads,
    contentGenerationRef,
    coverStashRef,
    form,
    inlineUploadsPending,
    invalidateFeaturedUploads,
    pendingContentEditRef,
    saving,
    setContentResetKey,
    setForm,
  });

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

      void uploadFeatured(file);
    };
    input.click();
  };

  const handleSubmit = () =>
    submitBlogPost({
      form,
      isEditMode,
      postId,
      initialPost,
      savedFormRef,
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
          disabled={saving || inlineUploadsPending}
          onImport={handleReviewHandoffImport}
        />
      )}

      <BlogEditorFields
        contentResetKey={contentResetKey}
        contentGenerationRef={contentGenerationRef}
        coverStashRef={coverStashRef}
        initialCover={
          initialPost
            ? {
                alt: initialPost.featured_image_alt ?? '',
                altEdited: false,
                height: initialPost.featured_image_height,
                url: initialPost.featured_image_url ?? '',
                variants: initialPost.featured_image_variants ?? {},
                width: initialPost.featured_image_width,
              }
            : undefined
        }
        form={form}
        isEditMode={isEditMode}
        onAltEdit={noteAltEdit}
        onContentChange={(content) => {
          pendingContentEditRef.current = false;
          setForm((current) => ({ ...current, content }));
        }}
        onContentDirty={() => {
          pendingContentEditRef.current = true;
        }}
        onCoverUrlEdit={invalidateFeaturedUploads}
        onFormChange={(updater) => {
          setForm((current) =>
            typeof updater === 'function' ? updater(current) : updater
          );
        }}
        onInlineImageUpload={uploadInlineImage}
        onSubmit={handleSubmit}
        onUploadFeatured={handleUploadFeatured}
        saving={saving}
        uploadingFeatured={uploadingFeatured}
      />
    </div>
  );
}
