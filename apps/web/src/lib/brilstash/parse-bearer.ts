export function parseBrilStashBearer(header: string | null): string | null {
  return header?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/i)?.[1] ?? null;
}
