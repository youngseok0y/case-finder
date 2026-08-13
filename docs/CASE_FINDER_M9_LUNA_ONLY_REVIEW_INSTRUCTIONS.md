# M9 Luna-only blind review instructions

## Packet

Review only the private packet:

`test/private/m9-blind30/luna_blind_packet.json`

The packet contains only the corrected Luna-native rerun. It has 30 questions and 65 deduplicated evidence samples. Do not open `luna-rerun.json`, `luna_sealed_unmask.json`, the full M9 `run.json`, or any Luna session directory before labels are locked.

Do not reuse `M9_BLIND30_LABELS.json`. That file belongs to the earlier packet, which did not contain Luna samples.

## Label rubric

Assign exactly one label to every packet sample:

- `DIRECT`: directly resolves the question's core legal issue.
- `STRONG_SUPPORT`: materially supports the issue but is not a direct resolution or needs a meaningful caveat.
- `WEAK_SUPPORT`: plausibly related but peripheral, incomplete, or weakly useful.
- `IRRELEVANT`: does not materially support the question.
- `UNRESOLVED`: the source cannot be checked or the evidence is insufficient for a reliable judgment.

If the official source locator cannot be accessed, use `UNRESOLVED` and add `source_access` to `issue_axes`.

## Output format

Save the completed labels as:

`test/private/m9-blind30/M9_LUNA_LABELS.json`

Use one object per sample in a JSON array:

```json
[
  {
    "sample_id": "S-001",
    "label": "DIRECT",
    "issue_axes": []
  }
]
```

The output must contain exactly 65 unique `sample_id` values from the packet. Do not add arm, model, rank, quota, or runtime fields. The Luna arm mapping remains sealed until validation is complete.
