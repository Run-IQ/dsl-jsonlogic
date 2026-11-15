# CLAUDE.md

Run-IQ is a generic decision engine: every decision comes with a verifiable proof.
This repository provides `@run-iq/dsl-jsonlogic`, its JSONLogic condition evaluator.
Read this file before working here, including in a new session. The owner's
principles and decisions below are binding.

## 1. Founding principle: correctness and fail-closed behaviour come first

They come before convenience, compatibility and dates. The reputation of Run-IQ depends on them.

1. **The engine never guesses.** It applies only what is declared explicitly: the data given, the caller's declarations (scope, completeness, how a fact is justified) and the pack's rules. Each declaration is recorded in the proof.
2. **Nothing passes silently.** A fault either fails what it touches, or marks it with an explicit status: a pending rule with its reason, an output with its status, a verdict with its problem. Never accepted: a hiding default, a swallowed error, or a quiet diagnostic under a result that looks certain.
3. **A fault stops at what it touches.** A faulty rule makes only its outputs pending. The whole evaluation is refused for an invalid input, a failing plugin, a tampered rule or a failed save.
4. **Only rules in force have an effect.** A beaten, skipped or pending rule imposes nothing. While it is unknown whether a rule is in force, its effect is pending too.
5. **A verifier never means "trust".** It says `authentic` only for what it checked, and it says what it did not check.

You apply this yourself, in every job. The machine audit is a second net, not the first.

## 2. Fail-closed checklist

Check every changed line for:

1. **Swallowed errors.** A `catch` that returns a default, `continue`s, or only logs, when the fault changes the result.
2. **Defaults that hide an absence.** `?? 0`, `?? ''`, `|| []`, `?? true` on data that should exist; an absent value read as `false`, `0` or "no constraint".
3. **Leniency on unknown things.** An unknown field, key, option, kind or reason accepted without a signal where it changes meaning. A misspelled name must fail and name the field.
4. **Coercion.** Truthiness instead of `=== true`; a string, `NaN`, `-0` or an unsafe integer passing as a number; `null` read as absence.
5. **The checked copy and the used copy are not the same.** Getters, Proxies, a value read several times, input rewritten after a check.
6. **Plugins.** Any hook failure, malformed return, invalid input, rule rewritten under the same `id@version`, rule dropped without a skip, or change to the decision in `afterEvaluate` makes the evaluation fail with `PluginHookError`.
7. **Verdicts too kind.** A verifier that returns `authentic` or `consistent` while it skipped a check, without a notice; `consistent` where `invalid` is warranted; a revocation or an unsupported kind not refused.
8. **Limits.** Every limit is enforced, never truncated or clamped silently, and is held by a test.
9. **Integrity and storage.** A checksum mismatch, a failed save, a proof that cannot be sealed: the evaluation fails, and no decision comes out without its stored proof.
10. **Tests that cannot fail.** Every safety rule has a test that fails when the rule is removed. Show it by a mutation check in the PR.

**Every PR body has a "Fail-closed" section.** It lists every place where the change refuses, fails or marks something, and confirms that items 1 to 10 were checked. A finding against this checklist is never "minor enough to leave".

Other rigour: write the test first and show it failing; exact assertions; one mutation check per behavioural change; replay the full CI at the lockfile versions on Node 20 before asking for an audit; CI green before "audit OK". Public text is in English, with no em dash and no arrows in prose, and never uses the old internal names of the product.

## 3. Loop protocol with the machine session

Lane C is the session assigned to this repository for job 1. Lanes A and B work
in parallel on their own assigned jobs. A lane is a session, not a repository:
each job names its repositories, and only the assigned lane works in a repository
until its job is merged. Work only in `dsl-jsonlogic` for this job.

The channel is [Run-IQ/.github#1](https://github.com/Run-IQ/.github/issues/1).
Read the issue from the beginning on entry, including all owner decisions, and
read its latest comments before each step and after every push. Post what you take,
what you pushed and what you expect from the machine session.

- **Branches.** One `cloud/<task>` branch per job, cut from `refonte/phase-2`.
  Pull requests target `refonte/phase-2`. Step 0 uses `cloud/claude-md-dsl`;
  Task 12 uses `cloud/12` only after the setup PR is audited and merged.
- **Comments.** Every comment starts with `Cloud session (lane C):`. Take only
  `Machine session (lane C)` jobs and `(all lanes)` instructions.
  `Machine session: DECISION` posts count as all lanes. Earlier core-lane tags map
  to lane A and spec-lane tags to lane B. Read their history for context and owner
  decisions; never answer, comment on or act on their jobs, audits or PRs.
- **Cross-lane dependencies.** The machine session coordinates them and decides
  merge order. Do not coordinate directly with another lane. If a change needs a
  repository outside the current job, post what is needed and wait for a ruling.
  A repository entered in a later job gets these instructions in its first PR.
- **Audit.** Open the PR, post `Cloud session (lane C): ready for audit <PR link>`,
  and wait. The audit is posted on that PR with a one-line lane-tagged notice on
  #1. Fix every finding, including Minor findings, in the same PR. Post
  `Cloud session (lane C): fixes pushed <PR link>` with one answer per finding.
- **Merge.** Wait for an explicit `Machine session (lane C): audit OK <your PR>`
  (or `Machine session: audit OK <your PR>`). A hold for dependent repositories
  still applies. Only with CI green on the audited head and the base unchanged,
  merge fast-forward: `git push origin cloud/<task>:refonte/phase-2`.
  Keep the commits, never squash. If the base moved, bring it into your branch
  without a force-push, replay CI and request another audit before merging.
  Then post `Cloud session (lane C): merged <sha>` and wait for the next job.
- **Waiting.** Do not end the session while waiting. Keep a background watch on
  #1 and your PR every 2 minutes for comments whose body starts with
  `Machine session`, then retain lane C, `(all lanes)` and `DECISION` messages.
  Matching only `Machine session:` misses tagged comments. Re-arm an expired
  watch. If the environment cannot keep a background watch, post your status at
  the end of every step; the owner will signal a waiting machine comment.
- **Owner questions.** For a product, licence or irreversible decision, any
  publish, tag or release, push to `master` or `main`, deletion of a repository or
  another lane's branch, or a budget choice, post
  `Cloud session (lane C): BLOCKED (owner decision) <why>` and wait.
  Technical ambiguities go to the machine session for a ruling.
- **Author identity.** Before the first commit check `git config user.name` and
  `git config user.email`: they must be `fless-lab` and
  `achilleatarmla@gmail.com`. The owner is the sole author and committer.
  Inspect outgoing commits before pushing. A commit with another author is
  never pushed. If one is made by mistake, stop and report it before pushing.
- **No footers.** No `Co-Authored-By`, signature line, footer or generated line in
  commits, PRs or comments. If a tool appends one, edit it away and check the
  saved text. Commit messages are short conventional messages.
- **Never.** No push to `master` or `main`, no package publication, no tags or
  releases, no repository creation, no force-push, no printing or storing tokens.
  Never change another lane's branch.

## 4. Repository checks and scope

Use Node 20 for the complete local CI replay, and Node 20 and 24 in CI:

```sh
# First perform the branch build/install/link setup from README (next.1 is unpublished).
npm run typecheck
npm run lint
npm exec --no -- prettier --check CLAUDE.md README.md .github/workflows/ci.yml
npm test
npm run build
```

Use the Prettier version installed by `npm ci` from `package-lock.json`, never a
separately installed formatter. Run `npm run test:heavy` last and alone whenever
the repository defines it; there is no heavy script at setup time. New behaviour
requires RED tests first, exact assertions and a mutation check for each safety
rule, followed by the complete CI replay and the PR's Fail-closed section.

Task 12 works standalone on `JsonLogicEvaluator`: `listVariables`, `compute`,
`evaluateTruth` and `capabilities`. Keep the `@run-iq/core` range unchanged and do
not add core integration tests. Task 12A handles integration after core's 9M1.
The full binding job and addenda are in the lane C job comment on #1.

## 5. Owner decisions

The founding principle and the ten-point checklist above are owner decisions of
2 November 2026. Historical decisions are retained with their scope; they do not
authorize work in another lane's repository or an early implementation of a later
task.

### Earlier decisions recorded by the machine session

The [Job 4b decision inventory](https://github.com/Run-IQ/.github/issues/1#issuecomment-6583350273)
and core's `CLAUDE.md` establish:

- Every hook failure fails the evaluation with `PluginHookError`, including a
  throw, timeout, malformed return, invalid input, non-JSON state or dropped rule
  without a skip. `onError` runs for every plugin; nothing is saved.
- A rule rewritten under the same `id@version` fails. A rule added by a hook has
  its checksum verified like a source rule. `afterEvaluate` cannot change the
  decision. Later plugin-boundary rulings on the assigned core PR govern its
  precise annotation contract; this DSL job does not implement hooks.
- Unknown `meta` keys and `evaluate` options are refused by name. Non-portable
  JSON input is refused with its pointer before any hook runs.
- From 9M1: `onChecksumMismatch` defaults to `throw`, and a rule whose
  `listVariables` fails is provisional rather than evaluated with unknown reads.
  From Task 10: a store failure fails the evaluation. From 9M2: a beaten carrier's
  exceptions have no effect. The code follows when those tasks land.
- Absent tags mean no tag filter (D-38, tested in 9Q). An input list is complete
  unless the caller declares otherwise. A fact without an assertion counts as
  determined. These are caller declarations recorded in the proof.
- Spec says what its verifier did not check. Unsupported or revocation
  attestations are invalid. Unknown rule fields are refused; extensions belong
  under `extensions`. Authored rule `null` is refused, including `effectiveUntil`
  and `checksum`; the canonical internal form retains `effectiveUntil: null` and
  unchanged checksums. These are spec's 9K5 decisions, not changes for this job.

### DECISION: owner identity, 2 November 2026

[Machine session: DECISION (lane A), commit 47efeaa](https://github.com/Run-IQ/.github/issues/1#issuecomment-6584955949).
That commit must not reach core's `refonte/phase-2`. Lane A rebuilds its commits
on a new `cloud/9l-v2` branch with author and committer
`fless-lab <achilleatarmla@gmail.com>`, unchanged messages and content, without
force-pushing. It opens a replacement PR, closes core#3 unmerged with a pointer,
and leaves `cloud/9l` unchanged and undeleted unless the owner asks. It proves the
rebuilt tree is identical and lists every outgoing author and committer. The
general rule applies here too: a commit with another author is never pushed; stop
and report a mistaken identity before pushing.

### DECISION: plugins and attackers, 2 November 2026

[Machine session: DECISION (all lanes)](https://github.com/Run-IQ/.github/issues/1#issuecomment-6588675839).
A plugin attack is handled, never left open. In one JavaScript realm, plugin code
cannot be isolated from other plugin code. The engine never runs unverified code
in its process. Phase 3 delivers:

1. **Fail-closed loading.** In-process execution requires a manifest signed by a
   trusted key and a matching code hash. The default trust list contains only the
   Run-IQ key; integrators add keys explicitly. Other plugins run in `sandbox`.
   Unsigned, altered or unknown plugins are refused with their reason, never
   silently moved.
2. **A real sandbox.** Out of process or in a separate isolate, with no network
   or disk, bounded time and memory, and only JSON crossing the 9L boundary.
3. **Captured intrinsics.** Core captures `JSON`, `Object.freeze`, `Reflect` and
   the other intrinsics at load time before any plugin can patch globals.
4. **Plugin identity in the proof.** Name, version, code hash, signing key and
   execution mode for every plugin that ran.
5. **Supply chain.** Locked and audited dependencies, provenance for published
   packages, signed releases and no dependency added without review.

These are phase 3 requirements; this setup PR does not claim to implement them.

### DECISION: pause after work in progress, 3 November 2026

[Machine session: DECISION (all lanes)](https://github.com/Run-IQ/.github/issues/1#issuecomment-6593013802).
Lane A finishes 9L (core#5) through audit OK and merge, then only the small core
follow-up to spec#4 (`job-core-followup-9k5`) so core CI stays green. Lane B finishes
9K5 (spec#4), merging only when the machine session says so after 9L. Both then take
no new job, keep their watch armed and wait for a machine comment to resume.
This pause was lifted on 15 November 2026 by the resume decision below.
This decision names lanes A and B. Lane C's later job 1 is explicitly assigned on
15 November 2026.

The [later audit pause](https://github.com/Run-IQ/.github/issues/1#issuecomment-6595478710)
paused machine audits until the owner resumed them. This audit pause was lifted
on 15 November 2026 by the resume decision below. An explicit audit OK is still
required before every merge.

### DECISION: loop resumed and lane C joins, 15 November 2026

[Machine session: DECISION (all lanes)](https://github.com/Run-IQ/.github/issues/1#issuecomment-6888518491).
The owner resumed the loop. ChatGPT/Codex joins as lane C for standalone Task 12
in `dsl-jsonlogic`. Audits resume and the pauses of 3 November are lifted. The
remaining merge order still holds: 9L, then spec#4, then lane A's core follow-up;
then the machine session posts the next jobs. Lanes A and B reread their repo's
`CLAUDE.md` and their PR if restarted, and receive their audits on their PRs.

## 6. Future decisions

Every owner decision posted by the machine session on #1 starts with
`Machine session: DECISION`. Read it and add it to this Owner decisions section
in the next PR of each affected repository. The audit checks that it is present.
