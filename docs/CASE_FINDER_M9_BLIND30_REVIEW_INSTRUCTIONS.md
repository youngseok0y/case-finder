# M9 Blind-30 reviewer instructions

## Scope

Review only the generated `blind_packet.json`. The packet is arm-blinded: do not open `run.json`, `sealed_unmask.json`, Luna session directories, or any other execution telemetry before labels are locked.

The packet contains 30 question IDs and one deduplicated sample per observed provider case identity within each question. A question can have zero samples when all three arms returned no candidate; no label is required for such a question. Judge each available sample independently from the question, the case identity/evidence, and the supplied source locator.

## Label rubric

Use exactly one label for every sample:

- `DIRECT`: the case directly resolves the question's core legal issue.
- `STRONG_SUPPORT`: materially supports the issue, but is not a direct resolution or needs a meaningful scope/caveat.
- `WEAK_SUPPORT`: plausibly related, but peripheral, incomplete, or only weakly useful.
- `IRRELEVANT`: does not materially support the question.
- `UNRESOLVED`: the source cannot be checked or the available evidence is insufficient to make a reliable judgment.

Do not infer the originating adapter, model, arm, ranking policy, or expected answer. Do not upgrade a sample because its case number looks familiar. If the source locator is inaccessible, use `UNRESOLVED` and record `source_access` in `issue_axes`.

## Output format

Submit one JSON array containing exactly one object for every `sample_id` in the packet, with no duplicate or missing IDs:

```json
[
  {
    "sample_id": "S-001",
    "label": "DIRECT",
    "issue_axes": []
  }
]
```

`issue_axes` is optional. When used, choose concise values from:

- `case_identity`
- `issue_match`
- `source_access`
- `scope_or_freshness`
- `other`

Labels are final only after the full packet has been reviewed. Do not edit the packet or the sealed unmask file. The arm mapping is unsealed only after label validation is complete.
