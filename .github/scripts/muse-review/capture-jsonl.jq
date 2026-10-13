reduce inputs as $event (
  {text: null};
  if ($event | type) == "object"
     and $event.payload_type == "run.terminal.completed"
     and ($event.payload.text | type) == "string" then
    .text = $event.payload.text
  else
    .
  end
)
| if .text == null then error("Muse JSONL did not contain a completed run answer") else . end
