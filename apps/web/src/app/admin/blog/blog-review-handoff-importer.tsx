'use client';

import { useState } from 'react';
import type { PlatformAdminBlogFormState } from './blog-types';
import { parseReviewHandoff } from './parse-review-handoff';

const MAX_FILE_SIZE = 2_000_000;

type BlogReviewHandoffImporterProps = {
  onImport: (draft: PlatformAdminBlogFormState) => void;
};

export function BlogReviewHandoffImporter({
  onImport,
}: BlogReviewHandoffImporterProps) {
  const [message, setMessage] = useState('');

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setMessage('The review file is larger than 2 MB.');
      return;
    }

    try {
      const draft = parseReviewHandoff(
        JSON.parse(await file.text()) as unknown
      );
      onImport(draft);
      setMessage(
        'Draft loaded for review. It has not been saved or published.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not read this review file.'
      );
    }
  };

  return (
    <section
      aria-labelledby="review-handoff-title"
      className="space-y-2 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold" id="review-handoff-title">
        Import writer review handoff
      </h2>
      <p className="text-sm text-muted-foreground">
        Load a completed JSON handoff into the editor. You must review and save
        it yourself; imports always start as drafts.
      </p>
      <label className="text-sm" htmlFor="review-handoff-file">
        Review handoff JSON
      </label>
      <input
        accept="application/json,.json"
        id="review-handoff-file"
        onChange={(event) => {
          void handleFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
        type="file"
      />
      <p
        aria-live="polite"
        className="text-sm text-muted-foreground"
        role="status"
      >
        {message}
      </p>
    </section>
  );
}
