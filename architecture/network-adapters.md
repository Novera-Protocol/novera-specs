# Network adapters

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

**Status: conceptual boundary only. No Network Adapter is implemented in this repository. No production network has been selected.**

Related decision: [ADR 0001 — Chain-agnostic core](../adr/0001-chain-agnostic-core.md)

## Principle

> The Novera core MUST NOT depend on a specific chain or network.

Participant, asset, workflow, evidence, policy and event semantics are defined without reference to any network. A Network Adapter is the only component that knows about a network, its identifiers, its transaction formats and its finality rules.

Novera is **EVM-first**: Ethereum Virtual Machine–compatible networks are the first adapter family expected to be specified, because their tooling and account model are widely understood. EVM-first is an implementation priority. It is not a dependency of the core models, and nothing in the schemas requires an EVM network.

## Network posture at v0.1

| Network or service | Status |
| --- | --- |
| Any production network | **None selected.** No production Novera network is live. |
| Base | Leading candidate under evaluation. Not selected. |
| Hedera | Optional future adapter. |
| Chainlink CRE, CCIP, Proof of Reserve | Conditional future integrations. Not a dependency. |

This repository contains no adapter for, and no core architecture specific to, any of them.

## Capabilities

A Network Adapter MAY provide some or all of the following capabilities. An adapter MUST document which it provides.

| Capability | Semantics | Produces |
| --- | --- | --- |
| Persist references | Record a reference to a Novera record (for example its identifier and a state digest) on a network. | `networkRefs` with `referenceType: "anchor"` or `"message"` |
| Anchor hashes | Publish a digest, or a commitment to many digests, so that its existence at a point in network history can be shown later. | `networkRefs` with `referenceType: "anchor"` |
| Submit transactions | Submit a network transaction on behalf of a confirmed workflow step, for example on behalf of a Settlement Adapter. | `networkRefs` with `referenceType: "transaction"` |
| Observe confirmations | Watch submitted transactions and anchors and report their status under the adapter's finality policy. | `external_observation` events with updated `finality` |
| Read network state | Read balances, contract state or messages relevant to a workflow and report them as observations. | `external_observation` events; evidence of type `network_observation` |

Adapters never write Novera state directly. Everything an adapter learns enters the core as an `external_observation` event with `actorType: "adapter"`, and any resulting state change follows the normal proposal, validation, confirmation and state-transition path in [event-model.md](event-model.md).

## Network references

Network-specific values appear only in `networkRefs` ([common.schema.json](../schemas/common.schema.json)), which only adapters produce and interpret:

| Field | Meaning |
| --- | --- |
| `adapterId` | The adapter instance (`adp_…`) that produced the reference. |
| `network` | [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) chain identifier, `namespace:reference`. |
| `referenceType` | `anchor`, `transaction`, `account`, `contract`, `token`, `message`, or an extension. |
| `value` | Network-native value, such as a transaction hash. Opaque to the core. |
| `finality` | Adapter-reported finality; see below. |
| `observedAt` | When the adapter last observed the reference. |

Rules:

- A network reference MUST NOT be used as a Novera identifier. An account is not a participant, a token is not an asset and a transaction is not a workflow.
- One Novera record MAY have network references on several networks, produced by different adapters.
- The core MUST treat `value` as opaque and MUST NOT branch on `network`.

## Finality

Networks differ in how and when a transaction becomes irreversible. The core does not assume any of them.

| `finality` | Meaning |
| --- | --- |
| `not_observed` | Submitted or expected, not yet seen. |
| `observed` | Seen on the network, not final under the adapter's policy. |
| `adapter_final` | Final under the adapter's **documented** finality policy for that network. |
| `reorganized` | No longer part of the canonical history. |
| `failed` | Rejected or reverted. |

Requirements:

1. An adapter MUST document its finality policy per network, for example a confirmation depth, a finalized-checkpoint rule or the network's own finality guarantee.
2. An adapter MUST report `reorganized` if a reference it reported as `observed` or `adapter_final` leaves canonical history, and MUST record that as an `external_observation` event.
3. A workflow step that depends on a network outcome SHOULD require `adapter_final`, not `observed`.
4. `adapter_final` is the adapter's assessment under its policy. It is not legal finality, settlement finality or a statement that the anchored state is correct.

An anchor proves only that a digest was published at a point in a network's history. It does not prove that the anchored state is accurate, authorized or legally effective.

## How future integrations could fit

These are illustrations of how the boundary accommodates candidates later. They are not plans, commitments or designs.

| Candidate | How it would fit |
| --- | --- |
| An EVM network such as Base | An EVM Network Adapter persisting anchors and submitting transactions, with `network` values in the `eip155` CAIP-2 namespace and a documented finality policy. |
| Hedera | A separate adapter for Hedera services with Hedera-specific finality semantics, behind the same capability boundary. |
| Chainlink CRE | Possibly used inside an adapter or an external provider to run off-chain workflows. Outputs would still enter as observations or evidence, never as confirmed state. |
| Chainlink CCIP | Possibly used inside a Network Adapter for cross-network messaging, producing `message` references. |
| Chainlink Proof of Reserve | Possibly read by an adapter as a data feed and recorded as `network_observation` evidence. A reserve report is evidence for a policy, not a policy result and not a confirmation. |

Introducing any production network or provider dependency requires an ADR. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Requirements for implementations

1. Adapters MUST hold their own keys and credentials in dedicated secret management; keys MUST NOT appear in Novera records, events or metadata.
2. Adapters MUST NOT publish personal data or document contents to a network. They MAY publish digests. Implementations SHOULD consider whether even a digest of low-entropy personal data is linkable, and salt or commit accordingly.
3. Adapters MUST be replaceable without changing core records: removing an adapter MUST NOT invalidate any participant, asset or workflow record.
4. Adapters MUST fail closed when a network is unavailable, reporting `not_observed` rather than guessing.

## Open questions

- A common anchoring format (single digest, Merkle root over a batch of events, or both).
- Whether per-subject event hash-chains should be anchored, and how often.
- How adapters should prove which policy they used to report `adapter_final`.
