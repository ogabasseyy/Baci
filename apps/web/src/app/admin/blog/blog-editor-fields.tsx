'use client';
// Client component: renders interactive editor controls and rich-text input.

import { Loader2, Upload } from 'lucide-react';
import { BlogEditor } from '@/components/blog/blog-editor';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  PlatformAdminBlogFormState,
  PlatformAdminBlogStatus,
} from './blog-types';

type BlogEditorFieldsProps = {
  contentResetKey?: number;
  form: PlatformAdminBlogFormState;
  isEditMode: boolean;
  onContentChange: (value: string) => void;
  onContentDirty?: () => void;
  onFormChange: (
    updater:
      | PlatformAdminBlogFormState
      | ((current: PlatformAdminBlogFormState) => PlatformAdminBlogFormState)
  ) => void;
  onInlineImageUpload: (file: File) => Promise<string>;
  onSubmit: () => void;
  onUploadFeatured: () => void;
  saving: boolean;
  uploadingFeatured: boolean;
};

export function BlogEditorFields({
  contentResetKey,
  form,
  isEditMode,
  onContentChange,
  onContentDirty,
  onFormChange,
  onInlineImageUpload,
  onSubmit,
  onUploadFeatured,
  saving,
  uploadingFeatured,
}: BlogEditorFieldsProps) {
  const setForm = (
    updater:
      | PlatformAdminBlogFormState
      | ((current: PlatformAdminBlogFormState) => PlatformAdminBlogFormState)
  ) => onFormChange(updater);

  const setStatus = (status: string) => {
    setForm((current) => ({
      ...current,
      status: status as PlatformAdminBlogStatus,
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post Details</CardTitle>
        <CardDescription>
          Publishing updates `/blog`, `/sitemap.xml`, and `/blog/feed.xml`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
        />

        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          value={form.slug}
          onChange={(event) =>
            setForm((current) => ({ ...current, slug: event.target.value }))
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="author-name">Author</Label>
            <Input
              id="author-name"
              value={form.author_name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  author_name: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              value={form.status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </div>
        </div>

        <Label htmlFor="category">Category</Label>
        <Input
          id="category"
          value={form.category}
          onChange={(event) =>
            setForm((current) => ({ ...current, category: event.target.value }))
          }
        />

        <Label htmlFor="excerpt">Excerpt</Label>
        <Textarea
          id="excerpt"
          rows={3}
          value={form.excerpt}
          onChange={(event) =>
            setForm((current) => ({ ...current, excerpt: event.target.value }))
          }
        />

        <Label htmlFor="featured-image-url">Featured Image URL</Label>
        <Input
          id="featured-image-url"
          value={form.featured_image_url}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              featured_image_url: event.target.value,
            }))
          }
        />
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={uploadingFeatured}
            onClick={onUploadFeatured}
          >
            {uploadingFeatured ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            Upload featured image
          </Button>
        </div>

        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input
          id="tags"
          value={form.tags}
          onChange={(event) =>
            setForm((current) => ({ ...current, tags: event.target.value }))
          }
        />

        <Label htmlFor="seo-title">SEO Title</Label>
        <Input
          id="seo-title"
          value={form.seo_title}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              seo_title: event.target.value,
            }))
          }
        />

        <Label htmlFor="seo-description">SEO Description</Label>
        <Textarea
          id="seo-description"
          rows={2}
          value={form.seo_description}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              seo_description: event.target.value,
            }))
          }
        />

        <Label>Content</Label>
        <BlogEditor
          contentResetKey={contentResetKey}
          content={form.content}
          onChange={onContentChange}
          onContentDirty={onContentDirty}
          onImageUpload={onInlineImageUpload}
        />

        <div className="flex justify-end">
          <Button type="button" onClick={onSubmit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {isEditMode ? 'Save Changes' : 'Create Post'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
