# Emits tab-separated evidence lines from a session transcript, per tool call:
#   S <cwd>          start of a tool call that ran in <cwd> (resets chained cd)
#   cd <arg>         `cd`/`pushd` target, in command order (changes the running dir)
#   p <arg>          other directory/file the Bash command targets (git -C, tee,
#                    `>`/`>>` redirects); relative to the running dir
#   F <path>         file_path/path/notebook_path of a MUTATING tool (Edit, Write,
#                    NotebookEdit, MultiEdit); relative to <cwd>. Read/Glob/Grep
#                    are deliberately NOT evidence: reading is not touching.
#   M                a mutating action (the tools above, git add/commit, redirects)
#   C <cwd>          the cwd recorded on a transcript entry
# Command evidence is taken only from the Bash tool and only at command
# position, so `echo cd /x` is not a directory change.
def unq: gsub("^[\"']|[\"']$"; "");
def arg: "(\"[^\"]+\"|'[^']+'|[^\\s;&|)<>]+)";
def pos: "(?:^|[;&|(])\\s*";
# One ordered scan (not one scan per operator) so a write that happens BEFORE a
# later `cd` keeps its place in the sequence. Alternatives: (1) cd/pushd/git -C/
# tee, (2) `>`/`>>` redirect target, (3) in-place editors (sed -i, perl -pi),
# whose file operand is the last argument.
def cmd_ops:
  [ scan("(?:" + pos + "(cd|pushd|git\\s+-C|tee(?:\\s+-a)?)\\s+(?:--\\s+)?" + arg + ")"
         + "|(?:(?:^|[^>&0-9<])>>?\\s*" + arg + ")"
         + "|(?:" + pos + "(?:sed\\s+-i\\S*|perl\\s+-pi\\S*)(?:\\s+" + arg + ")+)")
    | if .[0] != null then
        {k: (if .[0] == "cd" or .[0] == "pushd" then "cd" else "p" end), a: (.[1] | unq)}
      elif .[2] != null then {k: "p", a: (.[2] | unq)}
      else {k: "p", a: (.[3] | unq)} end ];
def mutates_cmd:
  test(pos + "git\\s+(-C\\s+" + arg + "\\s+)?(add|commit)\\b")
  or test("(?:^|[^>&0-9<])>>?\\s*[^&\\s]")
  or test(pos + "(tee|sed\\s+-i|perl\\s+-pi)\\b");
def mutating_tool: (.name? // "") | test("^(Edit|Write|NotebookEdit|MultiEdit)$");
(.cwd? // "") as $cwd
| ( (.message.content? | if type == "array" then .[] else empty end)
    | select(.type? == "tool_use")
    | "S\t\($cwd)",
      ( if mutating_tool then
          "M",
          ((.input.file_path? // empty), (.input.path? // empty),
           (.input.notebook_path? // empty) | "F\t\(.)")
        else empty end ),
      ( if (.name? // "") == "Bash" then
          ((.input.command // "") as $c
           | ( if ($c | mutates_cmd) then "M" else empty end ),
             ( $c | cmd_ops[] | "\(.k)\t\(.a)" ))
        else empty end ) ),
  ( if $cwd != "" then "C\t\($cwd)" else empty end )
