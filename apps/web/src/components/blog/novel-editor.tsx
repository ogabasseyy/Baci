'use client';

import {
  EditorBubble,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorContent,
  EditorRoot,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  type JSONContent,
} from 'novel';

import { useState } from 'react';
import {
  createImageUploader,
  createMerchantImageUploader,
} from '@/components/blog/novel-features/image-upload';
import { createSuggestionItems } from '@/components/blog/novel-features/slash-command';
import { createSlashCommand } from '@/components/blog/novel-features/slash-command-extension';
import { Separator } from '@/components/ui/separator';
import { sanitizeHtml } from '@/lib/sanitize';
import { defaultExtensions } from './novel-features/extensions';
import { ProductExtension } from './novel-features/product-extension';
import { ColorSelector } from './novel-features/selectors/color-selector';
import { EditorToolbar } from './novel-features/selectors/editor-toolbar';
import { LinkSelector } from './novel-features/selectors/link-selector';
import { NodeSelector } from './novel-features/selectors/node-selector';
import { TextButtons } from './novel-features/selectors/text-buttons';
import { ProductEmbedPicker } from './product-embed';
import { useBlogContentUpdates } from './use-blog-content-updates';

// Remove static extensions definition
// const extensions = [...defaultExtensions, slashCommand];

interface NovelEditorProps {
  merchantId?: string;
  initialValue?: JSONContent | string;
  onChange: (value: string) => void;
  onContentDirty?: () => void;
  onImageUpload?: (file: File) => Promise<string>;
  onProductsChange?: (products: Product[]) => void;
  embeddedProducts?: Product[];
}

interface Product {
  id: string;
  name: string;
  price: number;
  compare_at_price?: number;
  images: string[];
  slug: string;
  status: string;
}

export default function NovelEditor({
  merchantId,
  initialValue,
  onChange,
  onContentDirty,
  onImageUpload,
  onProductsChange,
  embeddedProducts = [],
}: NovelEditorProps) {
  const [openNode, setOpenNode] = useState(false);
  const [openColor, setOpenColor] = useState(false);
  const [openLink, setOpenLink] = useState(false);
  const [openProducts, setOpenProducts] = useState(false);

  const updateContent = useBlogContentUpdates(onChange, onContentDirty);

  const imageUploader = onImageUpload
    ? createImageUploader(onImageUpload)
    : merchantId
      ? createMerchantImageUploader(merchantId)
      : () =>
          Promise.reject(
            new Error('Select a merchant before uploading inline images')
          );

  const suggestionItems = createSuggestionItems(imageUploader);
  const extensions = [
    ...defaultExtensions,
    createSlashCommand(suggestionItems),
    ProductExtension.configure({
      onOpenPicker: () => setOpenProducts(true),
    }),
  ];

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      <EditorRoot>
        <EditorContent
          immediatelyRender={false}
          // biome-ignore lint/suspicious/noExplicitAny: Tiptap types
          initialContent={initialValue as any}
          extensions={extensions}
          className="relative min-h-[700px] w-full border-muted bg-background sm:rounded-md sm:border sm:shadow-lg"
          editorProps={{
            handleDOMEvents: {
              keydown: (_view, event) => handleCommandNavigation(event),
            },
            handlePaste: (view, event) =>
              handleImagePaste(view, event, imageUploader),
            handleDrop: (view, event, _slice, moved) =>
              handleImageDrop(view, event, moved, imageUploader),
            transformPastedHTML: (html) => {
              // Sanitize pasted HTML to prevent XSS
              const clean = sanitizeHtml(html);
              // Strip all color-related styles to force theme defaults
              const parser = new DOMParser();
              const doc = parser.parseFromString(clean, 'text/html');
              doc.querySelectorAll('[style]').forEach((el) => {
                const element = el as HTMLElement;
                element.style.color = '';
                element.style.backgroundColor = '';
                element.style.background = '';
                element.style.borderColor = '';
                element.style.outlineColor = '';
                element.style.textDecorationColor = '';
                element.style.fill = '';
                element.style.stroke = '';
              });
              return doc.body.innerHTML;
            },
            attributes: {
              class:
                'prose dark:prose-invert prose-baci text-foreground focus:outline-hidden max-w-none min-h-[700px] pt-10 pb-24 px-8 sm:px-12',
            } as Record<string, string>,
          }}
          onUpdate={({ editor }) => {
            updateContent(editor);
          }}
          slotBefore={
            <EditorToolbar
              onImageUpload={imageUploader}
              onOpenLink={() => setOpenLink(true)}
              onOpenProducts={
                onProductsChange ? () => setOpenProducts(true) : undefined
              }
            />
          }
          slotAfter={
            <EditorBubble
              tippyOptions={{
                placement: 'top',
                offset: [0, 15], // Provides breathing room above selection
                zIndex: 9999, // Force on top
                appendTo: () => document.body, // Avoid clipping in containers
                flip: true, // Allow flip if absolutely necessary
              }}
              role="toolbar"
              aria-label="Text formatting toolbar"
              className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-background/80 backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            >
              <Separator orientation="vertical" />
              <NodeSelector open={openNode} onOpenChange={setOpenNode} />
              <Separator orientation="vertical" />
              <LinkSelector open={openLink} onOpenChange={setOpenLink} />
              <Separator orientation="vertical" />
              <TextButtons />
              <Separator orientation="vertical" />
              <ColorSelector open={openColor} onOpenChange={setOpenColor} />
            </EditorBubble>
          }
        >
          <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-muted bg-background px-1 py-2 shadow-md transition-all">
            <EditorCommandEmpty className="px-2 text-muted-foreground">
              No results
            </EditorCommandEmpty>
            <EditorCommandList>
              {suggestionItems.map((item) => (
                <EditorCommandItem
                  value={item.title}
                  onCommand={(val) => item.command?.(val)}
                  className="flex w-full items-center gap-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent"
                  key={item.title}
                >
                  <div className="flex size-10 items-center justify-center rounded-md border border-muted bg-background">
                    {item.icon}
                  </div>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </EditorCommandItem>
              ))}
            </EditorCommandList>
          </EditorCommand>
        </EditorContent>
      </EditorRoot>

      {onProductsChange && (
        <ProductEmbedPicker
          merchantId={merchantId}
          open={openProducts}
          onClose={() => setOpenProducts(false)}
          onSelect={(products) => {
            const existingIds = new Set(embeddedProducts.map((p) => p.id));
            const newProducts = products.filter((p) => !existingIds.has(p.id));
            onProductsChange([...embeddedProducts, ...newProducts]);
            setOpenProducts(false);
          }}
          selectedIds={embeddedProducts.map((p) => p.id)}
        />
      )}
    </div>
  );
}
