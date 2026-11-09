# Emits every absolute-path candidate a session transcript line reveals.
def unquote: gsub("^[\"']|[\"']$"; "");
def dir_args:
  (.input.command // "")
  | [ scan("(?:^|[\\s;&|(])(?:cd|pushd)\\s+(\"[^\"]+\"|'[^']+'|[^\\s;&|)]+)"),
      scan("git\\s+-C\\s+(\"[^\"]+\"|'[^']+'|[^\\s;&|)]+)") ]
  | flatten | map(unquote)[];
( (.message.content? | if type == "array" then .[] else empty end)
  | select(.type? == "tool_use")
  | ((.input.file_path? // empty), (.input.path? // empty),
     (.input.notebook_path? // empty), dir_args) ),
( .cwd? // empty | "CWD\t" + . )
