# ADR 0001 — Chain-agnostic core

- **Status:** Accepted for specification v0.1
- **Date:** 2026-10-03
- **Scope:** All record schemas, identifiers and the Network Adapter boundary

## Context

Real-world-asset workflows combine business state (who is participating, what the asset is, which conditions are met) with network state (which ledger, if any, carries a representation of that state). These change at different rates and for different reasons. A workflow's semantics should survive a change of network, the use of several networks at once, or the use of no network at all.

Novera is EVM-first and chain-agnostic. No production network has been selected. Base is a leading candidate, Hedera an optional future adapter, and Chainlink CRE, CCIP and Proof of Reserve are conditional future integrations. None is integrated.

Coupling the core models to one network now would force a redesign later, would make identifiers non-portable, and would imply a network choice that has not been made.

## Decision

Novera's core state models MUST NOT require a single blockchain or any blockchain.

1. Canonical identifiers are opaque Novera identifiers (`ptc_`, `ast_`, `wfl_`, `evd_`, `plr_`, `evt_`). A blockchain address, token identifier, contract address or transaction hash MUST NOT be used as a Novera identifier.
2. Network-specific data appears only in adapter-produced `networkRefs` entries, which use CAIP-2 network identifiers and carry their own finality status.
3. The core schemas name no network. Network-specific semantics belong in adapter specifications.
4. Introducing a production network dependency requires a new ADR.

## Consequences

- Participants, assets and workflows keep stable identifiers across network changes and multiple representations.
- Adapters translate between Novera state and network state, and must report finality explicitly rather than having it assumed.
- Implementations need a mapping layer between Novera identifiers and network references; that cost is accepted.
- The specification cannot rely on on-chain guarantees such as contract-enforced ordering. Ordering, idempotency and authority are defined in the event model instead.

## Alternatives considered

| Alternative | Reason not chosen |
| --- | --- |
| Use EVM addresses as participant identifiers | Conflates key control with identity, prevents key rotation, and leaks network choice into every record. |
| Use token IDs as asset identifiers | An asset exists before and independently of any token; several tokens may represent one asset. |
| Use transaction hashes as workflow identifiers | Workflows span many transactions and may start before any network interaction. |
| Design for one selected network now | No network has been selected; doing so would misrepresent the current posture. |

## Related

[network-adapters.md](../architecture/network-adapters.md) · [overview.md](../architecture/overview.md)
