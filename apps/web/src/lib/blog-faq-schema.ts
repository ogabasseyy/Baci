import type { JsonLdStructuredData } from '@/lib/json-ld-types';
import { stripHtmlTags } from '@/lib/sanitize-core';

export interface BlogFaqItem {
  question: string;
  answer: string;
}

const MIN_QUESTION_LENGTH = 8;
const MIN_ANSWER_LENGTH = 20;
const MAX_QUESTION_LENGTH = 180;
const MAX_ANSWER_LENGTH = 600;
const MAX_FAQ_ITEMS = 6;

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const FAQ_HEADING_RE =
  /<h2\b[^>]*>\s*(?:faqs?(?:\b[^<]*)?|frequently asked questions(?:\b[^<]*)?|people also ask(?:\b[^<]*)?)\s*<\/h2>([\s\S]*?)(?=<h2\b|$)/gi;
const FAQ_QUESTION_BLOCK_RE =
  /<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)>/gi;

function decodeCodePoint(codePoint: number, fallback: string): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, key) => {
    if (key.startsWith('#x')) {
      return decodeCodePoint(Number.parseInt(key.slice(2), 16), entity);
    }

    if (key.startsWith('#')) {
      return decodeCodePoint(Number.parseInt(key.slice(1), 10), entity);
    }

    return HTML_ENTITY_MAP[key] || entity;
  });
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, ' ').trim();
}

function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const sliced = text.slice(0, maxLength).trimEnd();
  const lastSpaceIndex = sliced.lastIndexOf(' ');
  return lastSpaceIndex > 0 ? sliced.slice(0, lastSpaceIndex) : sliced;
}

export function extractBlogFaqItems(contentHtml: string): BlogFaqItem[] {
  const items: BlogFaqItem[] = [];
  const seenQuestions = new Set<string>();

  for (const sectionMatch of contentHtml.matchAll(FAQ_HEADING_RE)) {
    const faqSection = sectionMatch[1];
    if (!faqSection) {
      continue;
    }

    for (const match of faqSection.matchAll(FAQ_QUESTION_BLOCK_RE)) {
      const question = normalizeText(match[1] || '');
      const answer = normalizeText(match[2] || '');
      const questionKey = question.toLowerCase();

      if (
        !question.endsWith('?') ||
        question.length < MIN_QUESTION_LENGTH ||
        answer.length < MIN_ANSWER_LENGTH ||
        seenQuestions.has(questionKey)
      ) {
        continue;
      }

      seenQuestions.add(questionKey);
      items.push({
        question: truncateAtWord(question, MAX_QUESTION_LENGTH),
        answer: truncateAtWord(answer, MAX_ANSWER_LENGTH),
      });

      if (items.length >= MAX_FAQ_ITEMS) {
        return items;
      }
    }
  }

  return items;
}

export function generateFaqPageSchema(
  items: BlogFaqItem[]
): JsonLdStructuredData | null {
  if (items.length === 0) {
    return null;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
