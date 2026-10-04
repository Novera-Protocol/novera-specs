# ADR 0004 — Event-driven state transitions

- **Status:** Accepted for specification v0.1
- **Date:** 2026-10-03
- **Scope:** NoveraEvent, the state model, and every versioned record (participant, asset, workflow, evidence)

## Context

A Novera workflow involves several parties and systems, each of which may need to know what changed, who requested it, on what basis and in which order. If records could be edited in place, a reviewer could not reconstruct how a record reached its current state, two actors could overwrite each other's changes, and a stale approval could be applied to a record that has since changed.

The coordination role defined in [ADR 0002](0002-authoritative-state-boundary.md) and the proposal-only rule for assistive systems in [ADR 0003](0003-ai-non-authoritative.md) both need a single, explicit mechanism through which state changes.

## Decision

Every material state transition MUST produce an explicit NoveraEvent that identifies the actor, the provenance, the evidence and policy results relied on, and the resulting state.

1. **Events are the only path to state change.** Current state changes only when a `state_transition` event is recorded. `proposal`, `validation`, `confirmation`, `rejection` and `external_observation` events never change state.
2. **Separation of request, check, approval and application.** A change is normally represented as `proposal` → `validation` → `confirmation` → `state_transition`, linked through `causedBy`. Only an actor with `actorType: "system"`, representing a deterministic Novera component, may emit `state_transition`.
3. **Explicit state references.** Each event carries `previousStateRef` and, by type, `proposedStateRef` or `confirmedStateRef`. A state reference names the subject, the version and the SHA-256 digest of the JCS-canonicalized state projection ([state-model.md](../architecture/state-model.md)). A `state_transition`'s `confirmedStateRef` MUST equal the proposal's `proposedStateRef`.
4. **Optimistic concurrency.** A proposal or transition whose `previousStateRef` is not the subject's current version MUST be rejected. Versions increase by exactly one per transition.
5. **Ordering by version, not time.** Events for a subject are ordered by the version they produce. Timestamps MUST be consistent with `causedBy` but MUST NOT be the sole basis for ordering.
6. **Idempotency.** Event identifiers are unique. An `idempotencyKey` repeated by the same actor is a retry and MUST NOT be applied twice.
7. **External facts enter as observations.** Reports from adapters and external providers are `external_observation` events. Acting on one requires a separate proposal.
8. **Mandatory fields.** Every event carries `actorRef`, `provenance`, `evidenceRefs` and `policyResultRefs`, which may be empty arrays but MUST be present, so that the absence of evidence is explicit.

## What v0.1 does and does not provide

| Provided in v0.1 (specified; checked by the validator on synthetic examples) | Not provided in v0.1 |
| --- | --- |
| Event schema with the actor-type authority matrix | Event signing or a signature envelope |
| Required state references by event type | Actor authentication or key management |
| Version arithmetic and proposed/confirmed digest equality | An event store, persistence or replication |
| `causedBy` references and timestamp consistency | Enforcement of workflow-specific authorization rules (who may confirm what) |
| Consistency of example events with example records | Resolution of `requiredFor` policy gates against current policy results at transition time |
| | Any production deployment |

The items on the right are implementation responsibilities or open questions for later revisions. The schema can state that a confirmation came from a participant; it cannot prove that the participant was authorized to give it.

## Consequences

- The history of every record can be reconstructed and audited from its events.
- Concurrent or stale changes fail explicitly instead of silently overwriting each other.
- Assistive systems, adapters and external providers can contribute information without being able to change state.
- Each change costs several events and requires a confirmation step. For low-risk updates this is more overhead than direct editing; the specification accepts that cost.
- Events are immutable. Corrections are new transitions, not edits to old events.
- Integrity of the event log depends on implementation controls until a signing model is specified.

## Alternatives considered

| Alternative | Reason not chosen |
| --- | --- |
| Mutable records with an audit log | The log becomes secondary and can diverge from the record. |
| Order events by timestamp | Producers' clocks disagree; ordering by version is deterministic. |
| Single combined "change" event | Merges request, check and approval, so it cannot express that a different actor must approve. |
| Require on-chain anchoring of every event | Contradicts [ADR 0001](0001-chain-agnostic-core.md); anchoring remains an optional adapter function. |

## Related

[event-model.md](../architecture/event-model.md) · [state-model.md](../architecture/state-model.md) · [event.schema.json](../schemas/event.schema.json) · [real-estate-sequence/](../examples/real-estate-sequence/)
