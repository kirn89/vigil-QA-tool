# Vigil — Deep-Journey Curation (Design)

**Date:** 2026-06-25
**Status:** Approved for planning
**Supersedes (partial):** the untargeted LLM `map` flow as the source of watched flows

## 1. Problem

Today the set of flows Vigil watches deeply is authored by an LLM that drives the
browser itself (`mapApp` → `propose_flows`) and implicitly decides which journeys
are "flow-worthy." That makes the LLM a **criticality gatekeeper**, which is:

- **subjective** — "critical" has no ground truth;
- **inconsistent** — the same app can yield a different proposed set run-to-run;
- **redundant** — the user can override it anyway; and
- a poor justification for cost — the *selection* call is cheap; the expensive,
  recurring cost is authoring + nightly execution of flows.

We want the **user** to own which journeys are watched deeply, with the LLM demoted
to a **classifier + recommender**, never a gate.

## 2. Decision

Replace "LLM decides the watched set" with:

```
sweep (crawl) → classify (LLM) → journeys list → user selects ≤8
   → lazy author + verify → confirmed (watched nightly)
        │
        └─ verify fails → needs-info fallback (e.g. "needs test login")
           → user supplies creds → re-author
```

- **Breadth is unchanged.** The `sweep` crawler keeps covering every reachable page
  shallowly and cheaply. This is the "include everything" safety net.
- **Depth is user-curated.** Deep journeys are presented as a selectable list; the
  user picks up to a quota of **8** per app. Few candidates → they may select all.
- **LLM role shrinks** to: classify deep vs shallow, flag a recommendation, and
  emit a feasibility hint — plus author the executable steps **only for selected
  journeys** (lazy authoring).

### Rejected alternatives
- **Deep-check everything:** promotes the long tail into the recurring
  execution + LLM-verdict cost we are trying to bound, and multiplies false-alarm
  surface. Breadth `sweep` already covers the tail.
- **Eager authoring of all deep candidates:** pays to author flows nobody selects;
  the executability guarantee it buys is also achievable lazily via the existing
  `verified` gate + fallback.
- **Heuristics-only deep/shallow classification:** considered; we chose LLM
  classification for flexibility on unusual apps, accepting that the run-to-run
  consistency concern is mitigated because the user, not the LLM, makes the final
  selection.

## 3. Components

### 3.1 Crawler enrichment
The sweep crawler already discovers pages (`SweptPage`). Extend its output so each
page carries **interaction signals** the classifier can reason over:

- `hasForm: boolean`
- `inputCount: number`
- `authGated: boolean` (reached only after the login warm-up)
- `actionButtonCount: number` (submit/CTA-like controls)

These are captured read-only during the existing crawl (no extra page loads).
Shallow pages (static/marketing) will have near-zero signals; deep areas
(checkout, settings, dashboards) will not.

### 3.2 Classifier (`src/journeys/classify.ts`, new)
One LLM pass over the enriched crawl output. Produces candidate journeys:

```ts
interface JourneyCandidate {
  name: string;            // plain-English, e.g. "Checkout"
  entryUrl: string;
  depth: 'deep' | 'shallow';
  recommended: boolean;    // LLM suggestion, NOT a gate
  feasibilityHint?: string;// e.g. "needs a test login", "hits payment"
}
```

Only `depth === 'deep'` candidates are persisted/listed. The classifier never
authors steps and never decides the watched set.

### 3.3 Storage — `journey_candidates` table (new migration)
Candidates have no steps yet, so they do **not** belong in `flows` (which requires
a `golden_path`). New table:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| app_id | uuid fk → apps | |
| name | text | |
| entry_url | text | |
| recommended | boolean | |
| feasibility_hint | text null | |
| status | text | `open` \| `selected` \| `needs_info` \| `authored` \| `dismissed` |
| created_at | timestamptz | |

Lifecycle: `open` → (user picks) `selected` → author+verify → `authored`
(a `confirmed` flow now exists) **or** `needs_info` (verify failed; hint shown).

### 3.4 Lazy authoring
On selection, author **only the picked journeys**, reusing the existing targeted
mapper: `mapApp(session, client, { targetJourney: candidate.name })`
([packages/engine/src/map/mapper.ts](../../../packages/engine/src/map/mapper.ts)).
Each authored `GoldenPath` is verified via the existing verify path; on success it
becomes a flow through the existing `proposed → confirmed` + `verified` lifecycle
([packages/engine/src/db/flowsRepo.ts](../../../packages/engine/src/db/flowsRepo.ts)).

### 3.5 Fallback (needs-info)
If authoring fails to verify, the candidate is set to `needs_info` carrying the
reason / feasibility hint (e.g. "needs test login"). The user supplies what's
missing (e.g. credentials via the existing `app:add --login-email/--login-password`)
and re-authors. No silent watching of unbuilt flows.

### 3.6 Quota
At selection time, enforce **≤ 8 confirmed deep flows per app**. Selecting beyond
the remaining quota is rejected with a clear message.

## 4. CLI surface (3 commands)

- `journeys <app>` — classify the latest sweep and list **deep** candidates;
  mark `★` recommended and `⚠` feasibility hint.
- `journeys:select <app> <ids…>` — select ≤ remaining-quota candidates → lazy
  author + verify each → report **built** vs **needs-info**.
- `journeys:author <app> <id>` — retry a `needs_info` candidate (after the user has
  supplied missing creds/data).

## 5. Reuse vs replace

**Reuse:** sweep crawler; `mapApp({ targetJourney })`; executor + verify;
`proposed → confirmed` lifecycle and the `verified` gate; sweep storage patterns.

**Demote:** the untargeted `map` command that auto-proposed a *set* of flows by LLM
judgment. The LLM no longer decides the set; it classifies and authors on request.
`map` remains available for targeted/manual authoring but is no longer the source
of the watched set.

## 6. Data flow (end to end)

1. `sweep <app>` crawls; pages stored with interaction signals.
2. `journeys <app>` runs the classifier over the latest sweep; deep candidates
   stored as `open` in `journey_candidates`; list shown with ★/⚠.
3. `journeys:select <app> <ids…>`: quota-checked → each selected candidate
   `selected` → lazy author via targeted mapper → verify:
   - success → `GoldenPath` saved as a `confirmed` flow; candidate → `authored`;
   - failure → candidate → `needs_info` with hint.
4. `journeys:author <app> <id>` retries a `needs_info` candidate after creds added.
5. Nightly `check` watches the confirmed deep flows; `sweep` continues covering the
   breadth tail.

## 7. Testing

- **Crawler signals:** unit test that enriched fields populate from a fixture page
  (forms/inputs/buttons) and stay zero on a static page.
- **Classifier:** with a `FakeLLMClient`, deep vs shallow split, `recommended` and
  `feasibilityHint` plumb through; only deep candidates persist.
- **Candidates repo:** status transitions `open → selected → authored|needs_info`,
  and `dismissed`.
- **Selection + quota:** ≤8 enforced; over-quota rejected; lazy authoring invoked
  only for picked candidates.
- **Fallback:** verify failure routes candidate to `needs_info` with hint; re-author
  succeeds once creds present.
- Use the existing `fixture-app` and embedded Postgres harness.

## 8. Non-goals

- No change to the breadth `sweep` semantics beyond capturing interaction signals.
- No eager authoring; no removal of `map` (only demotion).
- No UI — CLI only, consistent with the current engine surface.
- Quota is fixed at 8 for now (not plan-tiered).
