.findings |= (map(select(type == "object"
  and (.path | type) == "string"
  and ((.line | tostring) | test("^[0-9]+$"))
  and ((.line | tonumber?) // -1) >= 0)) | map(.line |= tonumber))
