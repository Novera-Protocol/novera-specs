# Policy model

**Specification v0.1 — PRE-PRODUCTION / DESIGN SPECIFICATION**

Schema: [policy-result.schema.json](../schemas/policy-result.schema.json) · Example: [policy-result.example.json](../examples/policy-result.example.json)

## Scope of this model

Novera v0.1 does **not** define a compliance engine, a policy language or a set of legal rules. It defines the **result** of evaluating a policy: a structured, scoped and immutable record saying which policy was evaluated, against which inputs, by whom, with what outcome and for what reasons.

> A policy result is an evaluation result. It is not a legal determination, a regulatory approval or legal advice.

Every policy result carries `resultAuthority: "evaluation_result_not_legal_determination"`. The schema fixes this value so that no consumer can present a policy result as anything else.

## What a policy is

A **policy** is a named, versioned set of conditions that a deployment, an operator or a workflow profile requires before a step may proceed. Examples:

- the conditions for a purchase workflow to move to `approved`;
- the eligibility rules for a participant in a specific workflow;
- the evidence a deployment requires before an asset record moves to `registered`.

Policies are identified by `policyId` (an extension token, for example `novera-ref:real_estate.purchase.conditions`) and `policyVersion` (semantic version). `policyDigest` MAY identify the exact definition evaluated.

Policy logic can be:

| Kind | `evaluationMethod` | Evaluator (`evaluatedBy.actorType`) | Extra requirements |
| --- | --- | --- | --- |
| Deterministic rules | `deterministic_rules` | `system` (schema-enforced) | `inputsDigest` REQUIRED |
| External provider output, such as a screening result | `external_provider` | `external_provider` (schema-enforced) | Provider evidence SHOULD be cited |
| Human review by an authorized person | `human_review` | `participant` (schema-enforced) | — |
| A combination | `hybrid` | any non-assistive actor | Each part SHOULD be described in `conditions` |

**Jurisdiction-specific logic** is not a separate method. It is expressed through the policy identity (a different `policyId` or version per jurisdiction) and through `scope.jurisdiction`.

`evaluatedBy` MUST NOT be an assistive system, under any method. An assistive system can contribute evidence or a proposal; it is never the evaluator of record. See [intelligence-boundary.md](intelligence-boundary.md).

## Result values

| `result` | Meaning | `reasonCodes` |
| --- | --- | --- |
| `pass` | Every evaluated condition was satisfied. | MAY be empty |
| `fail` | At least one condition was not satisfied. | at least one REQUIRED |
| `indeterminate` | The inputs were insufficient to decide. | at least one REQUIRED |
| `not_applicable` | The policy does not apply to the subjects in scope. | MAY be empty |
| `requires_review` | A human or provider decision is required before the result can be `pass` or `fail`. | at least one REQUIRED |

When `conditions` are listed, the overall result MUST be consistent with them. The validator rejects a `pass` with any condition that is `fail`, `indeterminate` or `requires_review`, and a `fail` with listed conditions none of which failed. Condition identifiers MUST be unique within a result.

Reason codes are dot-separated lowercase segments, optionally namespaced: `conditions.all_met`, `evidence.expired`, `acme:manual_hold`.

## Scope

Every policy result has a `scope`, with `contextType` (`workflow`, `asset`, `program`, `deployment` or an extension), `contextId` (required for workflow and asset scopes), optional `jurisdiction` and a `purpose`.

> A policy result MUST NOT be relied on outside its scope.

There is deliberately no global scope. A pass for one workflow says nothing about another workflow, even for the same participant and asset.

## Reproducibility

A deterministic result SHOULD be reproducible by a third party:

- `inputStateRefs` names the exact versions of the records evaluated, with their state digests (see [state-model.md](state-model.md));
- `evidenceRefs` and `conditions[].evidenceRefs` name the evidence evaluated;
- `inputsDigest` is the digest of the complete canonical evaluation input;
- `policyId`, `policyVersion` and `policyDigest` identify the logic.

The validator checks that every `inputStateRefs` digest in the examples matches the referenced example record.

## Validity and replacement

- Policy results are immutable.
- `validUntil`, when present, is when the result lapses. A result MUST be re-evaluated before it is relied on after that time.
- A new result for the same policy and scope MAY name the earlier one in `supersedes`. A result MUST NOT supersede itself.
- A result evaluated against an older version of a subject is stale for a transition based on a newer version. Implementations MUST check that a result's `inputStateRefs` match the versions a transition is based on, or that the policy explicitly tolerates the difference.

## Use in workflows

A NovaDeed workflow lists the policies it depends on in `policyRefs`, each with the target states it is `requiredFor` and the `resultRefs` produced so far.

- A `validation` NoveraEvent cites one or more policy results in `policyResultRefs`. It reports results; it does not approve.
- A `state_transition` into a state listed in a policy's `requiredFor` MUST be preceded by a validation citing a current, in-scope result for that policy that permits the transition. See [event-model.md](event-model.md).
- A policy result MUST have been evaluated at or before the time of any event that cites it. The validator enforces this ordering for the examples.

## Example

[policy-result.example.json](../examples/policy-result.example.json) is a synthetic `deterministic_rules` result for `novera-ref:real_estate.purchase.conditions` version 0.1.0, scoped to the reference purchase workflow in fictional jurisdiction `XZ`. It records four passing conditions (financing, inspection, title search, buyer eligibility), cites the evidence behind each, and names the workflow (version 4), asset and buyer participant states it evaluated. Its `pass` is a statement about those inputs and that policy version only.

## Not in v0.1

- A policy definition language or rule format.
- A registry of policies, or any normative legal or regulatory rules.
- Signed policy results. Implementations SHOULD authenticate evaluators; a signature envelope is an open question.
