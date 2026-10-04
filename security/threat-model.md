# Threat model

> **INITIAL THREAT MODEL — NOT A SECURITY AUDIT**
>
> This document is a design aid for specification v0.1. It has not been reviewed by an independent security assessor, and **no part of Novera has been security audited**. There is no running system, so no control described here has been tested in operation.

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

## Scope

This model covers the protocol design in this repository: the record schemas, the event and state models, the trust boundaries, and the adapter and assistive-system boundaries. It identifies threats that an implementation of this specification would face, and records which mitigations the specification already provides and which remain to be designed.

Not covered: hosting and infrastructure, production key management, smart contracts (none exist), application code (none exists), denial of service, physical security, and legal or regulatory risk assessment.

### What is being protected

| Asset | Why it matters |
| --- | --- |
| Integrity of current state | Parties coordinate on participant, asset and workflow state. |
| Integrity and order of the event history | The history is the audit trail of who changed what, and why. |
| Authority boundaries | Novera records must never be mistaken for authoritative records (ADR 0002), and assistive output must never change state (ADR 0003). |
| Confidentiality of personal data and documents | Workflows involve identity, financial and legal documents. |
| Correctness of external facts relied on | Issuer claims, registry references, settlement and network reports. |

### Actors and trust levels

From [trust-boundaries.md](../architecture/trust-boundaries.md): authorized participants are trusted for their own actions within their roles; deterministic Novera system components for evaluation and for applying confirmed transitions; external providers for facts within their authority; adapters for faithfully reporting what they observed; assistive systems for nothing — their output is a proposal only. Any of these may be compromised or mistaken.

### Mitigation labels

Each mitigation is labelled with where it lives. The labels are deliberately conservative.

| Label | Meaning |
| --- | --- |
| **[Schema]** | Enforced by the JSON Schemas. Any validator applying them rejects non-conforming records. Schemas check structure, not truth or authenticity. |
| **[Validator]** | Checked by `npm run validate` against the repository's synthetic examples, and covered by a negative test. This is a specification-consistency check, not a runtime control. |
| **[Normative]** | A MUST or SHOULD requirement on implementations. No implementation exists, so these requirements are untested. |
| **[Open]** | Not addressed in v0.1. |

## Summary

| ID | Threat | Primary boundary | Strongest v0.1 control |
| --- | --- | --- | --- |
| T-01 | Unauthorized state transitions | Event model | Schema |
| T-02 | Forged evidence references | Evidence model | Normative (partly open) |
| T-03 | Tampered documents | Evidence model | Schema + Normative |
| T-04 | Compromised issuers/providers | Trust boundary | Validator + Normative |
| T-05 | Replay attacks | State model | Normative |
| T-06 | Duplicate events | Event model | Normative + Validator |
| T-07 | Privilege escalation | Event model | Schema |
| T-08 | Improper workflow authorization | NovaDeed | Normative (partly open) |
| T-09 | PII leakage | All records | Schema + Normative |
| T-10 | Sensitive document exposure | Evidence model | Schema + Normative |
| T-11 | Malicious AI extraction | Intelligence boundary | Schema |
| T-12 | Prompt injection through documents | Intelligence boundary | Schema (containment only) |
| T-13 | Incorrect AI interpretation | Intelligence boundary | Schema + Normative |
| T-14 | Adapter compromise | Adapter boundary | Schema + Normative |
| T-15 | Network reorganization/finality assumptions | Network Adapter | Schema + Normative |
| T-16 | External provider outages | Adapter boundary | Normative |
| T-17 | Schema/version confusion | All records | Schema + Validator |

## Threats

### T-01 Unauthorized state transitions

**Description.** An actor causes a record's current state to change without a valid proposal, the required validation and an authorized confirmation — for example by writing directly to storage, or by recording a `state_transition` that no confirmed proposal supports.

**Impact.** Records misrepresent workflow progress, and parties act on false state, for example treating a purchase workflow as `approved` when its conditions are unmet.

**Initial mitigation.**
- [Schema] Only `system` actors may emit `state_transition`. A transition MUST carry `previousStateRef`, `confirmedStateRef` and at least one `causedBy` event. Only `state_transition` events may carry `confirmedStateRef`.
- [Validator] A transition whose confirmed state differs from the proposal is rejected; NovaDeed transitions are checked against the reference state machine, the transition chain must be contiguous, and `workflowState` must match the last transition.
- [Normative] The five conditions in [event-model.md](../architecture/event-model.md#authorization-of-confirmations) MUST hold before a transition is recorded. Optimistic concurrency ([state-model.md](../architecture/state-model.md#optimistic-concurrency)) rejects transitions based on a stale version.

**Residual risk / future work.** The schema constrains the shape of an event, not its authenticity. A compromised system component, or anyone with write access to the store, can produce a well-formed transition. Events are not signed in v0.1 and no store integrity mechanism is specified. Future work: a signature envelope for events, per-subject hash chaining, independent re-verification of transitions from their cited events, and a conformance suite for workflow engines.

### T-02 Forged evidence references

**Description.** An event, claim or policy result cites an evidence identifier that does not exist, that refers to a different document than the one described, or that belongs to another subject or workflow.

**Impact.** A policy passes, or a claim is confirmed, on evidence that does not exist or does not apply.

**Initial mitigation.**
- [Schema] Evidence identifiers are typed (`evd_…`). Evidence records carry `contentHash`, `subjectRefs`, `status` and, when accepted or rejected, a `review` with a stated purpose.
- [Normative] Implementations MUST NOT infer authority from an identifier or a reference alone ([trust-boundaries.md](../architecture/trust-boundaries.md#trust-assumptions)).
- [Validator] Related reference checks exist for issuers (a claim's issuer must be listed) and external references (an asset relationship must name a declared external reference).

**Residual risk / future work.** The validator does **not** resolve every `evidenceRefs` entry to an evidence record, and does not check that the evidence's `subjectRefs` include the citing subject. This is an open conformance gap. Future work: referential-integrity rules in the conformance profile, and a requirement that relied-on evidence be `accepted` for the purpose stated by the policy condition.

### T-03 Tampered documents

**Description.** The document behind an evidence record is altered after recording, or a different document is presented in its place.

**Impact.** Decisions are made on altered content.

**Initial mitigation.**
- [Schema] `contentHash` is a digest of the exact bytes of the content. The schema states that consumers MUST verify retrieved content against it before relying on it.
- [Normative] Implementations SHOULD prefer `hash_only` storage, in which the document stays with its source ([evidence-model.md](../architecture/evidence-model.md#storage-modes)).

**Residual risk / future work.** A matching hash shows the bytes are unchanged since the record was created. It does not show that the document was genuine when it was recorded, or that the component computing the hash was honest. Future work: issuer-signed documents or credentials, recording which actor computed each hash, and optional anchoring of evidence digests through a Network Adapter.

### T-04 Compromised issuers/providers

**Description.** An identity provider, financial institution, professional or registry issues false claims or reports, through compromise, error or fraud.

**Impact.** Claims are confirmed, eligibility is granted, or an external state is mirrored incorrectly.

**Initial mitigation.**
- [Schema] Every claim names an issuer, records provenance (`provider_check`, `document_review`, `registry_query`, `self_assertion`, `professional_attestation`), has a scope and validity window, and can be `revoked` or `expired`.
- [Validator] Rejected: a claim whose issuer is not listed; a self-issued claim `confirmed` by self-assertion alone; an eligibility state based on an unconfirmed claim.
- [Normative] External providers are trusted only for facts within their authority. Where a Novera record conflicts with an authoritative source, the source prevails and the record MUST be marked for review ([ADR 0002](../adr/0002-authoritative-state-boundary.md)).

**Residual risk / future work.** Novera cannot detect a false statement from a legitimate issuer. Issuer authentication, issuer trust lists and revocation checking are not specified. Future work: per-profile issuer trust lists, signed claims (the mapping to W3C Verifiable Credentials is an open question), revocation status checks, and corroboration from a second source for high-impact claims.

### T-05 Replay attacks

**Description.** A previously valid proposal, confirmation or transition is resubmitted to be applied again, or presented against a different version, subject or workflow.

**Impact.** Repeated or stale transitions, or a confirmation given for one proposal being used for another.

**Initial mitigation.**
- [Schema] Proposals, confirmations and transitions carry state references that include a version and a digest of the exact state.
- [Validator] State references MUST refer to the event's own subject, and versions MUST follow the previous version.
- [Normative] A `previousStateRef` that is not the subject's current version MUST be rejected, so an old transition replayed against a newer record fails. A transition's `confirmedStateRef` MUST equal the proposal's `proposedStateRef`.

**Residual risk / future work.** The core event JSON remains unsigned, but the protocol contract for deployment/domain separation, signed envelopes and per-subject event-chain commitments is now specified in [event-authentication.md](../architecture/event-authentication.md) and [event-integrity.md](../architecture/event-integrity.md). Those controls are **not implemented** in this repository. Until a runtime implements them, replay detection still depends on the event store. A policy result can be relied on repeatedly within its `validUntil` window for the same input state; that is intended but should be bounded. Confirmation expiry remains future work.

### T-06 Duplicate events

**Description.** The same event is recorded twice because of retries, network faults or concurrent producers, or two different events share an identifier.

**Impact.** Double application of a change, divergent histories, and a broken audit trail.

**Initial mitigation.**
- [Normative] Event identifiers MUST be unique within a deployment, and an event whose identifier is already recorded with different content MUST be rejected. A repeated `idempotencyKey` from the same actor MUST NOT be applied twice. A second transition from the same `previousStateRef` fails the concurrency check.
- [Validator] Duplicate `eventId` values across the examples are rejected.

**Residual risk / future work.** The scope and retention of idempotency keys are not specified. Distributed implementations need a transactional or consensus-backed store to make these guarantees. Future work: specify idempotency-key scope, retention and conflict behaviour in a conformance profile.

### T-07 Privilege escalation

**Description.** An actor acts with more authority than it holds: a participant acting as a system component, an assistive system confirming or validating, an adapter proposing state, or a representative exceeding its `onBehalfOf` authority.

**Impact.** Unauthorized confirmations or transitions.

**Initial mitigation.**
- [Schema] `actorType` is bound to the identifier prefix (`ptc_`, `sys_`, `iss_`, `adp_`). The authority matrix in [event.schema.json](../schemas/event.schema.json) restricts which actor types may emit each event type: only `system` may emit `state_transition`, assistive systems may emit only `proposal`, adapters may emit only `external_observation`.
- [Validator] Rejected: a participant emitting a state transition; an assistive system confirming state.
- [Normative] Implementations MUST authenticate the actor behind every event. An `actorRef` is a claim about who acted, not proof.

**Residual risk / future work.** `actorType`, `role` and `onBehalfOf` remain self-declared in the bare event record, but [event-authentication.md](../architecture/event-authentication.md) now specifies the required signer-key binding, delegation checks and deployment-domain separation for conforming real-data/value deployments. These controls are not implemented here. Future work remains: select signature suites, key rotation/revocation mechanisms and deployment-specific authentication methods, then test separation of duties for system components.

### T-08 Improper workflow authorization

**Description.** A transition is confirmed by the wrong party, a required confirmation is missing, or a policy gate is bypassed — for example a buyer confirming its own proposal where the seller's confirmation is required.

**Impact.** A workflow reaches `approved` or `ready_for_settlement` without the required consent or conditions.

**Initial mitigation.**
- [Schema] NovaDeed workflows declare gating policies in `policyRefs[].requiredFor`. Policy results carry `inputStateRefs` and `validUntil`, so a result applies only to the versions it read and only until it lapses.
- [Validator] Transitions must be permitted by the reference state machine.
- [Normative] Every policy required for the target state MUST have a current, applicable result, cited by a validation in `causedBy`. Every required confirmation MUST be made by an actor holding the required role. A participant MUST NOT confirm its own proposal when the workflow requires a counterparty or independent confirmation ([event-model.md](../architecture/event-model.md#authorization-of-confirmations)).

**Residual risk / future work.** Who must confirm which transition is not machine-readable in v0.1; it is left to the workflow profile and the deployment. The validator does **not** resolve `requiredFor` policy gates against policy results, so the synthetic example's policy gating is described, not verified. Future work: machine-readable confirmation rules per profile transition, validator enforcement of policy gates, and conformance tests for authorization.

### T-09 PII leakage

**Description.** Personal data appears in Novera records, events, metadata, network anchors or logs, or becomes linkable through identifiers and digests.

**Impact.** Privacy harm, data-protection exposure, and personal data published to immutable networks where it cannot be erased.

**Initial mitigation.**
- [Schema] A participant `label` MUST NOT contain a natural person's name or other direct identifier. A claim `statement` is non-identifying, and `valueDigest` can commit to a value without revealing it. Issuer descriptions and `metadata` MUST NOT carry personal data. An evidence `uri` MUST NOT embed personal data.
- [Validator] Evidence content marked as containing personal data cannot be classified `public`. Every example is labelled synthetic.
- [Normative] Adapters MUST NOT publish personal data or document contents to a network, and SHOULD salt or commit to digests of low-entropy personal data ([network-adapters.md](../architecture/network-adapters.md#requirements-for-implementations)).

**Residual risk / future work.** Schemas cannot detect personal data in free text. Opaque identifiers and digests can be correlated across workflows. The tension between immutable events and erasure obligations is unresolved. Future work: a data-protection impact assessment before any real data is processed, retention rules, a redaction or key-destruction design for erasure, and identifier rotation. During MVP development, real identity documents MUST NOT be stored.

### T-10 Sensitive document exposure

**Description.** Financing letters, identity documents, contracts or reports are exposed through URIs, deployment stores, logs, assistive pipelines or publication.

**Impact.** Breach of confidentiality, and material that enables fraud.

**Initial mitigation.**
- [Schema] Three storage modes; `hash_only` evidence MUST NOT carry a `uri`. A `uri` MUST NOT embed credentials or access tokens, and possessing it MUST NOT be sufficient to access confidential content. Content is classified (`public`, `internal`, `confidential`, `restricted`) with an explicit `containsPersonalData` flag.
- [Validator] Hash-only evidence carrying a URI is rejected.
- [Normative] Implementations SHOULD prefer `hash_only` for personal or commercially sensitive documents ([evidence-model.md](../architecture/evidence-model.md#storage-modes)).

**Residual risk / future work.** Access control of external and deployment stores is outside this specification. Classification is declared by the producer and may be wrong. A future assistive pipeline would need access to document content, which widens exposure. Future work: an access-control model, encryption and audit-logging requirements for `deployment_store`, retention enforcement, and provider due diligence before any external processing of documents.

### T-11 Malicious AI extraction

**Description.** A compromised, poisoned or deliberately malicious assistive system produces false extractions — altered amounts, parties or dates — or floods reviewers with proposals.

**Impact.** Incorrect proposals and reviewer fatigue; an incorrect state if a reviewer confirms a bad proposal.

**Initial mitigation.**
- [Schema] Assistive systems may emit only `proposal` events, MUST report `confidence`, MUST use `provenance.channel: "assistive_extraction"`, and MUST disclose `provenance.extraction` with `method`, `modelIdentifier` and `inputEvidenceRefs`. They cannot evaluate policies, review evidence or determine eligibility.
- [Validator] Each of these restrictions has a negative test.
- Decision record: [ADR 0003](../adr/0003-ai-non-authoritative.md); boundary: [intelligence-boundary.md](../architecture/intelligence-boundary.md).

**Residual risk / future work.** A confirmed bad proposal becomes state. Proposal flooding is not addressed, and model provenance is self-reported. Novera Intelligence is a FUTURE CAPABILITY and is not built. Future work: rate limits, independent re-extraction of high-impact fields, reviewer interfaces that show the source location of each value, and a registry of approved models and versions.

### T-12 Prompt injection through documents

**Description.** A document contains text crafted to steer a language-model extractor, for example an instruction to report that financing has been approved.

**Impact.** Manipulated extraction output; possible data exfiltration if the extraction system has tool or data access.

**Initial mitigation.**
- [Schema] Containment: whatever the extractor outputs can only be a proposal, which cannot change state, evaluate policy or review evidence.
- [Normative] Implementations SHOULD show reviewers the source location of every proposed value and SHOULD NOT pre-fill confirmations ([intelligence-boundary.md](../architecture/intelligence-boundary.md#risks)).

**Residual risk / future work.** Injection can still produce convincing, wrong proposals. Exfiltration risk depends on the future architecture and is not addressed by the schemas. Future work: treat all document content as untrusted data; run extraction without tool, network or cross-workflow data access; constrain output to the proposal schema; maintain an injection test corpus.

### T-13 Incorrect AI interpretation

**Description.** Non-malicious extraction errors: misread numbers or dates, hallucinated fields, misattributed parties, wrong jurisdiction.

**Impact.** Wrong proposals, wasted review effort, and wrong state if confirmed without checking.

**Initial mitigation.**
- [Schema] Per-field provenance (`fieldProvenance`) links each proposed value to its source evidence and location, with its own confidence.
- [Normative] `confidence` is informational and MUST NOT lower validation or confirmation requirements. Deterministic policy validation and human or provider confirmation are required before any transition.

**Residual risk / future work.** Automation bias: reviewers may confirm without checking. No accuracy figures exist and none are claimed. Future work: evaluation datasets, calibrated confidence, mandatory dual review for specified fields, and monitoring of confirmation overrides.

### T-14 Adapter compromise

**Description.** A Network or Settlement Adapter, or its credentials, is compromised. It reports false observations — a `reconciled` settlement, an `adapter_final` anchor — or submits unauthorized instructions to a provider or network.

**Impact.** A workflow moves to `completed` on a false settlement report; in a future value-bearing deployment, assets or funds could be misdirected.

**Initial mitigation.**
- [Schema] Adapters may emit only `external_observation` events and cannot propose, confirm or apply state. Network references carry the `adapterId` that produced them. A workflow in `completed` MUST have `settlementRef.status: "reconciled"`.
- [Validator] A `completed` workflow without a settlement reference is rejected.
- [Normative] Adapter keys MUST be held in dedicated secret management and MUST NOT appear in records. Adapters MUST fail closed, MUST NOT report `reconciled` on ambiguous provider reports, and MUST be replaceable without invalidating core records ([settlement-adapter.md](../architecture/settlement-adapter.md)).

**Residual risk / future work.** An observation can lead to a proposal that is confirmed on its basis, so a false report can still be relied on. No adapter exists; there is no attestation of adapter code and no second-source verification. Future work: an adapter conformance profile, independent observation by a second source, signed provider reports, hardware-backed key custody, and an independent security review before any adapter handles value.

### T-15 Network reorganization/finality assumptions

**Description.** A network reference reported as `observed` or `adapter_final` leaves canonical history, or an adapter's finality policy is weaker than consumers assume. Networks differ in how and when transactions become irreversible.

**Impact.** A workflow proceeds on an anchor or settlement that no longer exists, leaving Novera state inconsistent with the network.

**Initial mitigation.**
- [Schema] Explicit finality vocabulary (`not_observed`, `observed`, `adapter_final`, `reorganized`, `failed`) on every network reference; CAIP-2 network identifiers.
- [Normative] Adapters MUST document a finality policy per network and MUST report `reorganized` as an `external_observation`. Workflow steps that depend on a network outcome SHOULD require `adapter_final`. `adapter_final` is not legal or settlement finality ([network-adapters.md](../architecture/network-adapters.md#finality)). The core does not depend on any network ([ADR 0001](../adr/0001-chain-agnostic-core.md)).

**Residual risk / future work.** Compensating actions after a reorganization — especially after a workflow has advanced — are not specified. Requiring `adapter_final` is a SHOULD, not a MUST. No network has been selected, so no concrete finality policy exists. Future work: per-network finality profiles once a network is selected (which requires an ADR), reorganization handling procedures, and a MUST-level requirement for value-bearing steps.

### T-16 External provider outages

**Description.** Identity providers, registries, settlement providers, networks or adapters are unavailable, degraded or return stale data.

**Impact.** Workflows stall; operators face pressure to bypass checks; stale results are relied on.

**Initial mitigation.**
- [Normative] Adapters MUST fail closed: an unreachable provider is reported as `observed` with reason codes or `failed`, never `reconciled`; an unavailable network is reported as `not_observed`. Policy results lapse at `validUntil` and MUST be re-evaluated before reliance. Waiting on external systems is intended behaviour ([ADR 0002](../adr/0002-authoritative-state-boundary.md)).

**Residual risk / future work.** Timeouts, escalation and manual fallback are not specified, and manual workarounds outside the protocol would not be recorded. Future work: specify timeouts and retries, and a manual-override path that is itself a proposal requiring elevated confirmation and a full audit trail.

### T-17 Schema/version confusion

**Description.** Producers and consumers disagree about the specification version, schema contents or extension meanings; schemas are loaded from an untrusted location; or implementations canonicalize state differently and compute different digests.

**Impact.** Records accepted with different semantics, authority rules bypassed through unknown values, or valid transitions rejected because digests differ.

**Initial mitigation.**
- [Schema] `specVersion` is fixed at `"0.1"`, and consumers MUST reject versions they do not support. Vocabularies that authority depends on (`actorType`, `eventType`, `subjectType`, `recordAuthority`, `resultAuthority`) are closed; extensions elsewhere are namespaced. Object schemas declare `additionalProperties` explicitly. Each schema has a stable `$id`.
- [Validator] Rejected: an unsupported `specVersion`; a remote `$ref`; a duplicate `$id`; an `$id` that does not match its file name.
- [Normative] Schemas MUST be loaded from this repository and MUST NOT be fetched over the network; `schemas.noveraprotocol.org` is an identifier namespace and no schema service is hosted there. State digests use SHA-256 over RFC 8785 (JCS) canonicalization ([state-model.md](../architecture/state-model.md#state-digest)).

**Residual risk / future work.** There is no versioning or migration policy beyond v0.1. Exact number serialization under JCS across languages is an open question. Extension namespaces have no registry. Future work: a compatibility and migration policy, tagged schema releases with published digests, an extension-namespace registry, and cross-language canonicalization test vectors.

## Repository and supply chain

These controls apply to this repository only:

- CI ([validate.yml](../.github/workflows/validate.yml)) pins third-party actions to commit SHAs and runs with read-only repository permissions.
- Dependencies are limited to Ajv and `ajv-formats`, installed from the committed lockfile with `npm ci`.
- No secrets, keys, credentials or real personal data are stored in this repository. Examples are synthetic.

## When this model must be revisited

This model MUST be revised, and an independent security review SHOULD be commissioned, before any of the following:

1. an implementation processes real participant data or real documents;
2. a production network is selected or a Network Adapter is built;
3. a Settlement Adapter is connected to any provider;
4. a Novera Intelligence prototype is built;
5. any deployment beyond development.

Security reporting status is described in [SECURITY.md](../SECURITY.md).
