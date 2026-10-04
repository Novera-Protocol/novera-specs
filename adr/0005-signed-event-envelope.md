# ADR 0005: Signed event envelope and domain separation

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

NoveraEvent contains `actorRef`, `role` and optional `onBehalfOf`, but those fields are claims. The v0.1 event schema cannot prove which actor produced an event, whether a key was valid, whether delegation existed or whether a signed action is being replayed into a different deployment.

Building a runtime around self-declared actor authority would make later hardening invasive and would undermine the authorization model.

## Decision

Novera separates the event payload from a deployment-level signed envelope.

A conforming deployment that processes real participant data, real documents or value MUST cryptographically bind an accepted event to:

- its canonical event digest;
- a protocol-purpose domain identifier;
- the accepting deployment identifier;
- the preceding subject event-chain digest;
- an authenticated signer key bound to the event's actor;
- delegation authority when `onBehalfOf` is used.

The normative contract and verification order are specified in [architecture/event-authentication.md](../architecture/event-authentication.md).

v0.1 does not select a signature algorithm, credential format, wallet model or PKI. Those are implementation choices subject to future conformance profiles.

## Consequences

- An `actorRef` never becomes proof merely because it is well formed.
- Cross-deployment replay is prevented by signed domain/deployment separation.
- Delegation becomes an explicit authorization dependency rather than free-form metadata.
- Key management becomes an implementation requirement before real-data/value operation.
- Test deployments may use test keys, but production claims require the same verification semantics.

## Alternatives considered

### Put signatures directly into NoveraEvent

Rejected for v0.1. It couples the core event payload to a specific signing representation and makes alternate authentication environments harder to support.

### Rely only on authenticated API sessions

Rejected. Session authentication does not create a portable cryptographic binding between the actor, the exact event, the deployment domain and the audit-history position.

### Defer authentication design until implementation

Rejected. Authorization and replay semantics affect the protocol boundary and should be fixed before runtime code is built.
