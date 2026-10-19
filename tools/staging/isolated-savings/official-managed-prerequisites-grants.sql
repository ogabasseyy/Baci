ALTER TABLE realtime.messages OWNER TO supabase_realtime_admin;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX messages_inserted_at_topic_index ON realtime.messages (inserted_at DESC, topic)
  WHERE extension = 'broadcast' AND private IS TRUE;
GRANT SELECT, INSERT, UPDATE ON realtime.messages TO postgres, anon, authenticated, service_role;
ALTER FUNCTION realtime.topic() OWNER TO supabase_realtime_admin;
GRANT USAGE ON SCHEMA graphql_public TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO postgres, anon, authenticated, service_role;
