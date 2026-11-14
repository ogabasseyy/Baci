import { headers } from 'next/headers';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const request = await headers();
  return (
    <>
      <pre>
        {JSON.stringify({
          cookie: request.get('cookie'),
          merchant: request.get('x-merchant-slug'),
          domain: request.get('x-custom-domain'),
        })}
      </pre>
      <iframe
        title="Synthetic Oxygen frame"
        src="https://frame.example.test/fixture"
        allow="camera"
      />
    </>
  );
}
