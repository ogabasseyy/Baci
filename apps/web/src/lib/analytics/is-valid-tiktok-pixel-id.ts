export function isValidTikTokPixelId(id: string): boolean {
  return /^[A-Za-z0-9]{1,64}$/.test(id);
}
