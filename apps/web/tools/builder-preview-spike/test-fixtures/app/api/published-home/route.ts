import { createPortablePublishedSnapshot } from '@/lib/portable-published-snapshot';
import { home } from '../../../../fixtures';

// Synthetic local public projection, not a production database/API implementation.
export async function GET(request: Request) {
  const config = structuredClone(home);
  if (new URL(request.url).searchParams.get('revision') === '2') {
    for (const block of config.content) {
      if (block.type === 'Hero' && 'title' in block.props)
        block.props.title = 'Updated published cameras';
    }
  }
  return Response.json(await createPortablePublishedSnapshot(config));
}
