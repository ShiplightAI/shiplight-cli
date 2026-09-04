# Contract: Report artifact — per-step variable snapshots

**Status**: normative. **Version**: 1 (artifact `schemaVersion: 3`).
**Conformance vectors**: [report-artifact-vectors.json](./report-artifact-vectors.json).

This document defines the wire format on its own terms. Implementing a reader
requires nothing from the writer's source: everything a consumer must do is
stated here, and every rule has a case in the vectors file. Implements FR-024.

## 1. What this describes

The Shiplight test runner records the test variables as each step saw them,
before and after that step. The snapshots are **display-only**: nothing replays,
resumes, or asserts from them, so a consumer is free to render them however it
likes, and losing them degrades a UI rather than breaking a run.

They appear in two artifacts, with the same per-step shape in both:

| Artifact | Where the step objects live |
| --- | --- |
| `report-data.json` (written per shard, merged by `shiplight report --merge`) | `tests[].steps[]` and `tests[].attempts[].steps[]` |
| The per-test `report.json` uploaded to the cloud | `segments[].resultJson[<stepId>]` |

## 2. Terminology

- **Step list** — one ordered sequence of steps: a single `steps` array, or a
  single `resultJson` object. Each `attempts[]` entry is its own step list, and
  so is each `segments[]` entry.
- **Step object** — one step's fields, including the snapshot fields of §3.
- **Position** — `before` or `after`. Every step has two independent positions.
- **Recorded state** — the variable store a consumer has accumulated so far while
  reading one step list. It starts **empty** at the beginning of every step list.

### 2.1 The two carriers of a step list

The same sequence is carried two ways, and a consumer must map its own form onto
the sequence before applying anything below:

| Carrier | Shape | Step id | Order |
| --- | --- | --- | --- |
| `steps` (in `report-data.json`) | **array** of step objects | the step object's own `stepId` field | array order |
| `resultJson` (in the uploaded `report.json`) | **object**, id → step object | the **key**; the step object does *not* repeat it | each entry's `seq` (see R2) |

`resultJson` is the form the cloud consumes. Each of its entries carries a
**`seq`** — a 0-based integer giving its position in the recorded sequence — so
the order the delta chain needs is data, not a property of how a consumer happens
to iterate the object. Sort the entries by `seq` to obtain the step list. The vectors in §9 express step lists as arrays with an explicit
`stepId` purely so a case is readable; a consumer of the object form maps its
entries onto the same sequence.

## 3. Fields

Per step object, per position, **exactly one form appears, or neither**:

| Field | Type | Meaning |
| --- | --- | --- |
| `contextBefore` | `object` | **Full form.** The complete variable store, as a flat `name → value` map. Authoritative: it *replaces* the recorded state. |
| `contextAfter` | `object` | Same, for the `after` position. |
| `contextBeforeDelta` | `{ set?: object, removed?: string[] }` | **Delta form.** What changed since the recorded state. |
| `contextAfterDelta` | `{ set?: object, removed?: string[] }` | Same, for the `after` position. |

- `set` maps variable name → its new value. Values are arbitrary JSON.
- `removed` lists variable names that no longer exist.
- Both members are omitted when empty, so `{}` is a valid delta.
- A step **never** carries both forms for the same position. It may legally carry
  the full form at one position and the delta form at the other.

## 4. Wire examples

Two steps. The store starts with `user` and `env`; the second step adds `fileId`
and drops `env`.

**Full form** (what an artifact written before this contract looks like):

```json
[
  {
    "stepId": "main.0",
    "contextBefore": { "user": "a@example.com", "env": "beta" },
    "contextAfter":  { "user": "a@example.com", "env": "beta" }
  },
  {
    "stepId": "main.1",
    "contextBefore": { "user": "a@example.com", "env": "beta" },
    "contextAfter":  { "user": "a@example.com", "fileId": 42 }
  }
]
```

**Delta form** — identical information:

```json
[
  {
    "stepId": "main.0",
    "contextBeforeDelta": { "set": { "user": "a@example.com", "env": "beta" } },
    "contextAfterDelta":  {}
  },
  {
    "stepId": "main.1",
    "contextBeforeDelta": {},
    "contextAfterDelta":  { "set": { "fileId": 42 }, "removed": ["env"] }
  }
]
```

Note the first step's delta carries the whole store — it is a delta from the
empty state, which is why there is no separate baseline field. Note also
`main.1`'s empty `contextBeforeDelta`: a snapshot was taken and nothing had
changed since the previous one.

## 5. Rules

1. **R1 — Scope.** The recorded state is per step list. A retry's attempt starts
   from empty, because the run does. A consumer MUST NOT carry state across
   `attempts[]` entries, `segments[]` entries, or tests.
2. **R2 — Order.** Deltas resolve in **recorded order**, and only in that order.
   For the array carrier that is the array order. For the object carrier
   (`resultJson`) a consumer MUST sort the entries by `seq` before resolving —
   do not rely on iteration order, and do not resolve in whatever order the
   consumer's own step model happens to visit ids in. An artifact whose entries
   carry no `seq` was written before this rule and relied on key insertion
   order; fall back to it. A writer MUST NOT emit an integer-like step id
   (`"0"`, `"12"`) — JS-family parsers hoist those ahead of the rest, which
   breaks that fallback.

   Ids may be **hierarchical** (`main.1`, `main.1.2`), but the step list is
   **flat** and its recorded order is the resolution order. A consumer that
   groups steps into phases or rebuilds them as a tree — which is how the cloud
   presents them — is therefore visiting them in a different order than it must
   resolve them in. **Resolve first, over the flat `seq`-ordered sequence, then
   render the resolved snapshots in whatever order the UI wants.** Resolving in
   presentation order produces wrong values with no error.
3. **R3 — Full form is authoritative.** On encountering `contextBefore` /
   `contextAfter`, a consumer MUST **replace** the recorded state with it, not
   merge into it. This is what makes a step list that mixes the two forms — a
   merged report combining shards from either era — well defined.
4. **R4 — Presence is meaningful.** An empty delta (`{}`) means a snapshot was
   taken and nothing had changed. An **absent** field means no snapshot was taken
   at that position; a consumer MUST render nothing there rather than the last
   known state.
5. **R5 — Removals are explicit.** A variable disappearing MUST be read from
   `removed`, never inferred from its absence in `set`.
6. **R6 — `set` before `removed`.** A writer MUST NOT list the same key in both
   members of one delta. A consumer that encounters one anyway MUST apply `set`
   first and `removed` second, so the removal wins — this is the only defined
   resolution, and it must not be left to the order a given implementation
   happens to iterate in.
7. **R7 — Unknown fields.** A consumer MUST ignore fields it does not recognize;
   more may be added to a step object.
8. **R8 — No secrets by construction.** Values flagged sensitive by the run are
   already masked by the writer. A consumer MUST NOT assume the absence of
   sensitive-looking data, and MUST NOT log the snapshots wholesale.

## 6. Reader algorithm

```text
resolve(stepList):
    state = {}                                   # R1: per step list
    for step in stepList:                        # R2: document order
        for position in (before, after):
            full  = step["context" + Position]
            delta = step["context" + Position + "Delta"]
            if full is present:
                state = copy of full             # R3: replace
                step.resolved[position] = state
            else if delta is present:
                state = copy of state
                for (name, value) in delta.set:      state[name] = value
                for name in delta.removed:           remove state[name]
                step.resolved[position] = state
            else:
                step.resolved[position] = absent  # R4
```

Each position MUST get its own copy: a UI that diffs a step's `before` against
its `after` needs two independent objects, and the next step must not mutate what
an earlier one resolved.

## 7. Value cap

Before recording, the writer replaces any oversized value with a **string**
marker — never a truncated object — so a consumer needs no special case to render
one.

Each kind of value is measured, truncated and reported in **one unit**, so the
threshold, the kept prefix and the reported count cannot disagree:

| Value | Measured in | Replaced when | Recorded as |
| --- | --- | --- | --- |
| string | its own characters | length > **1024** | its first **1024** characters, then `… [truncated, <n> chars]` |
| anything else | characters of `JSON.stringify(value)` | that length > **1024** | `[truncated, <n> chars] ` then the first **120** characters of that JSON, then `…` |

`<n>` is the **original total** in that same unit — not the number of characters
dropped. A UI can therefore render "showing 1024 of `<n>`" for a string, and
"1024 of `<n>` characters of JSON" for anything else. Neither count is a byte
count: a non-ASCII value's UTF-8 size is larger than the number reported here.

A value is replaced only when the marker is **shorter** than what it replaces.
Just above the limit the marker costs more than the characters it drops, so a
value slightly over 1024 is recorded whole. A consumer MUST NOT infer from a
value's length alone whether it was truncated — only from the marker.

Two different oversized values whose recorded markers are identical — same
reported length, same prefix — are indistinguishable to a consumer, and a change
between them is recorded as no change. The writer avoids this on its side by
diffing the **uncapped** values, so the change *is* recorded; what a consumer
cannot do is tell the two apart on screen, because the characters that differ
were dropped. Rendering them as equal is correct.

A consumer MAY detect the markers to annotate a value as truncated:

```text
string:      /… \[truncated, (\d+) chars\]$/
non-string:  /^\[truncated, (\d+) chars\] /
```

It MUST NOT try to reconstruct the original — the characters are gone — and it
MUST tolerate a value that merely *looks* like a marker, since a test variable
can hold any string.

## 8. Version signal

`schemaVersion` is a **top-level field of the uploaded per-test `report.json`**,
a sibling of `segments` (`{ "schemaVersion": 3, "result": …, "flaky": …,
"segments": [ … ] }`). An artifact that may carry the delta form declares `3`;
version 2 artifacts only ever carry the full form. `report-data.json` has no
equivalent field anywhere.

This is the field storage and queries key on — "which artifacts might be delta
encoded" is answered by the version, not by scanning steps.

The signal is for storage and queries. It MUST NOT be a parsing prerequisite:
`report-data.json` carries no `schemaVersion` at all, and a merged report can
combine shards written before and after this change. Detection is per step, from
the fields present (§3).

## 9. Conformance

[report-artifact-vectors.json](./report-artifact-vectors.json) holds the cases
every implementation must satisfy. Each case gives an `encoded` step list and the
`resolved` snapshots a correct reader produces:

```json
{ "name": "…", "why": "…", "direction": "both" | "decode",
  "encoded":  [ { "stepId": "main.0", "contextBeforeDelta": … } ],
  "resolved": [ { "stepId": "main.0", "contextBefore": …, "contextAfter": … } ] }
```

- A **reader** must turn `encoded` into `resolved` for every case.
- A **writer** must turn `resolved` into `encoded` for cases marked
  `"direction": "both"`. The `"decode"` cases are shapes a writer never produces
  but a reader must still handle (a v2 artifact, a mixed list).
- A step object in `resolved` omits a position entirely when the reader must
  produce no snapshot there (R4).

Copy the file; do not re-derive the cases. The writer side of this contract runs
the same file as a test (`apps/cli/src/reporter/contractVectors.test.ts`), so a
divergence between the two repos shows up as a failing case rather than as a
rendering bug.

## 10. Why the delta form exists

Measured on 264 real per-test artifacts from one customer org — 306 step lists,
5,757 steps: the engine copies the whole variable store into every step, twice.
That was 217.9 MB of step payload, 58% of it these snapshots, and more than half
of *that* was the repeated variable **names** (~220 mostly-static keys per test).
One test that stored downloaded file bytes in a variable contributed 87 MB alone,
because a Node `Buffer` JSON-encodes as a per-byte number array. A ~435-test run
exceeded V8's ~512 MB maximum string length and the merge died before uploading
anything.

Cap plus delta brings the same run to 9.1 MB.

Diffing against the **previous** step rather than the first is deliberate: on the
same data, a first-step baseline measured 79.5 MB against 18.9 MB, because a key
that changes early is then re-recorded in every later step.

The cost, accepted: a gap in a step list (a run that died mid-test) leaves the
recorded state stale for every later step in that list, where the full form would
have lost only the missing step.

## 11. Non-goals

- Reconstructing a capped value.
- Cross-attempt or cross-test variable history — the state is per step list (R1).
- Any execution semantics. These snapshots are evidence, never an input.
