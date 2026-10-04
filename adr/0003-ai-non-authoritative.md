# ADR 0003 — AI non-authoritative

- **Status:** Accepted for specification v0.1
- **Date:** 2026-10-03
- **Scope:** Novera Intelligence (FUTURE CAPABILITY) and any assistive system

## Context

Novera Intelligence is a planned assistive capability that may extract structured data from documents and propose state changes. It is a **FUTURE CAPABILITY**: it is not built, and no model or provider has been selected.

Model outputs can be wrong, can be manipulated through document content (prompt injection), and cannot be reproduced exactly. If such output could change Novera state directly, a single faulty or manipulated extraction could alter participant, asset or workflow records.

## Decision

AI-generated output is always a proposal requiring validation and confirmation before any deterministic Novera state change.

The event schema enforces, for actors with `actorType: "assistive_system"`:

1. They MAY emit only `proposal` events.
2. A proposal MUST report `confidence`, MUST use `provenance.channel: "assistive_extraction"` and MUST disclose `provenance.extraction`.
3. They MUST NOT emit `validation`, `confirmation`, `rejection`, `state_transition` or `external_observation` events.
4. They MUST NOT evaluate policies, review evidence or determine eligibility.

A proposal changes nothing. State changes only through a `state_transition` event after deterministic validation and confirmation by an authorized human or institutional actor.

## Consequences

- Assistive output can save effort but cannot be the sole basis of a state change.
- Each proposal carries confidence and provenance, so reviewers can see what was extracted, how, and from which evidence.
- Confirmations by people remain necessary, which limits automation. That is the intended trade-off.
- Novera Intelligence is not a fourth state primitive; it sits above NovaID, NovaRegistry and NovaDeed and has no write path.
- Removing or weakening these rules requires a new ADR.

## Alternatives considered

| Alternative | Reason not chosen |
| --- | --- |
| Allow high-confidence AI output to apply automatically | Confidence is not correctness; a manipulated document can yield confident wrong output. |
| Let AI evaluate policies | Policy results must be reproducible from the same inputs, which model output is not. |
| Rely on documentation rather than schema rules | Schema rules are checked on every event; documentation is not. |

## Related

[intelligence-boundary.md](../architecture/intelligence-boundary.md) · [event-model.md](../architecture/event-model.md) · [threat-model.md](../security/threat-model.md)
