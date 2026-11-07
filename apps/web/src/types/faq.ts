/**
 * Types for structured FAQ data
 * Supports JSON-LD FAQPage schema for rich search results
 */

export interface FAQItem {
  id?: string;
  question: string;
  answer: string;
  category?: string;
  order?: number;
}

/**
 * Parse FAQ content from legacy text format
 * Supports formats:
 * - "Q: Question?\nA: Answer"
 * - "**Question?**\nAnswer"
 * - "### Question?\nAnswer"
 */
export function parseLegacyFAQ(content: string): FAQItem[] {
  if (!content || typeof content !== 'string') return [];

  const faqs: FAQItem[] = [];

  // Try Q:/A: format first
  const qaPattern = /Q:\s*(.+?)\s*\n+A:\s*(.+?)(?=\n+Q:|$)/gis;
  let matches = content.matchAll(qaPattern);
  let matchArray = Array.from(matches);

  if (matchArray.length > 0) {
    for (const match of matchArray) {
      faqs.push({
        question: match[1].trim(),
        answer: match[2].trim(),
        order: faqs.length,
      });
    }
    return faqs;
  }

  // Try markdown header format (### or **)
  const mdPattern =
    /(?:###?\s*\*{0,2}|\*{2})(.+?)(?:\*{2})?\s*\n+([^#*]+?)(?=(?:###?|\*{2})|$)/gis;
  matches = content.matchAll(mdPattern);
  matchArray = Array.from(matches);

  if (matchArray.length > 0) {
    for (const match of matchArray) {
      const question = match[1].trim();
      const answer = match[2].trim();
      if (question && answer) {
        faqs.push({
          question,
          answer,
          order: faqs.length,
        });
      }
    }
    return faqs;
  }

  // Try simple numbered format (1. Question\nAnswer)
  const numberedPattern = /\d+\.\s*(.+?)\s*\n+([^0-9]+?)(?=\d+\.|$)/gis;
  matches = content.matchAll(numberedPattern);
  matchArray = Array.from(matches);

  if (matchArray.length > 0) {
    for (const match of matchArray) {
      faqs.push({
        question: match[1].trim(),
        answer: match[2].trim(),
        order: faqs.length,
      });
    }
    return faqs;
  }

  return faqs;
}

/**
 * Group FAQs by category
 */
export function groupFAQsByCategory(
  faqs: FAQItem[]
): Record<string, FAQItem[]> {
  const grouped: Record<string, FAQItem[]> = {};

  for (const faq of faqs) {
    const category = faq.category || 'General';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(faq);
  }

  // Sort each category by order
  for (const category of Object.keys(grouped)) {
    grouped[category].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  return grouped;
}
