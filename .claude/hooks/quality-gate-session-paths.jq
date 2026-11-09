# Emits tab-separated evidence lines from a session transcript:
#   P <cwd> <path>   a path the session referenced (file input, cd, pushd, git -C);
#                    may be relative to <cwd>, the directory the entry ran in
#   M <cwd>          a mutating action (Edit/Write/NotebookEdit, git add/commit)
#   C <cwd>          the cwd recorded on a transcript entry
def unquote: gsub("^[\"']|[\"']$"; "");
def dir_args:
  (.input.command // "")
  | [ scan("(?:^|[\\s;&|(])(?:cd|pushd)\\s+(\"[^\"]+\"|'[^']+'|[^\\s;&|)]+)"),
      scan("(?:^|[\\s;&|(])git\\s+-C\\s+(\"[^\"]+\"|'[^']+'|[^\\s;&|)]+)") ]
  | flatten | map(unquote)[];
def mutates:
  (.name? // "") as $n
  | ($n | test("^(Edit|Write|NotebookEdit|MultiEdit)$"))
    or ((.input.command? // "") | test("(^|[\\s;&|(])git\\s+(-C\\s+(\"[^\"]+\"|'[^']+'|[^\\s;&|)]+)\\s+)?(add|commit)\\b"));
(.cwd? // "") as $cwd
| ( (.message.content? | if type == "array" then .[] else empty end)
    | select(.type? == "tool_use")
    | ( ((.input.file_path? // empty), (.input.path? // empty),
         (.input.notebook_path? // empty), dir_args) | "P\t\($cwd)\t\(.)" ),
      ( select(mutates) | "M\t\($cwd)" ) ),
  ( if $cwd != "" then "C\t\($cwd)" else empty end )
