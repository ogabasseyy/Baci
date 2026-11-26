export interface ParsedMultipartPart {
  headers: Record<string, string>;
  body: string;
  name?: string;
}

export function parseMultipartMixed(
  contentTypeHeader: string | null,
  rawBody: string
): ParsedMultipartPart[] {
  if (!contentTypeHeader) {
    throw new Error('Missing content-type header');
  }
  const boundaryMatch = /multipart\/mixed;\s*boundary=([^\s;]+)/i.exec(
    contentTypeHeader
  );
  const boundary = boundaryMatch?.[1];
  if (!boundary) {
    throw new Error(`Invalid multipart/mixed header: ${contentTypeHeader}`);
  }

  const delimiter = `--${boundary}`;
  const closing = `--${boundary}--`;
  if (!rawBody.includes(closing)) {
    throw new Error('Missing closing multipart boundary');
  }

  const sections = rawBody.split(delimiter).slice(1);
  const parts: ParsedMultipartPart[] = [];

  for (const section of sections) {
    if (section.startsWith('--')) {
      break;
    }
    const trimmedLeading = section.startsWith('\r\n')
      ? section.slice(2)
      : section;
    const headerEnd = trimmedLeading.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      throw new Error('Malformed multipart section missing header separator');
    }
    const headerBlock = trimmedLeading.slice(0, headerEnd);
    const bodyWithTrailing = trimmedLeading.slice(headerEnd + 4);
    const body = bodyWithTrailing.endsWith('\r\n')
      ? bodyWithTrailing.slice(0, -2)
      : bodyWithTrailing;

    const headers: Record<string, string> = {};
    for (const line of headerBlock.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line
        .slice(colon + 1)
        .trim();
    }
    const disp = headers['content-disposition'] ?? '';
    const nameMatch = /name="([^"]+)"/.exec(disp);
    parts.push({
      headers,
      body,
      name: nameMatch?.[1],
    });
  }

  return parts;
}
