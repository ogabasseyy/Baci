'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_REVIEW_HANDOFF_FILE_SIZE } from '@/config/blog-review-handoff';
import type { PlatformAdminBlogFormState } from './blog-types';
import { parseReviewHandoff } from './parse-review-handoff';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

type BlogReviewHandoffImporterProps = {
  disabled?: boolean;
  onImport: (draft: PlatformAdminBlogFormState) => boolean | undefined;
};

export function BlogReviewHandoffImporter({
  disabled = false,
  onImport,
}: BlogReviewHandoffImporterProps) {
  const [message, setMessage] = useState('');
  const onImportRef = useRef(onImport);
  const importGenerationRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    onImportRef.current = onImport;
  }, [onImport]);
  useIsomorphicLayoutEffect(() => {
    if (disabled) importGenerationRef.current += 1;
  }, [disabled]);
  useIsomorphicLayoutEffect(() => {
    // A pending file.text() continuation must not apply after unmount:
    // without this the stale read still invokes onImport and setMessage,
    // possibly showing the replacement confirmation over the next page.
    return () => {
      importGenerationRef.current += 1;
    };
  }, []);

  const handleFile = async (file?: File) => {
    if (!file || disabled) return;
    const generation = ++importGenerationRef.current;
    if (file.size > MAX_REVIEW_HANDOFF_FILE_SIZE) {
      setMessage(
        `The review file is larger than ${MAX_REVIEW_HANDOFF_FILE_SIZE / 1_000_000} MB (${MAX_REVIEW_HANDOFF_FILE_SIZE.toLocaleString('en-US')} bytes).`
      );
      return;
    }

    try {
      const text = await file.text();
      if (generation !== importGenerationRef.current) return;
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        setMessage('This file is not valid JSON.');
        return;
      }
      const draft = parseReviewHandoff(value);
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
        disabled={disabled}
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
