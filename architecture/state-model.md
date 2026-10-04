# State model

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

This document defines what "state" means for a Novera record, how versions are counted, how a version is referenced and how its digest is computed.

## Current state and history

A versioned Novera record (participant, asset, workflow, evidence) has exactly one **current state**: the record's content at its highest confirmed `version`.

- `version` starts at 1 when the record is created and increases by exactly 1 for each confirmed state transition.
- The current state changes **only** when a `state_transition` NoveraEvent is recorded for the record. Proposals, validations, confirmations and rejections never change current state on their own. See [event-model.md](event-model.md).
- A NovaDeed workflow embeds its transition history in `transitions`. The history is contiguous (`sequence` 1, 2, …, n), starts with `from: null`, chains each `from` to the previous `to`, and its last `to` equals `workflowState`. The workflow's `version` equals the number of transitions.

Policy results and events are immutable. A policy result is replaced by recording a new result that names the earlier one in `supersedes`; it is never edited.

## State references

A **state reference** (`stateRef` in [common.schema.json](../schemas/common.schema.json)) identifies one version of one record:

```json
{
  "subjectType": "workflow",
  "subjectId": "wfl_…",
  "version": 5,
  "digest": { "algorithm": "sha-256", "value": "…" }
}
```

State references appear in events (`previousStateRef`, `proposedStateRef`, `confirmedStateRef`) and in policy results (`inputStateRefs`). They let every party check that they are discussing exactly the same state.

## State projection

The **state projection** of a record is the record with these top-level members removed:

| Removed member | Reason |
| --- | --- |
| `transitions` | History, not state. Including it would make a proposed state's digest depend on the event that has not yet been recorded. |
| `updatedAt` | Bookkeeping. It changes when the transition is applied, after the state was proposed. |
| `metadata` | Non-normative by definition. |

Every other member, including `version`, `createdAt`, `status` or `workflowState`, references and nested objects, is part of the projection.

## State digest

The **state digest** of a record version is:

```text
SHA-256( UTF-8( JCS( state projection ) ) )
```

where JCS is the JSON Canonicalization Scheme, [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785). The digest is written as lowercase hexadecimal with `algorithm: "sha-256"`.

Properties of this definition:

- A proposer can compute the digest of the state it is proposing **before** the transition is applied, because the projection excludes the transition history and `updatedAt`.
- Any party holding a copy of the record can recompute the digest and compare it with the one in an event or policy result.
- Two implementations that agree on the content of a version agree on its digest, independent of key order or whitespace.

The validator implements this definition (`stateProjection`, `canonicalize` and `recordDigest` in [scripts/validate-schemas.mjs](../scripts/validate-schemas.mjs)) and checks that every state reference in the examples matches the referenced example record.

Other algorithms in the `digest` definition (`sha-384`, `sha-512`, `sha3-256`) are permitted for content digests. For state digests at v0.1, implementations MUST support `sha-256` and SHOULD use it.

> **Open question.** RFC 8785 serializes numbers using ECMAScript rules, which every implementation language must reproduce exactly. In v0.1 the only numbers inside a state projection are `version` and NovaRegistry asset `attributes`, which permit any JSON number. Implementations SHOULD express non-integer quantities (areas, amounts, rates) as decimal strings with an explicit unit until this is resolved. A future revision may restrict numbers in state to integers within the IEEE 754 safe range.

## Optimistic concurrency

Every proposal and every state transition names the version it is based on in `previousStateRef`.

- An implementation MUST reject a proposal or state transition whose `previousStateRef` is not the subject's current version.
- `proposedStateRef.version` and `confirmedStateRef.version` MUST equal `previousStateRef.version + 1`, or 1 when `previousStateRef` is null because the record is being created.
- A `state_transition` that applies a proposal MUST carry a `confirmedStateRef` identical to that proposal's `proposedStateRef`. An implementation MUST NOT apply a state other than the one that was validated and confirmed.

These rules prevent lost updates, stale approvals and replay of an old transition against a newer record. The validator checks the version arithmetic and the proposed/confirmed equality.

## What state is not

- A Novera record's state is the state of a **coordination record**. It is not the legal state of an asset, a title, a security or an identity. See [trust-boundaries.md](trust-boundaries.md).
- State is not network state. A state digest MAY be anchored to a network through a Network Adapter, but an anchor proves only that a digest was published, not that the state is correct or legally effective. See [network-adapters.md](network-adapters.md).
- State integrity is not event-history integrity. Because transition history is intentionally excluded from the state projection, implementations that claim a tamper-evident audit trail MUST also maintain the separate event-chain commitment in [event-integrity.md](event-integrity.md).

## Storage

This specification does not define a storage engine. An implementation MAY store current state and derive history from events, store both, or persist digests through a Network Adapter. Whatever it does, it MUST be able to produce the record for any confirmed version referenced by an event it has accepted, or explain why that version is no longer retained under its retention policy.
