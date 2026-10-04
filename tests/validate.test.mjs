// Tests for scripts/validate-schemas.mjs. Each negative case copies the repository's
// schemas and examples into a temporary directory, applies one mutation, and asserts
// that validation fails with the expected error code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, recordDigest, validateRepository } from "../scripts/validate-schemas.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function withRepo(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novera-specs-"));
  try {
    fs.cpSync(path.join(ROOT, "schemas"), path.join(dir, "schemas"), { recursive: true });
    fs.cpSync(path.join(ROOT, "examples"), path.join(dir, "examples"), { recursive: true });
    mutate(dir);
    return validateRepository(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function editJson(dir, rel, edit) {
  const file = path.join(dir, rel);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = edit(doc);
  fs.writeFileSync(file, JSON.stringify(result ?? doc, null, 2));
}

function codes(result) {
  return new Set(result.errors.map((e) => e.code));
}

function assertFails(result, code) {
  const found = codes(result);
  assert.ok(found.has(code), `expected ${code}; got ${[...found].join(", ") || "no errors"}`);
}

// ---------------------------------------------------------------- baseline
test("repository schemas and synthetic examples are valid", () => {
  const result = validateRepository(ROOT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.schemaCount, 8);
  assert.ok(result.exampleCount >= 6);
});

// ------------------------------------------------- schema structure checks
test("rejects a schema that is not valid JSON", () => {
  const r = withRepo((d) => fs.writeFileSync(path.join(d, "schemas/asset.schema.json"), "{ not json"));
  assertFails(r, "SCHEMA_PARSE");
});

test("rejects duplicate schema $id values", () => {
  const r = withRepo((d) => fs.copyFileSync(path.join(d, "schemas/asset.schema.json"), path.join(d, "schemas/asset-copy.schema.json")));
  assertFails(r, "SCHEMA_ID_DUPLICATE");
});

test("rejects a schema whose $id does not match its file name", () => {
  const r = withRepo((d) => editJson(d, "schemas/asset.schema.json", (s) => { s.$id = "https://schemas.noveraprotocol.org/v0.1/property.schema.json"; }));
  assertFails(r, "SCHEMA_ID_MISMATCH");
});

test("rejects a schema that does not declare Draft 2020-12", () => {
  const r = withRepo((d) => editJson(d, "schemas/evidence.schema.json", (s) => { s.$schema = "http://json-schema.org/draft-07/schema#"; }));
  assertFails(r, "SCHEMA_DRAFT");
});

test("rejects a $ref to a missing local file", () => {
  const r = withRepo((d) => editJson(d, "schemas/asset.schema.json", (s) => { s.properties.assetId = { description: "x", $ref: "missing.schema.json#/$defs/assetId" }; }));
  assertFails(r, "REF_UNRESOLVED");
});

test("rejects a $ref to a missing JSON Pointer target", () => {
  const r = withRepo((d) => editJson(d, "schemas/asset.schema.json", (s) => { s.properties.assetId = { description: "x", $ref: "common.schema.json#/$defs/noSuchDefinition" }; }));
  assertFails(r, "REF_UNRESOLVED");
});

test("rejects a $ref to a remote host", () => {
  const r = withRepo((d) => editJson(d, "schemas/asset.schema.json", (s) => { s.properties.assetId = { description: "x", $ref: "https://example.com/schemas/id.json" }; }));
  assertFails(r, "REF_UNRESOLVED");
});

test("rejects an object schema without an explicit additionalProperties decision", () => {
  const r = withRepo((d) => editJson(d, "schemas/evidence.schema.json", (s) => { delete s.additionalProperties; }));
  assertFails(r, "SCHEMA_LINT");
});

test("rejects a property without a description", () => {
  const r = withRepo((d) => editJson(d, "schemas/evidence.schema.json", (s) => { delete s.properties.title.description; }));
  assertFails(r, "SCHEMA_LINT");
});

// ------------------------------------------------------------ example checks
test("rejects a record schema with no example", () => {
  const r = withRepo((d) => fs.rmSync(path.join(d, "examples/evidence.example.json")));
  assertFails(r, "EXAMPLE_MISSING");
});

test("rejects an example without the synthetic label", () => {
  const r = withRepo((d) => editJson(d, "examples/asset.example.json", (x) => { delete x.metadata["novera:label"]; }));
  assertFails(r, "EXAMPLE_LABEL");
});

test("rejects an example missing a required field", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => { delete x.controlState; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an example in the wrong file for its recordType", () => {
  const r = withRepo((d) => fs.copyFileSync(path.join(d, "examples/asset.example.json"), path.join(d, "examples/participant.example.json")));
  assertFails(r, "EXAMPLE_SCHEMA");
});

test("rejects an unsupported specVersion", () => {
  const r = withRepo((d) => editJson(d, "examples/asset.example.json", (x) => { x.specVersion = "1.0"; }));
  assertFails(r, "EXAMPLE_INVALID");
});

// ----------------------------------------------------- identifier design
test("rejects an EVM address used as a participant identifier", () => {
  const r = withRepo((d) => editJson(d, "examples/participant.example.json", (x) => { x.participantId = "0x52908400098527886E0F7030069857D2E4169EE7"; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an identifier whose prefix does not match its type", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => { x.assetId = x.workflowId; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an unqualified global verified flag", () => {
  const r = withRepo((d) => editJson(d, "examples/participant.example.json", (x) => { x.verified = true; }));
  assertFails(r, "EXAMPLE_INVALID");
});

// ------------------------------------------------------------ event model
test("rejects a proposal that carries a confirmed state", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/01-proposal.event.json", (x) => { x.confirmedStateRef = x.proposedStateRef; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects a state transition applied by a participant rather than a system", () => {
  const r = withRepo((d) => editJson(d, "examples/event.example.json", (x) => {
    x.actorRef = { actorType: "participant", actorId: "ptc_01jq3k8m2n4p6r8s0t2v4w6x8y" };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an assistive system that confirms state", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/03-confirmation.event.json", (x) => {
    x.actorRef = { actorType: "assistive_system", actorId: "sys_01jq3k8m2n4p6r8s0t2v4w6x8y" };
    x.confidence = 0.99;
    x.provenance = { channel: "assistive_extraction", extraction: { method: "document_extraction", modelIdentifier: "synthetic-model/0", inputEvidenceRefs: x.evidenceRefs.length ? x.evidenceRefs : ["evd_01jq3k8m2n4p6r8s0t2v4w6x8y"] } };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an assistive proposal without confidence and extraction provenance", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/01-proposal.event.json", (x) => {
    x.actorRef = { actorType: "assistive_system", actorId: "sys_01jq3k8m2n4p6r8s0t2v4w6x8y" };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("accepts a well-formed assistive proposal when the workflow profile permits that proposer type", () => {
  const r = withRepo((d) => {
    editJson(d, "examples/real-estate-sequence/01-proposal.event.json", (x) => {
      x.actorRef = { actorType: "assistive_system", actorId: "sys_01jq3k8m2n4p6r8s0t2v4w6x8y" };
      x.confidence = 0.82;
      x.provenance = {
        channel: "assistive_extraction",
        extraction: { method: "document_extraction", modelIdentifier: "synthetic-model/0", inputEvidenceRefs: x.evidenceRefs },
      };
    });
    editJson(d, "examples/workflow-profile.example.json", (x) => {
      const rule = x.transitionRules.find((tr) => tr.from === "conditions_pending" && tr.to === "approved");
      rule.proposer.actorTypes.push("assistive_system");
      rule.proposer.roles = [];
    });
  });
  assert.deepEqual(r.errors, []);
});

test("rejects a rejection event without reason codes", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/03-confirmation.event.json", (x) => {
    x.eventType = "rejection";
    delete x.reasonCodes;
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an external observation without a source reference", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/02-validation.event.json", (x) => {
    x.eventType = "external_observation";
    x.actorRef = { actorType: "adapter", actorId: "adp_01jq3k8m2n4p6r8s0t2v4w6x8y" };
    delete x.proposedStateRef;
    x.provenance = { channel: "adapter_observation" };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects a state transition whose confirmed state differs from the proposal", () => {
  const r = withRepo((d) => editJson(d, "examples/event.example.json", (x) => {
    x.confirmedStateRef = { ...x.confirmedStateRef, digest: { algorithm: "sha-256", value: "0".repeat(64) } };
  }));
  assertFails(r, "SEM_EVENT");
});

test("rejects a proposal whose version does not follow the previous version", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/01-proposal.event.json", (x) => { x.proposedStateRef.version = 7; }));
  assertFails(r, "SEM_EVENT");
});

test("rejects an event caused by a later event", () => {
  const r = withRepo((d) => editJson(d, "examples/real-estate-sequence/02-validation.event.json", (x) => { x.timestamp = "2026-03-12T08:00:00Z"; }));
  assertFails(r, "X_CAUSALITY");
});

test("rejects a duplicate eventId across examples", () => {
  const r = withRepo((d) => fs.copyFileSync(path.join(d, "examples/event.example.json"), path.join(d, "examples/real-estate-sequence/04-replayed.event.json")));
  assertFails(r, "X_DUPLICATE_EVENT");
});

test("rejects a state reference whose digest does not match the referenced record", () => {
  const r = withRepo((d) => editJson(d, "examples/policy-result.example.json", (x) => {
    const asset = x.inputStateRefs.find((s) => s.subjectType === "asset");
    asset.digest.value = "f".repeat(64);
  }));
  assertFails(r, "X_DIGEST");
});

// ------------------------------------------------------------- NovaDeed
test("rejects a transition not permitted by the reference state machine", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => {
    x.transitions[1].to = "approved";
    x.transitions[2].from = "approved";
  }));
  assertFails(r, "SEM_STATE_MACHINE");
});

test("rejects a broken transition chain", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => { x.transitions[3].from = "draft"; }));
  assertFails(r, "SEM_WORKFLOW");
});

test("rejects a workflowState that disagrees with the last transition", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => { x.workflowState = "ready_for_settlement"; }));
  assertFails(r, "SEM_WORKFLOW");
});

test("rejects a completed workflow without a settlement reference", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => {
    x.workflowState = "completed";
    x.settlementRef = null;
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects a workflow that claims to be the authoritative ownership record", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => { x.recordAuthority = "authoritative_ownership_record"; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("requires an exact workflow profile version when workflowProfile is present", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => { delete x.workflowProfileVersion; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("enforces workflow-profile confirmer roles for the current transition", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow-profile.example.json", (x) => {
    const rule = x.transitionRules.find((tr) => tr.from === "conditions_pending" && tr.to === "approved");
    rule.confirmation.requiredActors[0].role = "buyer";
  }));
  assertFails(r, "X_PROFILE_AUTH");
});

test("enforces workflow-profile required policy gates", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow-profile.example.json", (x) => {
    const rule = x.transitionRules.find((tr) => tr.from === "conditions_pending" && tr.to === "approved");
    rule.requiredPolicyIds = ["novera-ref:real_estate.purchase.missing_policy"];
  }));
  assertFails(r, "X_PROFILE_POLICY");
});

test("rejects settlement_pending while settlement is only prepared", () => {
  const r = withRepo((d) => editJson(d, "examples/workflow.example.json", (x) => {
    x.workflowState = "settlement_pending";
    x.settlementRef = {
      adapterId: "adp_01jq3k8m2n4p6r8s0t2v4w6x8y",
      settlementType: "funds_and_title_closing",
      status: "prepared",
      updatedAt: "2026-03-12T10:00:03Z"
    };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

// ------------------------------------------------- NovaID / NovaRegistry
test("rejects eligibility based on an unconfirmed claim", () => {
  const r = withRepo((d) => editJson(d, "examples/participant.example.json", (x) => {
    const residence = x.claims.find((c) => c.claimType === "residence");
    x.eligibilityStates[0].basisClaimRefs.push(residence.claimId);
  }));
  assertFails(r, "SEM_PARTICIPANT");
});

test("rejects a claim whose issuer is not listed", () => {
  const r = withRepo((d) => editJson(d, "examples/participant.example.json", (x) => { x.issuerRefs = x.issuerRefs.slice(0, 1); }));
  assertFails(r, "SEM_PARTICIPANT");
});

test("rejects an eligibility state with no scope", () => {
  const r = withRepo((d) => editJson(d, "examples/participant.example.json", (x) => { delete x.eligibilityStates[0].scope; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects an asset relationship to an undeclared external reference", () => {
  const r = withRepo((d) => editJson(d, "examples/asset.example.json", (x) => {
    x.relationships.find((rel) => rel.targetType === "external_ref").targetRefKey = "unknown-registry";
  }));
  assertFails(r, "SEM_ASSET");
});

// ------------------------------------------------------ evidence / policy
test("rejects hash-only evidence that also carries a document URI", () => {
  const r = withRepo((d) => editJson(d, "examples/evidence.example.json", (x) => { x.uri = "https://documents.example/financing.pdf"; }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects public classification of evidence containing personal data", () => {
  const r = withRepo((d) => editJson(d, "examples/evidence.example.json", (x) => { x.handling.classification = "public"; }));
  assertFails(r, "SEM_EVIDENCE");
});

test("rejects a policy result evaluated by an assistive system", () => {
  const r = withRepo((d) => editJson(d, "examples/policy-result.example.json", (x) => {
    x.evaluatedBy = { actorType: "assistive_system", actorId: "sys_01jq3k8m2n4p6r8s0t2v4w6x8y" };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});

test("rejects evidence reviewed by an assistive system", () => {
  const r = withRepo((d) => editJson(d, "examples/evidence.example.json", (x) => {
    x.review.reviewedBy = { actorType: "assistive_system", actorId: "sys_01jq3k8m2n4p6r8s0t2v4w6x8y" };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});
test("rejects an eligibility state determined by an assistive system", () => {
  const r = withRepo((d) => editJson(d, "examples/participant.example.json", (x) => {
    x.eligibilityStates[0].determinedBy = { actorType: "assistive_system", actorId: "sys_01jq3k8m2n4p6r8s0t2v4w6x8y" };
  }));
  assertFails(r, "EXAMPLE_INVALID");
});
test("rejects a passing policy result with a failed condition", () => {
  const r = withRepo((d) => editJson(d, "examples/policy-result.example.json", (x) => { x.conditions[0].result = "fail"; }));
  assertFails(r, "SEM_POLICY");
});

test("rejects a policy result that claims to be a legal determination", () => {
  const r = withRepo((d) => editJson(d, "examples/policy-result.example.json", (x) => { x.resultAuthority = "legal_determination"; }));
  assertFails(r, "EXAMPLE_INVALID");
});

// --------------------------------------------------------- canonicalization
test("canonicalize orders keys and serializes numbers per RFC 8785", () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1e21, y: 0.000001 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0.000001,"z":1e+21}}');
  assert.equal(canonicalize({ "\u20ac": 1, "\r": 2 }), '{"\\r":2,"€":1}');
});

test("state digest ignores transition history, updatedAt and metadata", () => {
  const base = { recordType: "workflow", version: 2, workflowState: "proposed" };
  const withHistory = { ...base, transitions: [{ sequence: 1 }], updatedAt: "2026-01-01T00:00:00Z", metadata: { "acme:x": 1 } };
  assert.equal(recordDigest(base), recordDigest(withHistory));
  assert.notEqual(recordDigest(base), recordDigest({ ...base, workflowState: "draft" }));
});
