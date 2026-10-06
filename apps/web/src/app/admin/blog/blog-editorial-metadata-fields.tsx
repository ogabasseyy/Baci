'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BLOG_INTENTS } from '@/config/blog-intent';
import type { PlatformAdminBlogFormState } from './blog-types';

export function BlogEditorialMetadataFields({
  form,
  onFormChange,
}: {
  form: PlatformAdminBlogFormState;
  onFormChange: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Editorial metadata</legend>
      <div className="space-y-1">
        <Label htmlFor="editorial-intent">Editorial intent</Label>
        <select
          id="editorial-intent"
          value={form.intent ?? ''}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          onChange={(event) => {
            const intent =
              BLOG_INTENTS.find((value) => value === event.target.value) ??
              null;
            onFormChange((current) => ({ ...current, intent }));
          }}
        >
          <option value="">Not specified</option>
          {BLOG_INTENTS.map((intent) => (
            <option key={intent} value={intent}>
              {intent}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="intent-source">Intent source</Label>
        <Input
          id="intent-source"
          maxLength={100}
          value={form.intent_source ?? ''}
          onChange={(event) =>
            onFormChange((current) => ({
              ...current,
              intent_source: event.target.value,
            }))
          }
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="focus-keyword">Focus keyword</Label>
        <Input
          id="focus-keyword"
          maxLength={50}
          value={form.focus_keyword ?? ''}
          onChange={(event) =>
            onFormChange((current) => ({
              ...current,
              focus_keyword: event.target.value,
            }))
          }
        />
      </div>
    </fieldset>
  );
}
