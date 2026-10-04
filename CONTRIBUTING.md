# Contributing to the Novera Protocol Specification

This repository is a pre-production design specification. Contributions should make the specification more precise, more consistent or easier to implement correctly. Please read [README.md](README.md) and [architecture/trust-boundaries.md](architecture/trust-boundaries.md) before you propose a change.

## Before you start

| Change | What to do first |
| --- | --- |
| Typo, broken link, clarifying wording that does not change meaning | Open a pull request directly. |
| New or changed field, vocabulary value, validation rule or example | Open an issue that describes the problem and the proposed change. |
| Change to a primitive's responsibilities, the event authority rules, the state model, a trust boundary or the network posture | Open an issue first, then write an ADR in `adr/` once there is rough agreement. |
| Suspected security vulnerability | Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md). |

Large changes submitted without a prior issue may be closed and redirected to an issue so the design can be discussed before review time is spent on the details.

## Architecture decision records

An ADR is required for any significant design decision, including:

- adding, removing or splitting a primitive or a shared model;
- changing which actor types may produce which event types;
- changing how state digests, identifiers or versions are defined;
- introducing a dependency on a specific network, provider, oracle or vendor;
- changing what Novera records versus what it references from an external authority.

ADRs live in `adr/` and are numbered sequentially (`0005-short-title.md`). Each ADR states its status (`Proposed`, `Accepted`, `Superseded by NNNN`), context, decision, consequences and alternatives considered. Accepted ADRs are not edited to change their decision; a new ADR supersedes them.

## Schema changes

A pull request that changes a schema MUST:

1. keep the schema on JSON Schema Draft 2020-12, with a stable `$id` in the `https://schemas.noveraprotocol.org/v0.1/` namespace that matches the file name;
2. give every new property a `description`, and declare `additionalProperties` (or `unevaluatedProperties`) explicitly on every new object;
3. update or add synthetic examples in `examples/` so that every new required field and every new rule is exercised;
4. add or update tests in `tests/`, including at least one negative test showing that the new constraint rejects invalid input;
5. update the matching prose in `architecture/` or `primitives/`, so that the specification and the schema say the same thing;
6. pass `npm run validate` and `npm test` locally and in CI.

Prefer extensible vocabularies over closed enumerations. Core values are lowercase `snake_case`. Implementation-specific values use a namespaced extension token (`<namespace>:<value>`). Closed vocabularies are reserved for values that authority rules depend on, such as `eventType` and `actorType`; changing them requires an ADR.

While the specification is at v0.1, breaking changes are allowed but MUST be called out in the pull request description.

## Examples

All examples MUST be synthetic. They MUST carry `"novera:synthetic": true` and `"novera:label": "SYNTHETIC EXAMPLE DATA"` in `metadata`, and MUST NOT use real people, companies, addresses, registry numbers or transactions. Use the fictional jurisdiction code `XZ` and `*.example` domains (RFC 2606). Do not put personal data in any example, even fictional-looking personal data, beyond what a field's purpose strictly requires.

## Boundaries that changes must preserve

Pull requests MUST NOT:

- introduce a production network, chain, oracle or provider dependency into the core models without an accepted ADR;
- describe Base, Hedera, Chainlink CRE, CCIP, Proof of Reserve or any other network or service as selected, live or required;
- weaken the boundary with authoritative external systems, for example by presenting a Novera record as legal title, a registry entry, an identity verification or a regulatory determination;
- allow an assistive system to validate, confirm, reject or apply a state transition, evaluate policy, review evidence or determine eligibility;
- add tokens, token economics, governance tokens, contracts, deployment addresses, API endpoints or SDK packages that do not exist;
- claim audits, certifications, approvals, partnerships, customers, benchmarks or production usage.

## Language

Write precisely and avoid marketing language. Use the requirement keywords MUST, MUST NOT, SHOULD, SHOULD NOT and MAY as defined in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) only when you intend a normative requirement. Distinguish clearly between what is **implemented** in this repository, what is **specified**, what is **planned** and what is **future**.

## Local checks

```bash
npm ci
npm run validate
npm test
```

## Licensing

By submitting a contribution you agree that it is licensed under the [Apache License, Version 2.0](LICENSE), as described in section 5 of that license.
