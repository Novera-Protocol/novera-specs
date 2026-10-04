# Event history integrity

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

**Status: integrity model specified; no production event log, signatures or network anchor is implemented in this repository.**

Related decision: [ADR 0006 — Separate state and audit-history commitments](../adr/0006-event-history-commitment.md)

## Purpose

The Novera state digest answers: **what exact state was proposed, validated and confirmed?**

It intentionally excludes transition history. That is correct for optimistic state transitions, but it does not by itself answer a different question: **has the accepted event history been rewritten?**

Novera therefore defines a separate audit-history commitment.

## Two independent commitments

A conforming implementation distinguishes:

1. **State commitment** — `SHA-256(JCS(state projection))`, defined in [state-model.md](state-model.md).
2. **Event-history commitment** — a per-subject append-only digest chain defined here.

Neither replaces the other.

Changing current state changes the state commitment. Changing, removing, inserting or reordering an accepted historical event changes the event-history commitment.

## Event digest

For each accepted NoveraEvent:

```text
eventDigest = SHA-256( UTF-8( JCS( event ) ) )
```

The event digest covers the complete event record, including its identifiers, state references, actor claim, causality, evidence references, policy-result references, provenance and timestamp.

## Per-subject event chain

Each subject maintains one ordered event chain. For the first accepted event for a subject:

```text
chainDigest_1 =
  SHA-256(
    UTF-8(
      JCS({
        domain: "noveraprotocol:event-chain:v0.1",
        deploymentId,
        subjectType,
        subjectId,
        sequence: 1,
        previousEventChainDigest: null,
        eventDigest
      })
    )
  )
```

For every later accepted event:

```text
chainDigest_n =
  SHA-256(
    UTF-8(
      JCS({
        domain: "noveraprotocol:event-chain:v0.1",
        deploymentId,
        subjectType,
        subjectId,
        sequence: n,
        previousEventChainDigest: chainDigest_(n-1),
        eventDigest
      })
    )
  )
```

The latest value is the subject's **event-chain head**.

## Ordering

The chain sequence is the acceptance order of immutable events for one subject. It is not wall-clock ordering and it is not the workflow state version.

Proposals, validations, confirmations, rejections, external observations and state transitions can all appear in the chain. Only state-transition events alter current state, but every accepted event alters the event-chain head.

An implementation MUST assign each accepted subject event exactly one contiguous chain sequence number.

## Integrity guarantees

A conforming event store MUST be able to demonstrate that:

- every accepted event has exactly one event digest;
- every chain entry names the immediately preceding chain digest;
- sequence numbers are contiguous;
- the stored event recomputes to the event digest;
- the stored chain entry recomputes to the chain digest;
- the persisted chain head equals the recomputed head.

Deleting, modifying, inserting or reordering a past event necessarily changes the recomputed chain head.

The chain proves consistency of Novera's event history. It does **not** prove that an actor was legally authorized, that an external source was truthful or that a transaction was legally effective.

## Relationship to signed envelopes

The signed envelope specified in [event-authentication.md](event-authentication.md) commits to:

- the event digest;
- the preceding event-chain digest;
- the deployment domain;
- the signer identity and key binding.

This binds the actor's signature to both the exact event and the history position it was accepted against.

Concurrent producers MUST use transactional or consensus-backed append semantics so two different events cannot both become the same next chain entry.

## Anchoring

A Network Adapter MAY anchor:

- one subject event-chain head;
- a batch or Merkle root of many subject chain heads; or
- a deployment checkpoint that commits to many chains.

The network reference MUST remain outside the core identifier model and MUST follow [network-adapters.md](network-adapters.md).

An anchor demonstrates that a commitment existed in network history. It does not make the underlying state legally authoritative.

## Retention and erasure

The integrity chain MUST NOT contain personal data. It contains digests and opaque identifiers only.

If a deployment lawfully removes or cryptographically destroys protected off-chain content under its retention policy, it MAY retain event and chain commitments where permitted. The privacy and erasure analysis for real deployments remains a required design review; this specification does not claim that retaining a digest is always legally permissible.

## Conformance requirement

Before any deployment is described as tamper-evident, it MUST implement equivalent guarantees for event-history integrity and MUST test history modification, deletion, insertion and reordering failures.

The repository's current validator does not implement a production event store and therefore does not claim runtime tamper evidence.
