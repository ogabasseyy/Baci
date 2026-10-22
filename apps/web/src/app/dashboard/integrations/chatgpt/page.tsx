import { notFound } from 'next/navigation';
import { BUILDER_ACCOUNT_LINKING_ENABLED } from '@/config/builder-linking';
import { listBuilderConnections } from '@/lib/builder-connector/management';
import { createClient } from '@/lib/supabase/server';
import { disconnectBuilderAction } from './actions';
export default async function ChatGptConnectionsPage() {
  if (!BUILDER_ACCOUNT_LINKING_ENABLED) notFound();
  const connections = await listBuilderConnections(await createClient());
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">
        ChatGPT website builder connections
      </h1>
      <p>
        Disconnecting stops this connection from accessing your Baci account.
        Your website and other connected apps are unchanged.
      </p>
      {connections.length === 0 ? (
        <p>No website builder connections.</p>
      ) : (
        <ul className="space-y-4">
          {connections.map((connection) => (
            <li
              key={connection.connection_id}
              className="rounded-lg border p-4"
            >
              <p>Connection {connection.connection_id}</p>
              <p>Status: {connection.status}</p>
              <p>Permissions: {connection.scopes.join(', ')}</p>
              <p>Expires: {connection.expires_at}</p>
              {connection.status !== 'revoked' && (
                <form action={disconnectBuilderAction}>
                  <input
                    type="hidden"
                    name="connectionId"
                    value={connection.connection_id}
                  />
                  <button
                    type="submit"
                    className="mt-3 rounded-md border px-4 py-2"
                  >
                    Disconnect
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
