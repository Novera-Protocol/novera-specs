# Security Policy

## Status

This repository is a **pre-production design specification**. It contains JSON Schemas, synthetic examples, documentation and a schema validator. It contains no deployed service, no smart contract and no production data. No production Novera network is live.

This repository has **not** been security audited. The [initial threat model](security/threat-model.md) is a design aid, not an audit.

## Reporting a vulnerability

**A formal security disclosure contact for Novera Protocol is being established.** Until it is published here, there is no dedicated, monitored security mailbox, and none should be assumed.

In the meantime:

1. **Do not** disclose vulnerability details in a public issue, pull request, discussion or commit.
2. If you need to report a suspected issue, open a public issue titled `Security contact request` that contains **no technical details**. A maintainer will arrange a private channel.
3. When a private channel is available, include the affected file or section, a description of the issue, its potential impact and, if possible, a suggested correction.

This policy will be updated when a formal disclosure contact, such as GitHub private vulnerability reporting or a monitored mailbox, is in place.

## Scope

In scope:

- flaws in the specification that would let a conforming implementation accept unauthorized state transitions, bypass the event authority rules or misrepresent authoritative state;
- schema constraints that fail to enforce a stated requirement;
- validator defects that cause invalid schemas or examples to pass;
- weaknesses in the CI workflow or its dependencies.

Out of scope, because they do not exist in this repository:

- deployed services, APIs, networks, smart contracts or tokens;
- third-party systems referenced by the specification.

## Supported versions

| Version | Status |
| --- | --- |
| 0.1 (this branch) | Pre-production design specification. Corrections are made in place. |

## Handling of sensitive data

This repository MUST NOT contain secrets, credentials, private keys, real personal data or real identity documents. All examples are synthetic. If you find sensitive data in this repository, report it using the process above, without repeating the data.
