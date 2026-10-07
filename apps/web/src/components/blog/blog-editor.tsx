import { marked } from 'marked';
import dynamic from 'next/dynamic';
import type { JSONContent } from 'novel';
import type { RefObject } from 'react';

// Dynamically import NovelEditor to avoid SSR issues with Tiptap
const NovelEditor = dynamic(() => import('./novel-editor'), {
  ssr: false,
});

interface Product {
  id: string;
  name: string;
  price: number;
  compare_at_price?: number;
  images: string[];
  slug: string;
  status: string;
}

interface BlogEditorProps {
  merchantId?: string;
  content: string; // Used for content storage
  contentResetKey?: number;
  onChange: (content: string) => void;
  onContentDirty?: () => void;
  contentGenerationRef?: RefObject<number>;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
  onProductsChange?: (products: Product[]) => void;
  embeddedProducts?: Product[];
  showProductEmbed?: boolean;
}

export function BlogEditor({
  content,
  contentResetKey = 0,
  merchantId,
  onChange,
  onContentDirty,
  contentGenerationRef,
  onImageUpload,
  onProductsChange,
  embeddedProducts = [],
}: BlogEditorProps) {
  const initialContent: JSONContent | string | undefined = (() => {
    if (!content) return undefined;

    try {
      // 1. If it's valid JSON (stored by the editor previously), use it directly
      if (content.trim().startsWith('{')) {
        return JSON.parse(content);
      }

      // 2. If it's Markdown or clustered text (likely from agent),
      // convert to HTML for high-fidelity rendering in the editor.
      const html = marked.parse(content, { async: false }) as string;
      return html;
    } catch (e) {
      console.error('Error parsing blog content:', e);
      return content;
    }
  })();

  // Handle HTML content updates from Novel
  const handleContentChange = (html: string) => {
    // We now store the HTML string in the DB
    // This is much safer than JSON and handles Markdown better
    onChange(html);
  };

  return (
    <div className="min-h-[500px] w-full">
      <NovelEditor
        key={`${merchantId ?? 'no-merchant'}-${contentResetKey}`}
        merchantId={merchantId}
        initialValue={initialContent}
        onChange={handleContentChange}
        onContentDirty={onContentDirty}
        contentGenerationRef={contentGenerationRef}
        onImageUpload={onImageUpload}
        onProductsChange={onProductsChange}
        embeddedProducts={embeddedProducts}
      />
    </div>
  );
}
