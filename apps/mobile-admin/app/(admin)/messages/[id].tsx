import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';
import { ConversationThread } from '@/components/messages/ConversationThread';
import { InvalidRouteScreen } from '@/components/ui/InvalidRouteScreen';

const routeParamsSchema = z.object({
  id: z.coerce.number().int().positive().safe(),
});

export default function MessageThreadScreen() {
  const raw = useLocalSearchParams<{ id?: string | string[] }>();
  const parsed = routeParamsSchema.safeParse({
    id: Array.isArray(raw.id) ? raw.id[0] : raw.id,
  });

  if (!parsed.success) {
    return (
      <InvalidRouteScreen
        message="This conversation link is not valid."
        title="Conversation not found"
      />
    );
  }

  return <ConversationThread conversationId={parsed.data.id} />;
}
