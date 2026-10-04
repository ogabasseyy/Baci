'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { PlatformAdminBlogFormState } from './blog-types';
import { parseReviewHandoff } from './parse-review-handoff';

const MAX_FILE_SIZE = 2_000_000;

type BlogReviewHandoffImporterProps = {
  onImport: (draft: PlatformAdminBlogFormState) => boolean | undefined;
};

export function BlogReviewHandoffImporter({
  onImport,
}: BlogReviewHandoffImporterProps) {
  const [message, setMessage] = useState('');
  const onImportRef = useRef(onImport);
  const importGenerationRef = useRef(0);
  useLayoutEffect(() => {
    onImportRef.current = onImport;
  }, [onImport]);

  const handleFile = async (file?: File) => {
    if (!file) return;
    const generation = ++importGenerationRef.current;
    if (file.size > MAX_FILE_SIZE) {
      setMessage('The review file is larger than 2 MB.');
      return;
    }

    try {
      const text = await file.text();
      if (generation !== importGenerationRef.current) return;
      const draft = parseReviewHandoff(JSON.parse(text) as unknown);
      if (onImportRef.current(draft) === false) {
        setMessage('Import cancelled. Your article is unchanged.');
        return;
      }
      setMessage(
        'Draft loaded for review. It has not been saved or published.'
      );
    } catch (error) {
      if (generation !== importGenerationRef.current) return;
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
