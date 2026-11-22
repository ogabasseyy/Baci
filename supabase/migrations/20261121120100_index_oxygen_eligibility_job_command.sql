-- Support the command foreign key's ON DELETE SET NULL lookup.
CREATE INDEX IF NOT EXISTS oxygen_eligibility_jobs_command_id_idx
  ON oxygen_private.eligibility_jobs (command_id);
