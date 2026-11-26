'use client';

import { Upload } from 'lucide-react';
import { type DragEvent, type RefObject, useState } from 'react';

interface LogoDropzoneChipProps {
  disabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelected: (file: File) => void;
}

export function LogoDropzoneChip({
  disabled,
  fileInputRef,
  onFileSelected,
}: LogoDropzoneChipProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div className="mb-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Upload store logo file"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFileSelected(file);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm transition-colors ${
          isDragging
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/60 hover:text-foreground'
        }`}
      >
        <Upload className="size-4 shrink-0" aria-hidden="true" />
        <span>
          Drag and drop your logo here, or click to browse (PNG, JPEG, WebP)
        </span>
      </button>
    </div>
  );
}
