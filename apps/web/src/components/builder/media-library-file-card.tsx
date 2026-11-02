'use client';

import { Check, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import type { MediaFile } from './media-library-types';

export function MediaLibraryFileCard({
  file,
  selected,
  onSelect,
  onDelete,
}: {
  file: MediaFile;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const pending = file.deletionState === 'pending';
  return (
    <Card
      className={cn(
        'relative group overflow-hidden transition-all',
        !pending && 'cursor-pointer',
        selected && !pending && 'ring-2 ring-primary'
      )}
      onClick={() => {
        if (!pending) onSelect();
      }}
    >
      {pending && (
        <p
          role="status"
          className="px-2 py-1 text-xs bg-muted text-muted-foreground"
        >
          Deletion pending — retry to finish
        </p>
      )}
      <div className="aspect-square relative bg-muted">
        <Image
          src={file.url}
          alt={file.name}
          fill
          sizes="(max-width: 768px) 50vw, 384px"
          className="object-cover"
        />
        {selected && !pending && (
          <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
            <Check className="size-4" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {!pending && (
            <CopyButton
              value={file.url}
              className="size-8 bg-secondary text-secondary-foreground hover:bg-secondary/80 border-0"
              label="Copy URL"
              successLabel="Copied!"
            />
          )}
          <Button
            size="icon"
            variant="destructive"
            className="size-8"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${file.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium truncate" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {(file.size / 1024).toFixed(0)} KB
        </p>
      </div>
    </Card>
  );
}
