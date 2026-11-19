function empty_finding(line) {
  return line == "- **High:** No high-severity issues found." ||
         line == "- **Medium:** No medium-severity issues found." ||
         line == "- **Low:** No low-severity issues found."
}
{
  sub(/\r$/, "")
  sub(/[ \t]+$/, "")
  if (pending != "") {
    if ($0 ~ /^[[:space:]]*$/) { blanks = blanks $0 "\n"; next }
    if ($0 !~ /^[-*] / && $0 != "## Suggested next steps") print pending
    printf "%s", blanks
    blanks = ""
    pending = ""
  }
  if (empty_finding($0)) { pending = $0; next }
  print
}
END { printf "%s", blanks }
