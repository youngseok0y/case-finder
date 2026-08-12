# CASE FINDER M6E-B — D Internal Trace Instrumentation & Gate Revalidation

Status: `M6E_D_TRACE_REVALIDATION_COMPLETE`

Review gate: `M6E_USER_REVIEW_REQUIRED`

Recommendation: `B3_DA6_GATE_NOT_JUSTIFIED`

## 1. Scope and authorization

This run implements the authorized M6E-B instrumentation-only experiment. The purpose was to observe D's internal selection and validation signals and revalidate whether a deterministic rescue gate is justified. The experiment did not implement a gate and did not change the product's model, prompt, JSON schema, search, ranking, preview, fallback, validator, renderer, RPM/RPD policy, or D's two-call behavior.

The D trace stores hashes for search queries and selected case keys; raw question text and raw query text are not written to tracked artifacts. The trace is emitted only when `M6E_D_TRACE=1`; the parity test confirms that trace-off and trace-on produce the same product output and selector/finalization inputs.

## 2. Checkpoints and execution

Instrumentation parity passed:

`M6E_D_TRACE_INSTRUMENTATION_PARITY_PASS`

The parity assertion covered product output, selector input, finalization input, and trace fields for plan, candidates, raw selection, and final selection.

The private holdout was then run exactly once for each of PH01–PH30 with arm `D` only. No A6 or AO calls were made, and no new private holdout set was created.

| Measure | Result |
|---|---:|
| D-only runs | 30 |
| Protocol pass / fail | 30 / 0 |
| Gemini requests | 60 (2 per run) |
| Retries | 0 |
| RPM wait events | 0 |
| RPM/RPD hard stops | 0 / 0 |
| MCP calls | 1,317 |
| Local RPD | 1 → 61 |
| Rendered items verified | 30 / 30 |

The initial artifact-directory omission was repaired before rebuilding the private artifacts; the repair added no external calls and did not alter the completed D-only sample.

## 3. Instrumented signal coverage

The trace covers:

- plan counts for keywords, domains, and law names;
- per-search domain, query hash, exposed result count, uniqueness/duplicate yield, and zero-result dispersion;
- raw candidate count and candidate-source ratios;
- pre-preview ranking count and top-five score margins;
- preview presence/missingness and post-preview ranking;
- raw selector count, direct count/ratio, keyword-match summary, and selected case-key hashes;
- final selected count, direct/related counts, ranked-fill state, and validator pass/fail counts.

The validator result was recorded after the existing holdout protocol validation. No validation rule was changed.

## 4. Frozen comparator and observed stability

The frozen PH labels remained unchanged:

- `D_WIN`: PH01, PH02, PH03, PH05, PH09, PH14, PH16, PH17, PH18, PH22, PH23, PH24, PH27, PH28, PH30 (n=15)
- `A6_RESCUEABLE`: PH07, PH08, PH10, PH11, PH12, PH15, PH20, PH26 (n=8)
- `AO_ONLY_LOSS`: PH19, PH21 (n=2)
- `TIE`: PH04, PH06, PH13, PH25, PH29 (n=5)

The D-only rerun showed material run-to-run selection variance against the frozen comparator: mean selected-set Jaccard was `0.4444`, selected-set membership changed for `22/30`, and direct-result count changed for `12/30`. This variance is a central constraint on interpreting any one-shot deterministic gate.

### Group signal means

| Group | n | Raw candidates | Rank 1–2 margin | Top-five preview missing | Zero-result query ratio | Raw selected | Raw direct |
|---|---:|---:|---:|---:|---:|---:|---:|
| D_WIN | 15 | 140.867 | 10.617 | 0.307 | 0.170 | 1.333 | 0.600 |
| A6_RESCUEABLE | 8 | 150.375 | 5.754 | 0.125 | 0.282 | 1.500 | 0.625 |
| AO_ONLY_LOSS | 2 | 130.500 | 0.000 | 0.300 | 0.000 | 0.500 | 0.000 |
| TIE | 5 | 137.200 | 5.159 | 0.160 | 0.000 | 1.200 | 0.600 |

The five largest absolute D_WIN versus A6_RESCUEABLE mean separations were:

1. `raw_candidate_count`: 9.508
2. `rank1_rank2_margin`: 4.862
3. `rank1_rank3_margin`: 3.495
4. `candidate_yield_stddev`: 2.351
5. `unique_candidate_yield_mean`: 2.341

These are descriptive separations only; they are not a trained or validated classifier.

## 5. Candidate deterministic gates

The following three simple conditions were evaluated against the frozen comparator. `A6_RESCUEABLE` is treated as the rescue-positive group for this diagnostic.

| Condition | Triggers | Rescue TP / FN | Recall | Precision | D_WIN false triggers | Preservation specificity | Non-beneficial trigger rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| `raw_selection_empty == true` | 7 | 1 / 7 | 0.125 | 0.143 | 3 | 0.800 | 0.857 |
| `raw_selected_count <= 1` | 19 | 6 / 2 | 0.750 | 0.316 | 9 | 0.400 | 0.684 |
| `rank1_rank2_margin <= 5` | 13 | 4 / 4 | 0.500 | 0.308 | 5 | 0.667 | 0.692 |

The trigger sets also include tie and AO-only-loss cases. The best recall among these simple conditions therefore comes with low precision, weak preservation specificity, and a high non-beneficial trigger rate. The observed stochasticity further weakens confidence that a threshold selected from this sample would remain stable.

## 6. Recommendation and stop condition

Recommendation: `B3_DA6_GATE_NOT_JUSTIFIED`

The trace identifies useful diagnostic dimensions, especially rank-margin and raw-selection sparsity, but this experiment does not justify productizing a D→A6 deterministic gate. No gate, `evidence_state`, DA6 path, A6/AO rerun, or new private holdout was added.

This report is the handoff point for external/user review. Work stops here at:

`M6E_D_TRACE_REVALIDATION_COMPLETE`

`M6E_USER_REVIEW_REQUIRED`

Private run logs and the private blind packet remain under the local ignored test-private path. The tracked report contains aggregate results and question identifiers only; it does not contain raw questions or search queries.
