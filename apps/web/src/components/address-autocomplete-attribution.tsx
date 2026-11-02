import Image from 'next/image';

export function AddressAutocompleteAttribution({
  provider,
}: {
  provider: 'google' | 'geoapify';
}) {
  if (provider === 'geoapify')
    return (
      <span className="text-xs text-muted-foreground">
        Powered by{' '}
        <a
          href="https://www.geoapify.com/"
          target="_blank"
          rel="noopener"
          className="underline"
        >
          Geoapify
        </a>
        {' · '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
          className="underline"
        >
          © OpenStreetMap contributors
        </a>
      </span>
    );
  return (
    <Image
      src="/attribution/powered-by-google-on-white.png"
      alt="Powered by Google"
      width={120}
      height={14}
      unoptimized
      className="shrink-0"
    />
  );
}
