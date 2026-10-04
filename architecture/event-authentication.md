# Event authentication and signed envelopes

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

**Status: protocol contract specified; no production key infrastructure or signature verification is implemented in this repository.**

Related decision: [ADR 0005 — Signed event envelopes and domain separation](../adr/0005-signed-event-envelope.md)

## Purpose

A NoveraEvent states who acted, but the event record by itself is not proof of identity or authority. A conforming implementation that processes real participant data, real documents or value MUST bind accepted events to an authenticated actor and MUST prevent the same signed action from being replayed into another deployment.

The protocol therefore separates:

- the **event payload** — the NoveraEvent defined by [event-model.md](event-model.md);
- the **signed envelope** — deployment and signer context around that payload; and
- **authorization** — whether the authenticated actor is allowed to perform the action under the workflow profile and deployment policy.

Authentication proves which key signed. Authorization decides whether that signer may act.

## SignedEventEnvelope contract

A future implementation MUST produce and verify a signed envelope before an event is accepted into an authoritative deployment event log.

Conceptually:

```json
{
  "envelopeVersion": "0.1",
  "domainId": "noveraprotocol:event-envelope:v0.1",
  "deploymentId": "deployment-specific opaque identifier",
  "eventDigest": {
    "algorithm": "sha-256",
    "value": "<SHA-256 of JCS(NoveraEvent)>"
  },
  "previousEventChainDigest": {
    "algorithm": "sha-256",
    "value": "<previous accepted chain digest for this subject, or genesis>"
  },
  "signer": {
    "actorType": "participant",
    "actorId": "ptc_…",
    "keyId": "deployment-scoped key identifier"
  },
  "delegationRef": "optional deployment-scoped delegation record",
  "issuedAt": "RFC 3339 timestamp",
  "signature": {
    "suite": "deployment-selected approved signature suite",
    "value": "<signature bytes in deployment encoding>"
  }
}
```

This object is illustrative syntax. v0.1 does not select a signature suite or transport encoding, but the signed fields and verification requirements below are normative.

## Signing input

Before signature generation:

1. canonicalize the NoveraEvent with RFC 8785 (JCS);
2. compute `eventDigest = SHA-256(JCS(event))`;
3. construct the unsigned envelope fields: `envelopeVersion`, `domainId`, `deploymentId`, `eventDigest`, `previousEventChainDigest`, `signer`, optional `delegationRef`, and `issuedAt`;
4. canonicalize those unsigned fields with JCS;
5. sign that canonical byte sequence.

The signature MUST cover `domainId` and `deploymentId`. A signature valid in one deployment MUST NOT be valid in another simply because the event payload is identical.

## Domain separation and replay protection

- `domainId` MUST identify the protocol purpose and envelope version. For v0.1 the reserved value is `noveraprotocol:event-envelope:v0.1`.
- `deploymentId` MUST uniquely identify the accepting deployment or security domain.
- An implementation MUST reject an envelope whose `deploymentId` is not its own.
- The event's `eventId` MUST be unique within the deployment.
- The event store MUST enforce the optimistic-concurrency rules in [state-model.md](state-model.md).
- The envelope MUST commit to the preceding subject event-chain digest as specified in [event-integrity.md](event-integrity.md).

These controls are complementary: event IDs prevent duplicates, state versions prevent stale transitions, deployment binding prevents cross-domain replay, and the chain commitment exposes history rewriting.

## Actor authentication and key binding

Every signer key accepted by a deployment MUST be bound to exactly one authenticated actor identity for the period in which the key is valid.

A deployment MUST maintain, outside protocol records that are visible to untrusted clients:

- the actor identifier;
- actor type;
- key identifier and public verification material;
- activation and revocation times;
- allowed authentication method or trust source;
- key status.

An `actorRef` inside an event is only a claim. The implementation MUST compare it with the authenticated signer binding before accepting the event. A participant MUST NOT be able to sign an event as `system`, `adapter` or another participant simply by changing `actorRef`.

System and adapter keys SHOULD use dedicated secret management, and value-bearing deployments SHOULD use hardware-backed or equivalently protected keys.

## Delegation and onBehalfOf

`onBehalfOf` is not sufficient evidence of delegation.

When an actor signs on behalf of another participant, the envelope MUST reference an active delegation record or equivalent deployment authorization. That authorization MUST bind:

- principal participant;
- delegate actor;
- allowed workflow or scope;
- allowed roles/actions;
- validity period;
- revocation status.

A deployment MUST reject a delegated event when the delegation is absent, expired, revoked, outside scope or does not authorize the claimed role/action.

The protocol does not define the legal effect of a delegation. It only requires the implementation to prove that its own authorization rules were satisfied.

## Verification order

A conforming accepting implementation MUST, at minimum:

1. validate the event and envelope structure;
2. recompute and compare `eventDigest`;
3. verify `domainId` and `deploymentId`;
4. resolve the signer key and verify the signature;
5. verify key validity and revocation status at `issuedAt`;
6. bind signer identity to `actorRef`;
7. verify delegation when `onBehalfOf` is present;
8. verify event-chain continuity;
9. verify event uniqueness and optimistic concurrency;
10. apply workflow-profile and policy authorization;
11. only then accept the event into the deployment event log.

A valid signature never overrides workflow authorization, policy gates or authoritative-system boundaries.

## Development and test environments

Synthetic development environments MAY use test keys and simplified trust stores, but they MUST preserve the same verification order if they claim envelope conformance.

No implementation processing real personal data, real documents, production credentials or value SHOULD rely on self-declared `actorRef`, `role` or `onBehalfOf` values without the controls specified here.

## Open implementation choices

The following remain deployment or future-specification choices:

- signature suite and key representation;
- key rotation protocol;
- credential or certificate format;
- revocation distribution;
- hardware-key requirements;
- whether participant authentication uses passkeys, enterprise identity, wallet signatures, verifiable credentials or another mechanism.

Changing these implementation choices does not change the core rule: accepted events must be cryptographically bound to the authenticated actor, the deployment domain and the event-history commitment.
