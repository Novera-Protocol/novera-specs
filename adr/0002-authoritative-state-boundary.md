# ADR 0002 — Authoritative state boundary

- **Status:** Accepted for specification v0.1
- **Date:** 2026-10-03
- **Scope:** NovaID, NovaRegistry, NovaDeed, evidence, policy results and adapters

## Context

Ownership, identity, regulatory status and settlement are determined by authoritative systems: land title registries, corporate registries, transfer agents, identity providers, financial institutions, courts and regulated settlement providers. A coordination protocol that appears to replace them would mislead participants, create legal risk and invite reliance that the protocol cannot support.

Novera's value is coordinating state between these systems, not replacing them.

## Decision

Novera records workflow state and evidence references without claiming to replace authoritative legal or regulated systems.

1. Participant, asset and workflow records carry `recordAuthority: "non_authoritative_coordination_record"`. Policy results carry `resultAuthority: "evaluation_result_not_legal_determination"`.
2. Authoritative systems are referenced through `authoritativeRefs` and `externalRefs` with an explicit `verificationStatus`.
3. Where a Novera record conflicts with an authoritative source, the authoritative source prevails. The Novera record MUST be marked for review and MUST NOT be presented as correct.
4. NovaDeed `controlState` mirrors what the authoritative record reports. Only `recorded_externally`, after reconciliation, indicates that control has changed.
5. Claims are confirmed by their issuers, not by Novera. NovaID is not an identity provider.
6. Novera does not perform settlement; Settlement Adapters reference external providers.
7. Weakening this boundary requires a new ADR.

## Consequences

- Records can be relied on for coordination, not as evidence of title, identity or legal status.
- User interfaces built on these records must not present coordination states as legal outcomes. For example, `approved` and `completed` are workflow states, not approvals or legal finality.
- Some states, such as control having changed, can only be reached after an external system reports them. Workflows will wait on external systems; that is intended.
- Implementations need reconciliation processes for external reports, including disputes and outages.

## Alternatives considered

| Alternative | Reason not chosen |
| --- | --- |
| Treat the Novera record as the system of record for ownership | Novera has no legal basis to be authoritative, and the claim would be false. |
| Omit authority markers and rely on documentation | Markers in every record make the boundary visible to every consumer, including automated ones. |
| Model a single `verified` flag | Hides who verified what, for which purpose and until when. |

## Related

[trust-boundaries.md](../architecture/trust-boundaries.md) · [novaregistry.md](../primitives/novaregistry.md) · [novadeed.md](../primitives/novadeed.md)
