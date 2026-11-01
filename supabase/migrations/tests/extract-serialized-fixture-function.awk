# Extract exactly one complete dollar-quoted function from trusted fixture SQL.
BEGIN { found = 0; active = 0; closed = 0 }
index($0, "CREATE OR REPLACE FUNCTION " function_name "(") == 1 {
  found++
  active = 1
}
active { print }
active && /^[[:space:]]*\$\$;[[:space:]]*$/ {
  active = 0
  closed++
}
END {
  if (found != 1 || closed != 1 || active) {
    print "fixture function extraction failed: " function_name > "/dev/stderr"
    exit 1
  }
}
