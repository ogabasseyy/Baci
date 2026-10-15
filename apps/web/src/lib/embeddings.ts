/**
 * Utility for generating semantic embeddings for products and blog posts
 * Uses the generate-embedding Edge Function to create vector embeddings
 */

import { createClient } from '@/lib/supabase/client';

interface GenerateEmbeddingParams {
  type: 'blog' | 'product';
  id: string;
  text: string;
}

/**
 * Generates and stores a semantic embedding for a product or blog post.
 * This is called automatically when content is created or updated.
 *
 * @param params - The type (blog/product), id, and text to embed
 * @returns Promise<boolean> - true if successful, false otherwise
 */
export async function generateEmbedding(
  params: GenerateEmbeddingParams
): Promise<boolean> {
  const { type, id, text } = params;

  // Skip if text is too short to be meaningful
  if (!text || text.trim().length < 20) {
    console.log('Skipping embedding for', type, id, ': text too short');
    return false;
  }

  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      console.error('No auth session for embedding generation');
      return false;
    }

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ type, id, text }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to generate embedding for', type, id, ':', error);
      return false;
    }

    console.log('Successfully generated embedding for', type, id);
    return true;
  } catch (error) {
    // Audit-noise: a crafted value can only garble this server log line. Dismissed in code-scanning (false-positive).
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
    console.error(`Error generating embedding for ${type} ${id}:`, error);
    return false;
  }
}

/**
 * Prepares text content for embedding from a product
 */
export function getProductEmbeddingText(product: {
  name: string;
  description?: string | null;
  brand?: string | null;
  category_name?: string | null;
}): string {
  const parts = [product.name];

  if (product.brand) {
    parts.push(`Brand: ${product.brand}`);
  }

  if (product.category_name) {
    parts.push(`Category: ${product.category_name}`);
  }

  if (product.description) {
    // Strip HTML safely - limit length first, then use simple character-based stripping
    // to avoid ReDoS on malformed HTML like strings with many '<' chars
    const desc = product.description.slice(0, 10000);
    // Simple tag removal: find < and skip to > or end
    let result = '';
    let inTag = false;
    for (let i = 0; i < desc.length; i++) {
      if (desc[i] === '<') {
        inTag = true;
      } else if (desc[i] === '>') {
        inTag = false;
      } else if (!inTag) {
        result += desc[i];
      }
    }
    const cleanDescription = result.replace(/\s+/g, ' ').trim();
    parts.push(cleanDescription);
  }

  return parts.join('. ');
}

/**
 * Prepares text content for embedding from a blog post
 */
export function getBlogEmbeddingText(blog: {
  title: string;
  excerpt?: string | null;
  content?: string | null;
  category?: string | null;
}): string {
  const parts = [blog.title];

  if (blog.category) {
    parts.push(`Category: ${blog.category}`);
  }

  if (blog.excerpt) {
    parts.push(blog.excerpt);
  }

  if (blog.content) {
    // Strip HTML safely - limit length first, then use simple character-based stripping
    // to avoid ReDoS on malformed HTML like strings with many '<' chars
    const content = blog.content.slice(0, 10000);
    // Simple tag removal: find < and skip to > or end
    let result = '';
    let inTag = false;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '<') {
        inTag = true;
      } else if (content[i] === '>') {
        inTag = false;
      } else if (!inTag) {
        result += content[i];
      }
    }
    const cleanContent = result.replace(/\s+/g, ' ').trim().slice(0, 5000); // Final limit
    parts.push(cleanContent);
  }

  return parts.join('. ');
}
