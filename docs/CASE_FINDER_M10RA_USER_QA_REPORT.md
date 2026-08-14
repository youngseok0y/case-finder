# Case Finder M10R-A User QA Report

Terminal: `M10RA_USER_QA_PASS` (live representative QA passed; golden hit variance accepted)
Base SHA: `b48f38faf06945dc56b2ef9af2216fde900bd133`
Final SHA: pending publish (working tree)
Branch: `codex/m10r-codex-sdk`
Publish commit: pending

## QA-A Luna related laws

Result: `PASS` for deterministic product mapping and representative live Luna QA

Implementation:

- Verified Luna case detail `sections.참조조문` is parsed with the existing statute-reference parser.
- Existing provider law search/detail enrichment is executed through the restricted `LegalToolGateway` after the model turn.
- Canonical, provider-linked `lawReferences` are placed on the result and verified case items.
- Shared statutes are deduplicated; law enrichment failure leaves verified precedent items successful.

Provider provenance: PASS. Law links are derived from provider law search metadata or the existing validated law detail URL.

Extra Luna turns added: NO
Law enrichment failure affects case SUCCESS: NO

Deterministic test query: `손해배상`
Selected cases: 2 verified fixture cases
참조조문 observed: `민법 제750조` on both cases
Rendered law references: one deduplicated `민법 제750조` entry with provider link and provider text

Representative live Luna QA:

- Initial natural query completed as `NO_RESULT` with no runtime error.
- UI-equivalent `POST /ask` completed in 45.2 seconds with `route=natural`, `stage=LUNA_NATIVE`, `terminalState=SUCCESS`, `outputValid=true`, five verified selected cases, and four provider-backed law references.
- The Luna intro used natural Korean 해요체, and `validationFailures` was empty after the server's natural-result validator.
- The golden query's expected `99두2963` was not in `candidateCaseNumbers`; therefore it was not a validator rejection or FinalSelectionGate removal. It was absent upstream from the retrieved candidate pool. This is accepted under the M10R-A golden-hit variance requirement.
- A separate diagnostic-only SDK retry later exceeded 360 seconds, but the actual local user path succeeded and remains the acceptance evidence.

## QA-B Korean tone

Result: `PASS` for prompt contract and live Gemini/Luna samples

Gemini prompt changed: YES, `prompts/select.txt` only; selection semantics and schema unchanged.
Luna prompt changed: YES, intro style instruction only; legal MCP, schema, model, and reasoning rules unchanged.
Extra model calls added: NO

Gemini sample intro: live QA completed in 10.6 seconds with `SUCCESS`, two verified cases, two law references, and `관련 판례를 안내해 드릴게요.`
Luna sample intro: live UI QA completed with a 해요체 ending (`살펴봐요`).

Provider legal text rewritten: NO

Deterministic prompt tests confirm both product prompts require consistent 해요체 and reject mixed 하십시오체/반말/report style guidance.

## QA-C Historical case numbers

Result: `PASS`

99두2963 extraction: PASS; extracted as a `precedent` direct case without four-digit expansion.
99두2963 route: PASS; `routeQuery()` returns `direct`.
99두2963 matching: PASS; `caseNumberMatches()` and `caseNumberIncludes()` accept the provider-compatible two-digit identity.
99두2963 EvidenceLedger verification: PASS; observed search plus non-empty provider detail sets `detailVerified=true` and final eligibility.
99두2963 live direct QA: PASS; actual MCP/API lookup returned `verified`, provider id `229683`, official link `https://www.law.go.kr/LSW/precInfoP.do?precSeq=229683`, terminal `SUCCESS`.

Modern case regression: PASS for `2000다12345`, `2021누40722`, and `2017다292343` routing.
Compound-case regression: PASS for `99두2963, 2964`; members remain `99두2963` and `99두2964`.
Malformed input rejection: PASS for `9두2963`, `999두2963`, and `99ABC2963`.

## Quota

Changed: NO
Reason: explicitly out of M10R-A scope.

## Frozen invariants

SDK runtime changed: NO
Luna model changed: NO
Luna reasoning effort changed: NO
MCP tool surface changed: NO
LegalToolGateway policy changed: NO
EvidenceLedger verification weakened: NO
FinalSelectionGate changed: NO
Gemini D search behavior changed: NO
Ranking changed: NO
Silent fallback changed: NO

## Verification

npm run check: PASS
npm run product:test: PASS, 67/67
npm run verify: PASS, 67/67
git diff --check: PASS

## Remaining issues

The requested code and deterministic QA are complete. Representative Gemini and Luna natural-language QA succeeded in the user-equivalent environment. One duplicate Luna diagnostic exceeded its extended timeout, so provider latency remains an operational observation, but it did not prevent the actual `/ask` user path from completing successfully.

## Final recommendation

`M10RA_USER_QA_PASS`

The three requested product corrections, deterministic/regression checks, and representative live Gemini/Luna user-path checks pass. Golden expected-case hit variance is accepted as instructed; no validator or evidence-integrity regression was observed.
