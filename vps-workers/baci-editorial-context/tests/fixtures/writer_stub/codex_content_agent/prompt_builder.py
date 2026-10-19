def build_prompt(*, task_type, today, window_start, candidate):
    platform_rules = 'Base platform rules.\n'
    platform_rules += (
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        'candidate text'
        if candidate
        else ""
    )
    if task_type == "platform_marketing":
        try:
            from codex_content_agent.platform_capabilities import capability_context
            platform_rules += capability_context()
        except Exception:
            platform_rules += "Baci capability evidence: Register unavailable, invalid or stale. Documentation omission is not evidence of feature absence. Hold unsupported Baci capability comparisons for editorial verification.\n"
    if candidate and candidate.get("status") == "no_candidate":
        platform_rules += 'no candidate'
    return platform_rules
