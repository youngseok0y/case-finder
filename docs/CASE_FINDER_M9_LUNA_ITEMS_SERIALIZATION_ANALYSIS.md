# M9 Luna result-items serialization analysis

## Symptom

The first M9 full-run artifact had 90 valid adapter records, but its blind packet contained only Gemini D/A6 evidence. Luna records had selected case numbers while `result.items` was empty, so the packet builder silently emitted no Luna samples.

## Root cause

`createCodexNativeAo()` returns the native final-selection fields (`selected`, `rejectedSelected`, protocol diagnostics, telemetry, and ledger state), but it does not produce the deterministic pipeline's `items` array. `createLunaNativeAdapter()` passed that object directly into `toResultContract()`. The common contract therefore applied its default:

```js
items: Array.isArray(result.items) ? result.items : []
```

`buildBlindPacket()` intentionally iterates only `run.result.items`, so the Luna selections were not represented in the blind packet. The model selection itself was not the cause; the failure was in result-contract serialization after the native evidence gate.

## Correction

The Luna adapter now derives contract items from its adapter-scoped `EvidenceLedger` after the native run. Each selected, verified ledger candidate is emitted with:

- provider case identity and raw provider case number;
- verified status and detail sections;
- provider ID;
- an official Law.go.kr detail locator;
- the native `direct`/`related` match.

For administrative-appeal IDs, the generated fallback locator uses the Law.go.kr `decc` JSON detail endpoint rather than the earlier HTML search-result link.

## Corrected rerun

The original full-run and 107-label packet are preserved as historical private artifacts. A Luna-only 30-question rerun was executed after the correction:

- 30 Luna records;
- 65 result items;
- 65 deduplicated Luna packet samples;
- 65 sealed unmask entries;
- 0 contract/pin failures;
- 0 missing provider ID/link failures.

The corrected Luna packet requires a fresh reviewer label file because the earlier label file did not contain these Luna samples.
