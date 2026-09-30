.findings |= (map(select(type == "object"
  and (.path | type) == "string"
  and (.path | length) > 0
  and ((.line | tostring) | test("^[0-9]+$"))
  and ((.line | tonumber?) // -1) >= 0
  and ((.title // "") | type) == "string"
  and ((.body // "") | type) == "string"))
  | map(.line |= tonumber)
  | map(.severity |= ((if type == "string" then . else "low" end)
    | (if test("^(critical|high|medium|low)$") then . else "low" end))))
| .next_steps |= ([(.[]?) | select(type == "string")])
