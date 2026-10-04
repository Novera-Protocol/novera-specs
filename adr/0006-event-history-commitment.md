# ADR 0006: Separate state and audit-history commitments

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The state digest intentionally excludes transition history, `updatedAt` and metadata. This lets parties agree on the exact proposed state before a transition is appended.

That design means the state digest alone cannot reveal whether historical events were modified, removed, inserted or reordered. Novera's audit trail therefore needs an integrity commitment that is independent of the current-state commitment.

## Decision

Novera maintains two distinct cryptographic commitments:

1. the existing state digest, defined in [architecture/state-model.md](../architecture/state-model.md); and
2. a per-subject append-only event-history digest chain, defined in [architecture/event-integrity.md](../architecture/event-integrity.md).

Each accepted event has a canonical event digest. Each chain entry commits to the deployment, subject, contiguous event sequence, previous chain digest and current event digest. The latest digest is the subject event-chain head.

Signed event envelopes commit to the preceding chain digest so actor authentication and history position are bound together.

Network Adapters MAY anchor event-chain heads or batched commitments, but anchoring remains optional and chain-agnostic.

## Consequences

- State equality does not imply history equality, and the specification makes that distinction explicit.
- Modifying old event history changes the chain head even when current state is unchanged.
- Implementations need transactional append semantics for concurrent events.
- Network anchoring can prove existence of an audit commitment without putting personal data or full records on-chain.
- The current repository validator is not a runtime event store and does not claim to implement tamper evidence.

## Alternatives considered

### Include transition history in the state digest

Rejected. It would make a proposed state's digest depend on history that is appended only when the transition is applied, complicating proposal/confirmation semantics.

### Rely on database audit logs only

Rejected as a protocol guarantee. Database audit features are deployment-specific and do not provide a common interoperable commitment.

### Require a blockchain transaction for every event

Rejected. It would violate the chain-agnostic core, leak unnecessary activity metadata and impose cost/latency on deployments that do not need per-event anchoring.
