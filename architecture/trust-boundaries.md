# Trust boundaries

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

Related decision: [ADR 0002 — Authoritative state boundary](../adr/0002-authoritative-state-boundary.md)

## Governing principle

> Novera coordinates state and workflow. It does not replace authoritative external systems.

Novera maintains structured workflow state and references evidence and authoritative external sources where they are required. Every implementation of this specification MUST preserve that boundary.

## What Novera does not replace

| External system | Remains authoritative for | Novera's role |
| --- | --- | --- |
| Government and land title registries, title systems | Legal title, registered interests, encumbrances | References the registry record; mirrors what it last reported |
| Identity providers | Identity verification outcomes | Records claims with the provider as issuer, scoped to a context |
| Banks, payment rails | Funds, balances, payment finality | Interacts only through a Settlement Adapter |
| Custodians, transfer agents, fund administrators | Holdings and registers of securities and fund interests | References their records; reconciles their reports |
| Broker-dealers and other regulated intermediaries | Regulated activity they perform | Records their participation as participants or providers |
| Legal professionals | Legal advice, document drafting, legal opinions | Records their actions as participant events and their documents as evidence |
| Regulators | Licensing, approvals, enforcement | Out of scope; Novera makes no regulatory determination |
| Authoritative data providers | The data they publish | References and hashes that data as evidence |

Novera v0.1 does not provide legal advice, does not perform regulated settlement and does not independently transfer title or ownership of any asset.

## The boundary in the data model

The boundary is encoded in the schemas, so that it survives serialization and cannot be dropped by an individual implementation.

| Mechanism | Where | Effect |
| --- | --- | --- |
| `recordAuthority: "non_authoritative_coordination_record"` (constant) | Participant, asset and workflow records | Every primitive record declares itself non-authoritative. |
| `resultAuthority: "evaluation_result_not_legal_determination"` (constant) | Policy results | A policy result cannot be presented as a legal determination. |
| `authoritativeRefs[]` with `relationship: "authoritative_source"` | Asset records | Names the external record that governs. When present, the external record prevails. |
| `verificationStatus` on external references | Asset records | Distinguishes `unverified`, `referenced`, `confirmed_by_source`, `disputed` and `unavailable`. |
| `controlState.recordedControllerRefs` with `basis` | Workflow records | Mirrors who the authoritative source records as owner or controller; it is not a Novera determination. |
| `controlState.status` values `pending_external_registration` and `recorded_externally` | Workflow records | Ownership change is complete only when the authoritative system reports it and the report is reconciled. |
| Scoped claims and eligibility | Participant records | No participant statement is global; see [primitives/novaid.md](../primitives/novaid.md). |
| Claim `issuerId` and `provenance` | Participant records | Every claim names who made it and how. |
| Evidence `review.purpose` | Evidence records | Acceptance is for a stated purpose only. |

## Novera record versus authoritative record

| | Novera record | Authoritative external record |
| --- | --- | --- |
| Held by | A Novera deployment | The registry, provider or institution |
| Legal effect | None of its own | As defined by the governing law and the system's rules |
| Changes when | A `state_transition` NoveraEvent is recorded | The external system's own process completes |
| Identifier | Opaque Novera identifier | The external system's identifier, carried in `authoritativeRefs` or `identifiers` |
| Purpose | Coordinate a workflow across participants and systems | Record rights, holdings, identities or funds |

## Conflict rule

When a Novera record and an authoritative external record disagree, the authoritative record prevails. An implementation:

- MUST NOT treat its own record as overriding the external record;
- MUST NOT present a NovaDeed `completed` workflow or a `change_agreed` control state as a completed legal transfer unless the authoritative source has reported the change and the report has been reconciled (`controlState.status: "recorded_externally"`);
- SHOULD record the disagreement, for example by setting the external reference's `verificationStatus` to `disputed` and recording an `external_observation` event;
- SHOULD move the affected workflow to a state that stops progress until the disagreement is resolved.

## Trust assumptions

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| Authorized participant | Its own actions in roles it holds | Anything outside its role or scope |
| Novera system component | Deterministic evaluation and applying confirmed transitions | Legal judgement; creating confirmations |
| External provider | Facts within its authority, as reported | Facts outside its authority |
| Adapter | Faithfully reporting what it observed on its network or provider | The correctness of the observed facts |
| Assistive system | Nothing; output is a proposal only | Validation, confirmation, evaluation, review, eligibility, settlement |

Implementations MUST authenticate actors, MUST authorize each event against the actor's role and the workflow's rules, and MUST NOT infer authority from an identifier or a reference alone. See [security/threat-model.md](../security/threat-model.md).

## Implementation obligations

An implementation conforming to this specification:

1. MUST preserve `recordAuthority` and `resultAuthority` when storing, exporting or displaying records;
2. MUST display Novera state to users in a way that does not imply legal title, registration, identity verification by Novera or regulatory approval;
3. MUST keep external references to authoritative records when they are present, and MUST NOT silently drop them;
4. MUST route settlement through a Settlement Adapter and network interaction through a Network Adapter, never through the core;
5. MUST keep assistive output outside the authoritative path described in [intelligence-boundary.md](intelligence-boundary.md).
