CREATE TABLE realtime.messages (
          id UUID NOT NULL DEFAULT gen_random_uuid(),
          topic TEXT NOT NULL,
          extension TEXT NOT NULL,
          payload JSONB,
          event TEXT,
          private BOOLEAN DEFAULT FALSE,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          inserted_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (id, inserted_at)
        ) PARTITION BY RANGE (inserted_at);

create or replace function realtime.topic() returns text as $$
    select nullif(current_setting('realtime.topic', true), '')::text;
    $$ language sql stable;
