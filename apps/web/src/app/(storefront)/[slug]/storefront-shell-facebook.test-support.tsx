export function MockDeferredFacebookPixel({ pixelId }: { pixelId: string }) {
  return <span data-testid="facebook-pixel">{pixelId}</span>;
}
