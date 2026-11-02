export function MockDeferredTwitterPixel({
  pixelId,
  eventIds,
}: {
  pixelId: string;
  eventIds?: Record<string, string | undefined>;
}) {
  return (
    <span data-testid="x-pixel" data-events={JSON.stringify(eventIds)}>
      {pixelId}
    </span>
  );
}
