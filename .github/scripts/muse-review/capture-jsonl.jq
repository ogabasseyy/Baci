reduce inputs as $event (
  {text: null, model_ids: []};
  if ($event | type) == "object"
     and $event.payload_type == "run.terminal.completed"
     and ($event.payload.text | type) == "string" then
    .text = $event.payload.text
  elif ($event | type) == "object"
       and $event.payload_type == "session.tokenUsage"
       and ($event.payload.modelId | type) == "string"
       and ($event.payload.modelId | test("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")) then
    .model_ids |= if index($event.payload.modelId) == null
      then . + [$event.payload.modelId]
      else .
      end
  else
    .
  end
)
| if .text == null then error("Muse JSONL did not contain a completed run answer") else . end
