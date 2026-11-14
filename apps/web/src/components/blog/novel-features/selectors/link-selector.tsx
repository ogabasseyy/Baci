import { Check, Trash } from 'lucide-react';
import { useEditor } from 'novel';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { isImeComposing } from '@/lib/is-ime-composing';
import { cn } from '@/lib/utils';

export function isValidUrl(url: string) {
  try {
    new URL(url);
    return true;
  } catch (_e) {
    return false;
  }
}

export function getUrlFromString(str: string) {
  if (isValidUrl(str)) return str;
  try {
    if (str.includes('.') && !str.includes(' ')) {
      return new URL(`https://${str}`).toString();
    }
  } catch (_e) {
    return null;
  }
  return null;
}

interface LinkSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const LinkSelector = ({ open, onOpenChange }: LinkSelectorProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { editor } = useEditor();
  const [value, setValue] = useState(editor?.getAttributes('link').href || '');

  // Sync the input with the active link when the editor instance changes.
  // Adjusting state during render (instead of in an effect) avoids the extra
  // commit with a stale value that React Compiler flags.
  const [prevEditor, setPrevEditor] = useState(editor);
  if (editor !== prevEditor) {
    setPrevEditor(editor);
    setValue(editor?.getAttributes('link').href || '');
  }

  // Focus the input when the popover opens
  useEffect(() => {
    if (!open) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open]);

  if (!editor) return null;

  return (
    <Popover modal={true} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="gap-2 rounded-none border-none"
        >
          <p
            className={cn('underline decoration-stone-400 underline-offset-4', {
              'text-blue-500': editor.isActive('link'),
            })}
          >
            Link
          </p>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0" sideOffset={10}>
        <div className="flex p-1">
          <Input
            ref={inputRef}
            type="text"
            placeholder="Paste a link"
            className="flex-1 bg-background mr-2"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                const url = getUrlFromString(value);
                if (url) {
                  editor.chain().focus().setLink({ href: url }).run();
                  onOpenChange(false);
                }
              }
            }}
          />
          {editor.getAttributes('link').href ? (
            <Button
              size="icon"
              variant="outline"
              type="button"
              aria-label="Remove link"
              className="flex size-8 items-center rounded-sm text-red-600 transition-all hover:bg-red-100 dark:hover:bg-red-800"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                onOpenChange(false);
              }}
            >
              <Trash className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="outline"
              type="button"
              aria-label="Save link"
              className="flex size-8 items-center rounded-sm transition-all"
              onClick={() => {
                const url = getUrlFromString(value);
                if (url) {
                  editor.chain().focus().setLink({ href: url }).run();
                  onOpenChange(false);
                }
              }}
            >
              <Check className="size-4" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
