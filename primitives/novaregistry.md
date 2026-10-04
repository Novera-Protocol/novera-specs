# NovaRegistry — asset state

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

Schema: [asset.schema.json](../schemas/asset.schema.json) · Example: [asset.example.json](../examples/asset.example.json)

| | Status |
| --- | --- |
| Data model and schema | **Specified** in this repository |
| Validation of synthetic examples | **Implemented** (`npm run validate`) |
| Registry or data-provider integrations | **Planned**; none is integrated |
| Production service | **Not built** |

## Purpose

NovaRegistry represents **structured asset state** for coordination: what an asset is, how it is identified, which external records govern it, which documents describe it, who and what it relates to, and which workflows it is part of.

> NovaRegistry does not replace authoritative registries. A NovaRegistry record is a coordination record. Land title registries, corporate registries, transfer agents, custodians and other authoritative systems remain authoritative.

`status: "registered"` means the asset is recorded for coordination in a Novera deployment. **It does not mean the asset is registered with any authority.**

## Record

| Field | Required | Description |
| --- | --- | --- |
| `assetId` | yes | Opaque identifier (`ast_…`). Not a token identifier, contract address or registry number. |
| `version` | yes | Record version; see [state-model.md](../architecture/state-model.md). |
| `recordAuthority` | yes | Constant `non_authoritative_coordination_record`. |
| `assetClass` | yes | Extensible class; see below. |
| `assetProfile` | no | Namespaced profile describing expected attributes, for example `novera-ref:real_estate.residential`. v0.1 defines no normative profiles. |
| `identifiers` | yes | External identifiers for the asset. |
| `attributes` | yes | Structured attributes. |
| `authoritativeRefs` | yes | References to the external records that govern the asset. MAY be empty while `draft`. |
| `evidenceRefs` | yes | Evidence describing or supporting the record. |
| `relationships` | yes | Typed links to assets, participants, documents, external references and workflows. |
| `networkRefs` | no | Adapter-produced network references; see [network-adapters.md](../architecture/network-adapters.md). |
| `status` | yes | `draft`, `registered`, `under_review`, `suspended` or `retired`. |
| `createdAt`, `updatedAt` | yes | Record timestamps. |
| `metadata` | no | Namespaced, non-normative metadata. |

### Asset classes

The core vocabulary is a starting point, not a closed list:

`real_estate`, `private_market_interest`, `credit_instrument`, `fund_interest`, `commodity`, `equipment`, `trade_asset`

Implementations MAY use namespaced classes (`acme:music_royalty`) without a schema change. Adding a class to the core vocabulary requires an issue and, where it changes semantics, an ADR. Listing a class does not mean Novera supports workflows for it; the only reference workflow at v0.1 is real estate.

### Identifiers

Each identifier has a `scheme`, a `value`, and optionally the `issuer`, `jurisdiction` and an `authoritativeRefKey` linking it to the governing external record. Core schemes: `parcel_number`, `title_number`, `isin`, `cusip`, `lei`, `serial_number`, `vin`, `warehouse_receipt_number`, `internal_reference`, or an extension.

External identifiers are **attributes of the asset**, not Novera identifiers. The `assetId` is stable even if a registry renumbers a parcel or an asset is represented on more than one network.

### Attributes

Attribute keys are lowerCamelCase or namespaced; values are strings, numbers, booleans or arrays of strings.

- Attributes MUST NOT contain personal data. Owner and occupant details are not asset attributes; ownership is expressed through relationships to participants and authoritative references.
- Attributes are descriptive. Where an attribute is also recorded by an authoritative source, the authoritative source prevails.

## Novera record versus authoritative external record

| | NovaRegistry record | Authoritative external record |
| --- | --- | --- |
| Example | `ast_76g1…` with attributes, relationships and workflow links | Title `XZ-TITLE-2009-004417` at a land title office |
| Governs title or holdings | No | Yes, as defined by governing law |
| Updated by | NoveraEvents in a deployment | The registry's own process |
| Linked by | — | `authoritativeRefs[]` with `relationship: "authoritative_source"` |
| On conflict | Yields | Prevails |

Each `authoritativeRefs` entry carries a `verificationStatus`:

| `verificationStatus` | Meaning |
| --- | --- |
| `unverified` | Asserted only. |
| `referenced` | Located through evidence, such as a title search result. |
| `confirmed_by_source` | The external system or its authorized agent confirmed it. |
| `disputed` | Evidence or the source contradicts the record. |
| `unavailable` | The external system could not be reached. |

See [trust-boundaries.md](../architecture/trust-boundaries.md) for the conflict rule.

## Relationships

Relationships connect an asset to the rest of the protocol. Each has a `relationshipType`, a `targetType`, a target, a `status` and optional `evidenceRefs` and `since`.

| `targetType` | Target field | Example `relationshipType` |
| --- | --- | --- |
| `asset` | `targetId` (`ast_…`) | `component_of`, `secured_by` |
| `participant` | `targetId` (`ptc_…`) | `recorded_owner_reference`, `proposed_transferee`, `lienholder_reference`, `custodian_reference`, `manager`, `servicer` |
| `document` | `targetId` (`evd_…`) | `described_by_document` |
| `external_ref` | `targetRefKey` (an `authoritativeRefs` key) | `registered_at` |
| `workflow` | `targetId` (`wfl_…`) | `subject_of_workflow` |

Rules (schema- or validator-enforced):

- `external_ref` relationships use `targetRefKey`, which MUST match an `authoritativeRefs` entry; all others use `targetId` with the matching identifier type.
- `confirmed_by_source` relationships MUST cite evidence.
- An asset MUST NOT relate to itself.

Relationship status is `asserted`, `referenced`, `confirmed_by_source` or `ended`. A `recorded_owner_reference` mirrors what an authoritative source reports. It does not make the participant the owner, and Novera does not determine ownership.

## Relationships with the other primitives

- **NovaID**: participants appear as relationship targets. Their claims and eligibility live in NovaID, not on the asset.
- **NovaDeed**: a workflow names the asset by `assetId`; the asset links back with `subject_of_workflow`. Proposed ownership changes are workflow state, not asset state, until the authoritative source records them.

## Example

[asset.example.json](../examples/asset.example.json) is a synthetic detached residential property in fictional jurisdiction `XZ`, version 3, `registered`:

- identifiers: a parcel number linked to the land-title reference, and a listing operator's internal reference;
- one authoritative reference to a fictional land title office, `verificationStatus: "referenced"` through a title search result;
- relationships: recorded owner reference (the seller, per the title search), proposed transferee (Buyer A, asserted), the land-title record, a describing document and the purchase workflow;
- attributes: property type, lot and floor area, year built, bedrooms, tenure and a namespaced zoning category.

## Out of scope for v0.1

- Normative attribute profiles per asset class.
- Registry integrations or data-provider feeds.
- Tokenization. A future token representing an asset would be an adapter-produced `networkRefs` entry with `referenceType: "token"`, never the asset's identity.
