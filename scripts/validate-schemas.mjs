#!/usr/bin/env node
// Novera Protocol Specification v0.1 — schema and example validator.
//
// Checks performed (all failures are errors; the process exits non-zero):
//   1. Every schema file parses as JSON and declares JSON Schema Draft 2020-12.
//   2. Every schema has a stable $id in the v0.1 namespace that matches its file name.
//   3. Duplicate schema $id values are rejected.
//   4. Every $ref resolves to a loaded schema and an existing JSON Pointer target.
//      References to other hosts are rejected (no network fetches).
//   5. Lint: top-level title/description, a description on every declared property,
//      and an explicit additionalProperties/unevaluatedProperties on every object type.
//   6. Every schema compiles with Ajv (strict keyword checking).
//   7. Every example parses, is labelled SYNTHETIC EXAMPLE DATA and validates against
//      the schema selected by its recordType (and by its file name, where applicable).
//   8. Every record schema has at least one example.
//   9. Semantic rules that JSON Schema cannot express (state machine, cross-references
//      within a record, authority rules, digest consistency across examples).
//
// Usage: node scripts/validate-schemas.mjs [repositoryRoot]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
export const ID_BASE = "https://schemas.noveraprotocol.org/v0.1/";
export const SYNTHETIC_LABEL = "SYNTHETIC EXAMPLE DATA";

// Illustrative NovaDeed reference state machine (primitives/novadeed.md).
// Only transitions between core states are checked; namespaced profile states are not.
export const REFERENCE_TRANSITIONS = {
  draft: ["proposed", "cancelled"],
  proposed: ["under_review", "draft", "cancelled"],
  under_review: ["conditions_pending", "approved", "proposed", "cancelled"],
  conditions_pending: ["approved", "under_review", "cancelled"],
  approved: ["ready_for_settlement", "conditions_pending", "cancelled"],
  ready_for_settlement: ["settlement_pending", "approved", "cancelled"],
  settlement_pending: ["completed", "ready_for_settlement"],
  completed: [],
  cancelled: [],
};

const ID_FIELD = {
  participant: "participantId",
  asset: "assetId",
  workflow: "workflowId",
  evidence: "evidenceId",
  policy_result: "policyResultId",
  event: "eventId",
  workflow_profile: "workflowProfileId",
};

// ---------------------------------------------------------------------------
// RFC 8785 JSON Canonicalization Scheme (JCS) for the JSON values used here.
// ECMAScript number serialization and UTF-16 code-unit key ordering are exactly
// what JSON.stringify and the default Array.prototype.sort provide.
export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Non-finite numbers cannot be canonicalized");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

// Members excluded from the state projection (architecture/state-model.md).
export const NON_STATE_MEMBERS = ["transitions", "updatedAt", "metadata"];

export function stateProjection(record) {
  const projection = { ...record };
  for (const member of NON_STATE_MEMBERS) delete projection[member];
  return projection;
}

// State digest: SHA-256 over the RFC 8785 canonical JSON of the state projection.
export function recordDigest(record) {
  return crypto.createHash("sha256").update(canonicalize(stateProjection(record)), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJson(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

function decodePointerToken(token) {
  return decodeURIComponent(token).replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(doc, pointer) {
  if (pointer === "" || pointer === "/") return { found: pointer === "", value: doc };
  if (!pointer.startsWith("/")) return { found: false };
  let node = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const token = decodePointerToken(raw);
    if (node === null || typeof node !== "object" || !(token in node)) return { found: false };
    node = node[token];
  }
  return { found: true, value: node };
}

// Walk every subschema, reporting its JSON Pointer location.
function walkSchema(node, at, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkSchema(item, `${at}/${i}`, visit));
    return;
  }
  visit(node, at);
  for (const [key, child] of Object.entries(node)) {
    if (key === "const" || key === "enum" || key === "examples" || key === "default") continue;
    if (key === "properties" || key === "$defs" || key === "patternProperties") {
      for (const [name, sub] of Object.entries(child)) walkSchema(sub, `${at}/${key}/${name}`, visit);
    } else if (child && typeof child === "object") {
      walkSchema(child, `${at}/${key}`, visit);
    }
  }
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function deepEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}

// ---------------------------------------------------------------------------
export function validateRepository(root) {
  const errors = [];
  const notes = [];
  const err = (code, file, message) => errors.push({ code, file, message });

  // 1–3. Load schemas -------------------------------------------------------
  const schemaFiles = listJson(path.join(root, "schemas"));
  const schemas = new Map(); // $id -> { file, doc }
  for (const file of schemaFiles) {
    const name = rel(root, file);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      err("SCHEMA_PARSE", name, `invalid JSON: ${e.message}`);
      continue;
    }
    if (doc.$schema !== DRAFT_2020_12) {
      err("SCHEMA_DRAFT", name, `$schema must be ${DRAFT_2020_12}`);
    }
    if (typeof doc.$id !== "string" || doc.$id.length === 0) {
      err("SCHEMA_ID_MISSING", name, "schema has no $id");
      continue;
    }
    const expectedId = `${ID_BASE}${path.basename(file)}`;
    if (doc.$id !== expectedId) {
      err("SCHEMA_ID_MISMATCH", name, `$id ${doc.$id} does not match expected ${expectedId}`);
    }
    if (schemas.has(doc.$id)) {
      err("SCHEMA_ID_DUPLICATE", name, `duplicate $id ${doc.$id} (already declared by ${schemas.get(doc.$id).file})`);
      continue;
    }
    schemas.set(doc.$id, { file: name, doc });
  }

  // 4–5. Static reference resolution and lint --------------------------------
  for (const [id, { file, doc }] of schemas) {
    if (typeof doc.title !== "string" || typeof doc.description !== "string") {
      err("SCHEMA_LINT", file, "schema must declare a top-level title and description");
    }
    walkSchema(doc, "", (node, at) => {
      if (typeof node.$ref === "string") {
        let target;
        try {
          target = new URL(node.$ref, id);
        } catch {
          err("REF_INVALID", file, `${at}: $ref ${node.$ref} is not a valid URI reference`);
          return;
        }
        const base = `${target.origin}${target.pathname}`;
        const entry = schemas.get(base);
        if (!entry) {
          err("REF_UNRESOLVED", file, `${at}: $ref ${node.$ref} points to ${base}, which is not a schema in this repository`);
          return;
        }
        const pointer = target.hash ? decodeURIComponent(target.hash.slice(1)) : "";
        if (!resolvePointer(entry.doc, pointer).found) {
          err("REF_UNRESOLVED", file, `${at}: $ref ${node.$ref} — pointer ${pointer} does not exist in ${entry.file}`);
        }
      }
      if (node.properties && typeof node.properties === "object" && node.type === "object") {
        for (const [prop, sub] of Object.entries(node.properties)) {
          if (!sub || typeof sub.description !== "string" || sub.description.length === 0) {
            err("SCHEMA_LINT", file, `${at}/properties/${prop}: property has no description`);
          }
        }
      }
      if (node.type === "object" && !("additionalProperties" in node) && !("unevaluatedProperties" in node)) {
        err("SCHEMA_LINT", file, `${at || "/"}: object schema must set additionalProperties or unevaluatedProperties explicitly`);
      }
    });
  }

  // 6. Compile -------------------------------------------------------------------
  // strictTypes/strictRequired are disabled because Draft 2020-12 conditionals
  // (if/then) intentionally constrain properties that the parent schema defines.
  const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allErrors: true });
  addFormats(ajv);
  const compiled = new Map();
  if (!errors.some((e) => e.code.startsWith("REF_") || e.code === "SCHEMA_PARSE")) {
    try {
      for (const { doc } of schemas.values()) ajv.addSchema(doc);
      for (const [id, { file }] of schemas) {
        try {
          compiled.set(id, ajv.getSchema(id));
        } catch (e) {
          err("SCHEMA_COMPILE", file, e.message);
        }
      }
    } catch (e) {
      err("SCHEMA_COMPILE", "schemas/", e.message);
    }
  }

  // Record schemas are those whose recordType property is a const.
  const recordSchemas = new Map(); // recordType -> $id
  for (const [id, { doc }] of schemas) {
    const rt = doc.properties?.recordType?.const;
    if (typeof rt === "string") recordSchemas.set(rt, id);
  }

  // 7. Examples --------------------------------------------------------------------
  const exampleFiles = listJson(path.join(root, "examples"));
  const examples = []; // { file, doc }
  const covered = new Set();
  for (const file of exampleFiles) {
    const name = rel(root, file);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      err("EXAMPLE_PARSE", name, `invalid JSON: ${e.message}`);
      continue;
    }
    if (doc?.metadata?.["novera:synthetic"] !== true || doc?.metadata?.["novera:label"] !== SYNTHETIC_LABEL) {
      err("EXAMPLE_LABEL", name, `example must set metadata["novera:synthetic"] = true and metadata["novera:label"] = "${SYNTHETIC_LABEL}"`);
    }
    const id = recordSchemas.get(doc?.recordType);
    if (!id) {
      err("EXAMPLE_SCHEMA", name, `unknown or missing recordType ${JSON.stringify(doc?.recordType)}`);
      continue;
    }
    const base = path.basename(file).match(/^(.+)\.example\.json$/);
    if (path.dirname(name) === "examples") {
      const expected = base ? `${ID_BASE}${base[1]}.schema.json` : null;
      if (expected !== id) {
        err("EXAMPLE_SCHEMA", name, `file name does not correspond to the schema for recordType ${doc.recordType} (${id})`);
      }
    }
    const validate = compiled.get(id);
    if (!validate) continue;
    covered.add(id);
    if (!validate(doc)) {
      for (const e of validate.errors) {
        err("EXAMPLE_INVALID", name, `${e.instancePath || "/"} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
      }
      continue;
    }
    examples.push({ file: name, doc });
  }

  // 8. Coverage ---------------------------------------------------------------------
  for (const [rt, id] of recordSchemas) {
    if (compiled.has(id) && !covered.has(id)) {
      err("EXAMPLE_MISSING", schemas.get(id).file, `no example validates against the ${rt} schema`);
    }
  }

  // 9. Semantic rules ---------------------------------------------------------------
  for (const { file, doc } of examples) {
    for (const [code, message] of semanticIssues(doc)) err(code, file, message);
  }
  for (const [code, file, message] of crossExampleIssues(examples)) err(code, file, message);

  notes.push(`${schemas.size} schemas loaded, ${compiled.size} compiled`);
  notes.push(`${examples.length} of ${exampleFiles.length} examples valid`);
  return { errors, notes, schemaCount: schemas.size, exampleCount: exampleFiles.length };
}

// ---------------------------------------------------------------------------
// Rules that JSON Schema cannot express. Each returns [code, message] pairs.
export function semanticIssues(doc) {
  const out = [];
  const add = (code, message) => out.push([code, message]);
  const before = (a, b) => Date.parse(a) <= Date.parse(b);
  if (doc.createdAt && doc.updatedAt && !before(doc.createdAt, doc.updatedAt)) {
    add("SEM_TIME", "createdAt is later than updatedAt");
  }

  switch (doc.recordType) {
    case "participant": {
      const issuers = new Set();
      for (const i of doc.issuerRefs) {
        if (issuers.has(i.issuerId)) add("SEM_PARTICIPANT", `duplicate issuerRefs entry ${i.issuerId}`);
        issuers.add(i.issuerId);
      }
      const issuerType = new Map(doc.issuerRefs.map((i) => [i.issuerId, i.issuerType]));
      const claims = new Map();
      for (const c of doc.claims) {
        if (claims.has(c.claimId)) add("SEM_PARTICIPANT", `duplicate claimId ${c.claimId}`);
        claims.set(c.claimId, c);
        if (!issuers.has(c.issuerId)) add("SEM_PARTICIPANT", `claim ${c.claimId} issuer ${c.issuerId} is not listed in issuerRefs`);
        if (c.status === "confirmed" && issuerType.get(c.issuerId) === "self" && c.provenance.method === "self_assertion") {
          add("SEM_PARTICIPANT", `claim ${c.claimId} is self-issued and cannot be confirmed by self-assertion alone`);
        }
        if (c.confirmedAt && !before(c.assertedAt, c.confirmedAt)) add("SEM_TIME", `claim ${c.claimId} confirmedAt precedes assertedAt`);
        if (c.validFrom && c.validUntil && !before(c.validFrom, c.validUntil)) add("SEM_TIME", `claim ${c.claimId} validUntil precedes validFrom`);
      }
      doc.eligibilityStates.forEach((e, i) => {
        for (const ref of e.basisClaimRefs) {
          if (!claims.has(ref)) add("SEM_PARTICIPANT", `eligibilityStates[${i}] basis claim ${ref} is not a claim in this record`);
        }
        if (e.status === "eligible") {
          if (e.basisClaimRefs.length === 0) add("SEM_PARTICIPANT", `eligibilityStates[${i}] is eligible without any basis claim`);
          for (const ref of e.basisClaimRefs) {
            if (claims.has(ref) && claims.get(ref).status !== "confirmed") {
              add("SEM_PARTICIPANT", `eligibilityStates[${i}] is eligible but basis claim ${ref} is ${claims.get(ref).status}, not confirmed`);
            }
          }
        }
      });
      break;
    }
    case "asset": {
      const keys = new Set();
      for (const r of doc.authoritativeRefs) {
        if (keys.has(r.refKey)) add("SEM_ASSET", `duplicate authoritativeRefs refKey ${r.refKey}`);
        keys.add(r.refKey);
      }
      doc.identifiers.forEach((idf, i) => {
        if (idf.authoritativeRefKey && !keys.has(idf.authoritativeRefKey)) {
          add("SEM_ASSET", `identifiers[${i}] authoritativeRefKey ${idf.authoritativeRefKey} does not match any authoritativeRefs entry`);
        }
      });
      doc.relationships.forEach((r, i) => {
        if (r.targetType === "external_ref" && !keys.has(r.targetRefKey)) {
          add("SEM_ASSET", `relationships[${i}] targetRefKey ${r.targetRefKey} does not match any authoritativeRefs entry`);
        }
        if (r.targetType === "asset" && r.targetId === doc.assetId) add("SEM_ASSET", `relationships[${i}] relates the asset to itself`);
      });
      break;
    }
    case "workflow": {
      const t = doc.transitions;
      const events = new Set();
      t.forEach((tr, i) => {
        if (tr.sequence !== i + 1) add("SEM_WORKFLOW", `transitions[${i}] has sequence ${tr.sequence}; expected ${i + 1}`);
        if (events.has(tr.eventId)) add("SEM_WORKFLOW", `transitions[${i}] reuses eventId ${tr.eventId}`);
        events.add(tr.eventId);
        if (i === 0 && tr.from !== null) add("SEM_WORKFLOW", "the first transition must have from: null");
        if (i > 0) {
          if (tr.from === null) add("SEM_WORKFLOW", `transitions[${i}] has from: null but is not the first transition`);
          else if (tr.from !== t[i - 1].to) add("SEM_WORKFLOW", `transitions[${i}] starts from ${tr.from}, but the previous transition ended in ${t[i - 1].to}`);
          if (!before(t[i - 1].transitionedAt, tr.transitionedAt)) add("SEM_TIME", `transitions[${i}] is earlier than transitions[${i - 1}]`);
        }
        const coreFrom = tr.from !== null && tr.from in REFERENCE_TRANSITIONS;
        const coreTo = tr.to in REFERENCE_TRANSITIONS;
        if (coreFrom && coreTo && !REFERENCE_TRANSITIONS[tr.from].includes(tr.to)) {
          add("SEM_STATE_MACHINE", `transitions[${i}] ${tr.from} -> ${tr.to} is not permitted by the reference state machine`);
        }
        if (tr.from === null && coreTo && tr.to !== "draft") {
          add("SEM_STATE_MACHINE", `a workflow using core states must be created in draft, not ${tr.to}`);
        }
      });
      if (t.length > 0) {
        if (t[t.length - 1].to !== doc.workflowState) add("SEM_WORKFLOW", `workflowState ${doc.workflowState} does not match the last transition (${t[t.length - 1].to})`);
        if (doc.version !== t.length) add("SEM_WORKFLOW", `version ${doc.version} does not equal the number of transitions (${t.length})`);
        if (!before(t[t.length - 1].transitionedAt, doc.updatedAt)) add("SEM_TIME", "updatedAt is earlier than the last transition");
      }
      const members = new Set(doc.participants.map((p) => p.participantId));
      const seen = new Set();
      for (const p of doc.participants) {
        const key = `${p.participantId}/${p.role}`;
        if (seen.has(key)) add("SEM_WORKFLOW", `participant ${p.participantId} is listed twice in role ${p.role}`);
        seen.add(key);
      }
      for (const ref of [...doc.controlState.recordedControllerRefs, ...(doc.controlState.proposedControllerRefs ?? [])]) {
        if (!members.has(ref)) add("SEM_WORKFLOW", `controlState references ${ref}, which is not a workflow participant`);
      }
      break;
    }
    case "evidence": {
      if (doc.handling.containsPersonalData && doc.handling.classification === "public") {
        add("SEM_EVIDENCE", "evidence containing personal data cannot be classified public");
      }
      if (doc.supersededBy === doc.evidenceId) add("SEM_EVIDENCE", "evidence cannot supersede itself");
      if (doc.validFrom && doc.validUntil && !before(doc.validFrom, doc.validUntil)) add("SEM_TIME", "validUntil precedes validFrom");
      break;
    }
    case "policy_result": {
      const ids = new Set();
      for (const c of doc.conditions ?? []) {
        if (ids.has(c.conditionId)) add("SEM_POLICY", `duplicate conditionId ${c.conditionId}`);
        ids.add(c.conditionId);
      }
      const results = (doc.conditions ?? []).map((c) => c.result);
      if (doc.result === "pass" && results.some((r) => ["fail", "indeterminate", "requires_review"].includes(r))) {
        add("SEM_POLICY", "result is pass, but at least one condition did not pass");
      }
      if (doc.result === "fail" && results.length > 0 && !results.includes("fail")) {
        add("SEM_POLICY", "result is fail, but no condition failed");
      }
      if (doc.supersedes === doc.policyResultId) add("SEM_POLICY", "a policy result cannot supersede itself");
      break;
    }
    case "workflow_profile": {
      const seenTransitions = new Set();
      for (const rule of doc.transitionRules) {
        const key = `${rule.from ?? "<create>"}->${rule.to}`;
        if (seenTransitions.has(key)) add("SEM_PROFILE", `duplicate transition rule ${key}`);
        seenTransitions.add(key);
        const requiredTotal = rule.confirmation.requiredActors.reduce((sum, r) => sum + r.count, 0);
        if (requiredTotal > rule.confirmation.minCount) {
          add("SEM_PROFILE", `transition ${key} has required actor counts (${requiredTotal}) greater than minCount (${rule.confirmation.minCount})`);
        }
      }
      break;
    }
    case "event": {
      const refs = ["previousStateRef", "proposedStateRef", "confirmedStateRef"];
      for (const r of refs) {
        const s = doc[r];
        if (s && (s.subjectType !== doc.subjectType || s.subjectId !== doc.subjectId)) {
          add("SEM_EVENT", `${r} refers to ${s.subjectType} ${s.subjectId}, not the event subject`);
        }
      }
      const nextVersion = doc.previousStateRef ? doc.previousStateRef.version + 1 : 1;
      for (const r of ["proposedStateRef", "confirmedStateRef"]) {
        if (doc[r] && "previousStateRef" in doc && doc[r].version !== nextVersion) {
          add("SEM_EVENT", `${r}.version is ${doc[r].version}; expected ${nextVersion}`);
        }
      }
      if (doc.eventType === "state_transition" && doc.proposedStateRef && !deepEqual(doc.proposedStateRef, doc.confirmedStateRef)) {
        add("SEM_EVENT", "state_transition confirmedStateRef differs from the proposedStateRef it applies");
      }
      if ((doc.causedBy ?? []).includes(doc.eventId)) add("SEM_EVENT", "an event cannot be caused by itself");
      break;
    }
    default:
      break;
  }
  return out;
}

// Consistency between examples: identifiers, versions and digests must agree.
export function crossExampleIssues(examples) {
  const out = [];
  const records = new Map(); // `${type}/${id}/${version}` -> { file, digest }
  const byId = new Map(); // `${type}/${id}` -> doc
  const eventIds = new Map();
  const eventDocs = new Map(); // eventId -> doc
  for (const { file, doc } of examples) {
    const id = doc[ID_FIELD[doc.recordType]];
    if (doc.recordType === "event") {
      if (eventIds.has(id)) out.push(["X_DUPLICATE_EVENT", file, `eventId ${id} is also used by ${eventIds.get(id)}`]);
      eventIds.set(id, file);
      eventDocs.set(id, doc);
      continue;
    }
    if (typeof doc.version === "number") {
      records.set(`${doc.recordType}/${id}/${doc.version}`, { file, digest: recordDigest(doc) });
    }
    byId.set(`${doc.recordType}/${id}`, doc);
  }

  const seen = new Map(); // key -> { digest, file }
  const visitStateRef = (file, where, s) => {
    const key = `${s.subjectType}/${s.subjectId}/${s.version}`;
    const rec = records.get(key);
    if (rec && s.digest.algorithm === "sha-256" && s.digest.value !== rec.digest) {
      out.push(["X_DIGEST", file, `${where} digest does not match the state digest of ${rec.file} (${rec.digest})`]);
    }
    const prior = seen.get(key);
    if (prior && !deepEqual(prior.digest, s.digest)) {
      out.push(["X_DIGEST", file, `${where} digest for ${key} disagrees with ${prior.file}`]);
    }
    if (!prior) seen.set(key, { digest: s.digest, file });
  };
  for (const { file, doc } of examples) {
    for (const r of ["previousStateRef", "proposedStateRef", "confirmedStateRef"]) {
      if (doc[r]) visitStateRef(file, r, doc[r]);
    }
    (doc.inputStateRefs ?? []).forEach((s, i) => visitStateRef(file, `inputStateRefs[${i}]`, s));
  }

  for (const { file, doc } of examples) {
    if (doc.recordType === "workflow" && doc.controlState.authoritativeRefKey) {
      const asset = byId.get(`asset/${doc.assetId}`);
      if (asset && !asset.authoritativeRefs.some((r) => r.refKey === doc.controlState.authoritativeRefKey)) {
        out.push(["X_REFERENCE", file, `controlState.authoritativeRefKey ${doc.controlState.authoritativeRefKey} is not an authoritativeRefs entry of asset ${doc.assetId}`]);
      }
    }
    if (doc.recordType === "workflow" && doc.workflowProfile) {
      const profile = byId.get(`workflow_profile/${doc.workflowProfile}`);
      if (!profile) {
        out.push(["X_PROFILE", file, `workflowProfile ${doc.workflowProfile} has no matching workflow_profile example`]);
      } else if (profile.profileVersion !== doc.workflowProfileVersion) {
        out.push(["X_PROFILE", file, `workflowProfileVersion ${doc.workflowProfileVersion} does not match resolved profile version ${profile.profileVersion}`]);
      } else if (profile.workflowType !== doc.workflowType) {
        out.push(["X_PROFILE", file, `workflow type ${doc.workflowType} does not match profile workflowType ${profile.workflowType}`]);
      } else if (doc.transitions.length > 0) {
        const last = doc.transitions[doc.transitions.length - 1];
        const rule = profile.transitionRules.find((r) => r.from === last.from && r.to === last.to);
        if (!rule) {
          out.push(["X_PROFILE_AUTH", file, `profile has no authorization rule for ${last.from ?? "<create>"} -> ${last.to}`]);
        } else {
          const transitionEvent = eventDocs.get(last.eventId);
          if (transitionEvent) {
            const causes = (transitionEvent.causedBy ?? []).map((id) => eventDocs.get(id)).filter(Boolean);
            const proposals = causes.filter((e) => e.eventType === "proposal");
            const confirmations = causes.filter((e) => e.eventType === "confirmation");
            const proposal = proposals.find((e) => e.subjectId === doc.workflowId && e.proposedStateRef?.state === last.to);
            if (!proposal) {
              out.push(["X_PROFILE_AUTH", file, `state transition ${last.eventId} does not cite a proposal for target ${last.to}`]);
            } else {
              if (!rule.proposer.actorTypes.includes(proposal.actorRef.actorType)) {
                out.push(["X_PROFILE_AUTH", file, `proposal actorType ${proposal.actorRef.actorType} is not permitted for ${last.from} -> ${last.to}`]);
              }
              if ((rule.proposer.roles ?? []).length > 0 && !rule.proposer.roles.includes(proposal.actorRef.role)) {
                out.push(["X_PROFILE_AUTH", file, `proposal role ${proposal.actorRef.role ?? "<none>"} is not permitted for ${last.from} -> ${last.to}`]);
              }
              const distinctConfirmers = new Set(confirmations.map((e) => e.actorRef.actorId));
              if (distinctConfirmers.size < rule.confirmation.minCount) {
                out.push(["X_PROFILE_AUTH", file, `transition has ${distinctConfirmers.size} distinct confirmations; profile requires ${rule.confirmation.minCount}`]);
              }
              if (rule.confirmation.disallowProposerConfirmation && confirmations.some((e) => e.actorRef.actorId === proposal.actorRef.actorId)) {
                out.push(["X_PROFILE_AUTH", file, "profile requires proposer/confirmer separation of duties"]);
              }
              for (const req of rule.confirmation.requiredActors) {
                const matching = new Set(confirmations.filter((e) =>
                  e.actorRef.actorType === req.actorType && (req.role === undefined || e.actorRef.role === req.role)
                ).map((e) => e.actorRef.actorId));
                if (matching.size < req.count) {
                  out.push(["X_PROFILE_AUTH", file, `profile requires ${req.count} confirmation(s) from ${req.actorType}${req.role ? ` role ${req.role}` : ""}; found ${matching.size}`]);
                }
              }
            }
            for (const policyId of rule.requiredPolicyIds) {
              const policyRef = doc.policyRefs.find((p) => p.policyId === policyId && p.requiredFor.includes(last.to));
              if (!policyRef || policyRef.resultRefs.length === 0) {
                out.push(["X_PROFILE_POLICY", file, `required policy ${policyId} is not configured with a result for target ${last.to}`]);
                continue;
              }
              const resultId = policyRef.resultRefs[policyRef.resultRefs.length - 1];
              const result = byId.get(`policy_result/${resultId}`);
              if (!result) {
                out.push(["X_PROFILE_POLICY", file, `required policy result ${resultId} is not present in examples`]);
                continue;
              }
              if (!["pass", "not_applicable"].includes(result.result)) {
                out.push(["X_PROFILE_POLICY", file, `required policy ${policyId} has non-permitting result ${result.result}`]);
              }
              if (result.validUntil && Date.parse(result.validUntil) < Date.parse(last.transitionedAt)) {
                out.push(["X_PROFILE_POLICY", file, `required policy ${policyId} expired before the transition`]);
              }
              const validationCitesResult = causes.some((e) => e.eventType === "validation" && e.policyResultRefs.includes(resultId));
              if (!validationCitesResult) {
                out.push(["X_PROFILE_POLICY", file, `state transition does not cite a validation carrying required policy result ${resultId}`]);
              }
            }
          }
        }
      }
    }
    if (doc.recordType === "event") {
      // Causal order: an event cannot precede the events or policy results it relies on.
      for (const cause of doc.causedBy ?? []) {
        const prior = eventDocs.get(cause);
        if (prior && Date.parse(prior.timestamp) > Date.parse(doc.timestamp)) {
          out.push(["X_CAUSALITY", file, `causedBy event ${cause} is timestamped after this event`]);
        }
      }
      for (const ref of doc.policyResultRefs) {
        const result = byId.get(`policy_result/${ref}`);
        if (result && Date.parse(result.evaluatedAt) > Date.parse(doc.timestamp)) {
          out.push(["X_CAUSALITY", file, `policy result ${ref} was evaluated after this event`]);
        }
      }
    }
    if (doc.recordType === "event" && doc.eventType === "state_transition" && doc.subjectType === "workflow") {
      const wf = byId.get(`workflow/${doc.subjectId}`);
      const tr = wf?.transitions.find((t) => t.eventId === doc.eventId);
      if (wf && tr) {
        if (doc.confirmedStateRef.version !== tr.sequence) {
          out.push(["X_REFERENCE", file, `confirmedStateRef.version ${doc.confirmedStateRef.version} does not match transition sequence ${tr.sequence} in the workflow`]);
        }
        if (doc.confirmedStateRef.state !== undefined && doc.confirmedStateRef.state !== tr.to) {
          out.push(["X_REFERENCE", file, `confirmedStateRef.state ${doc.confirmedStateRef.state} does not match transition target ${tr.to}`]);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(process.argv[2] ?? path.join(here, ".."));
  const { errors, notes } = validateRepository(root);
  for (const n of notes) console.log(`- ${n}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR [${e.code}] ${e.file}: ${e.message}`);
    console.error(`\nValidation failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log("Validation passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
