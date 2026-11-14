'use client';

import { Image as ImageIcon, Link as LinkIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ImageUploadHandler } from '@/components/blog/novel-features/slash-command';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { isImeComposing } from '@/lib/is-ime-composing';
import { sanitizeUrl } from '@/lib/sanitize-core';
import { getTiptap } from '../utils/tiptap';

type ImagePopoverMode = 'insert' | 'edit-caption';

export function EditorImageControls({
  editor,
  onImageUpload,
}: {
  editor: unknown;
  onImageUpload?: ImageUploadHandler;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImagePopoverMode>('insert');
  const [urlValue, setUrlValue] = useState('');
  const [captionValue, setCaptionValue] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tiptap = getTiptap(editor);

  const close = () => {
    setOpen(false);
    setUrlError(null);
  };
  const caption = () => {
    const value = captionValue.trim();
    return value || null;
  };
  const insertImageFromUrl = () => {
    const url = urlValue.trim();
    if (!url) return;
    const sanitized = sanitizeUrl(url);
    try {
      if (
        !sanitized ||
        !['http:', 'https:'].includes(new URL(sanitized).protocol)
      )
        throw new Error();
    } catch {
      setUrlError('Invalid image URL');
      return;
    }
    tiptap
      ?.chain()
      .focus()
      .setImage({ src: sanitized, title: caption() })
      .run();
    setUrlValue('');
    setCaptionValue('');
    setUrlError(null);
    close();
  };
  const updateCaption = () => {
    if (!tiptap?.isActive('image')) return;
    tiptap
      .chain()
      .focus()
      .updateAttributes('image', { title: caption() })
      .run();
    setCaptionValue('');
    close();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="size-8 p-0"
            title="Insert Image"
          >
            <ImageIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload image from device"
          >
            <ImageIcon className="mr-2 size-4" />
            Upload from device
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setMode('insert');
              setUrlValue('');
              setCaptionValue('');
              setUrlError(null);
              setOpen(true);
            }}
            aria-label="Insert image from URL"
          >
            <LinkIcon className="mr-2 size-4" />
            Insert from URL
          </DropdownMenuItem>
          {tiptap?.isActive('image') ? (
            <DropdownMenuItem
              onClick={() => {
                const attrs = tiptap.getAttributes<{ title?: string | null }>(
                  'image'
                );
                setMode('edit-caption');
                setCaptionValue(
                  typeof attrs.title === 'string' ? attrs.title : ''
                );
                setUrlError(null);
                setOpen(true);
              }}
              aria-label="Edit selected image caption"
            >
              <ImageIcon className="mr-2 size-4" />
              Edit caption
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setUrlError(null);
        }}
      >
        <PopoverContent
          align="start"
          className="w-80 p-3"
          onInteractOutside={close}
        >
          <div className="space-y-2">
            {mode === 'insert' ? (
              <>
                <label
                  htmlFor="image-url-input"
                  className="text-sm font-medium"
                >
                  Image URL
                </label>
                <Input
                  id="image-url-input"
                  placeholder="https://example.com/image.jpg"
                  value={urlValue}
                  onChange={(event) => {
                    setUrlValue(event.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (isImeComposing(event)) return;
                      insertImageFromUrl();
                    }
                  }}
                />
              </>
            ) : null}
            <label
              htmlFor="image-caption-input"
              className="text-sm font-medium"
            >
              Caption
            </label>
            <Input
              id="image-caption-input"
              placeholder="Optional image caption"
              value={captionValue}
              onChange={(event) => setCaptionValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (isImeComposing(event)) return;
                  if (mode === 'insert') insertImageFromUrl();
                  else updateCaption();
                }
              }}
            />
            {urlError ? (
              <p className="text-xs text-destructive">{urlError}</p>
            ) : null}
            <Button
              size="sm"
              type="button"
              className="w-full"
              disabled={mode === 'insert' && !urlValue.trim()}
              onClick={() => {
                if (mode === 'insert') insertImageFromUrl();
                else updateCaption();
              }}
            >
              {mode === 'insert' ? 'Insert Image' : 'Update Caption'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <input
        type="file"
        ref={fileInputRef}
        aria-label="Upload image"
        className="hidden"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && tiptap)
            onImageUpload?.(file, tiptap.view, tiptap.state.selection.from);
          event.target.value = '';
        }}
      />
    </>
  );
}
