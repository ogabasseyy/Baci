const HTML_ATTR_ESCAPE_REGEX = /[&<>"']/g;
const HTML_ATTR_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtmlAttr(value: string): string {
  if (!value) return '';
  return value.replace(
    HTML_ATTR_ESCAPE_REGEX,
    (match) => HTML_ATTR_ESCAPE_MAP[match] ?? match
  );
}

export function readHtmlTagAttribute(
  tag: string,
  attributeName: string
): string | null {
  const openTagMatch = /^<\s*[a-z][a-z0-9-]*/i.exec(tag);
  if (!openTagMatch) {
    return null;
  }

  const targetName = attributeName.toLowerCase();
  let index = openTagMatch[0].length;

  while (index < tag.length) {
    while (index < tag.length && /\s/.test(tag[index] ?? '')) {
      index += 1;
    }

    const char = tag[index];
    if (!char || char === '>' || (char === '/' && tag[index + 1] === '>')) {
      break;
    }

    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index] ?? '')) {
      index += 1;
    }

    if (index === nameStart) {
      break;
    }

    const name = tag.slice(nameStart, index).toLowerCase();

    while (index < tag.length && /\s/.test(tag[index] ?? '')) {
      index += 1;
    }

    let value = '';
    if (tag[index] === '=') {
      index += 1;
      while (index < tag.length && /\s/.test(tag[index] ?? '')) {
        index += 1;
      }

      const quote = tag[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < tag.length && tag[index] !== quote) {
          index += 1;
        }
        value = tag.slice(valueStart, index);
        if (tag[index] === quote) {
          index += 1;
        }
      } else {
        const valueStart = index;
        while (index < tag.length && !/[\s>]/.test(tag[index] ?? '')) {
          index += 1;
        }
        value = tag.slice(valueStart, index);
      }
    }

    if (name === targetName) {
      return value;
    }
  }

  return null;
}

export function stripHtmlAttribute(tag: string, attributeName: string): string {
  const openTagMatch = /^<\s*[a-z][a-z0-9-]*/i.exec(tag);
  if (!openTagMatch) {
    return tag;
  }

  const targetName = attributeName.toLowerCase();
  let index = openTagMatch[0].length;
  let nextTag = tag.slice(0, index);

  while (index < tag.length) {
    const segmentStart = index;

    while (index < tag.length && /\s/.test(tag[index] ?? '')) {
      index += 1;
    }

    const char = tag[index];
    if (!char || char === '>' || (char === '/' && tag[index + 1] === '>')) {
      nextTag += tag.slice(segmentStart);
      break;
    }

    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index] ?? '')) {
      index += 1;
    }

    if (index === nameStart) {
      nextTag += tag.slice(segmentStart);
      break;
    }

    const name = tag.slice(nameStart, index).toLowerCase();

    while (index < tag.length && /\s/.test(tag[index] ?? '')) {
      index += 1;
    }

    if (tag[index] === '=') {
      index += 1;
      while (index < tag.length && /\s/.test(tag[index] ?? '')) {
        index += 1;
      }

      const quote = tag[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        while (index < tag.length && tag[index] !== quote) {
          index += 1;
        }
        if (tag[index] === quote) {
          index += 1;
        }
      } else {
        while (index < tag.length && !/[\s>]/.test(tag[index] ?? '')) {
          index += 1;
        }
      }
    }

    if (name !== targetName) {
      nextTag += tag.slice(segmentStart, index);
    }
  }

  return nextTag;
}

export function setHtmlAttribute(
  tag: string,
  attributeName: string,
  value: string
) {
  const withoutAttribute = stripHtmlAttribute(tag, attributeName);
  const insertion = ` ${attributeName}="${value}"`;
  return withoutAttribute.replace(/\s*\/?>$/, (ending) => {
    return ending.trimStart().startsWith('/')
      ? `${insertion} />`
      : `${insertion}>`;
  });
}

export function readPositiveIntegerHtmlAttribute(
  tag: string,
  attributeName: string
): number | undefined {
  const value = readHtmlTagAttribute(tag, attributeName);
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
