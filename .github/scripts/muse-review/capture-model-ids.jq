[
  .events[]?
  | select(.payload_type == "session.tokenUsage")
  | .payload.modelId
  | select(type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"))
] | unique[]
