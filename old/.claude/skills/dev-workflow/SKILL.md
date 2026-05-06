---
name: dev-workflow
description: Launches a full Superpowers development workflow from `/dev`. Use when the user wants one guided entry point to go from idea to implementation, verification, review, and branch completion while relying on native Superpowers skills.
---

# Dev Workflow

## Overview

`/dev` is a lightweight launcher for native Superpowers workflow.

It does not replace `brainstorming`, `writing-plans`, `test-driven-development`, `subagent-driven-development`, `verification-before-completion`, `requesting-code-review`, or `finishing-a-development-branch`.

Use `/dev` to:
- start a full-cycle development workflow from one command
- load `AGENTS.md` once as shared project context
- keep minimal phase state for resume
- hand off each phase to the correct native Superpowers skill

Do not use `/dev` when:
- the user only wants one phase, such as planning, debugging, review, or finish
- the task is too small to justify a full workflow
- the user already explicitly chose a specific native Superpowers skill

## Trigger

- **Command**: `/dev`
- **Usage**: `/dev <任务描述>`

If no description is provided, ask:
> 你想启动哪项开发任务？请描述目标或需求。

## Core Principle

`/dev` is a starter and coordinator, not a second implementation framework.

It owns:
1. start or resume
2. workspace setup
3. `AGENTS.md` loading
4. phase ordering
5. minimal state tracking
6. phase gates

It does **not** own:
- project-specific preferences beyond `AGENTS.md`
- custom TDD labels, templates, or execution rules
- custom review loops already covered by native Superpowers workflows
- extra verification standards beyond `AGENTS.md`, the approved plan, and the delegated skill

## Context Source

`AGENTS.md` is the single source of project preferences and constraints for `/dev`.

Phase 0 reads `AGENTS.md` and carries it forward as shared context for later phases.

If `AGENTS.md` is missing, pause and ask whether to:
1. create or update it first
2. continue with generic Superpowers defaults

Do not recreate project rules inside `/dev`.

## Phase Model

- Phase 0: Init
- Phase 1: Brainstorm
- Phase 2: Plan
- Phase 3: Execute
- Phase 4: Verify
- Phase 5: Review
- Phase 6: Finish

Each phase has four parts:
- purpose
- delegated native skill
- recorded output
- exit gate

## State Tracking

Use `TodoWrite` with only these items:

```
[/dev] Meta             — feature, branch, worktree_path, agents_md_path, design_doc_path, plan_path, execution_mode
[/dev] Phase 0: Init
[/dev] Phase 1: Brainstorm
[/dev] Phase 2: Plan
[/dev] Phase 3: Execute
[/dev] Phase 4: Verify
[/dev] Phase 5: Review
[/dev] Phase 6: Finish
```

Rules:
- enter a phase → set that phase to `in_progress`
- pass the gate → set that phase to `completed`
- need changes → keep that phase `in_progress`
- update `[/dev] Meta` only when a path or execution choice becomes known

Do not create nested step-level Todo items.

## Resume

On `/dev` invocation:
- if no `[/dev]` items exist, start fresh
- if `[/dev]` items exist, use `AskQuestion` to ask whether to:
  - continue the current pipeline
  - restart from scratch

If restarting, clear existing `[/dev]` items before creating a new pipeline.

If resuming, continue from the first incomplete phase and reuse the saved metadata.

## Gate Protocol

At the end of each phase, use `AskQuestion` with these options:
- `continue` — `通过，进入下一阶段`
- `revise` — `不通过，返回当前阶段调整`
- `continue_with_notes` — `通过，但补充说明后继续`

Use notes only as extra context for the same workflow. Do not add phase-specific side rules.

Suggested prompt:

```
Phase N 已完成。

请选择下一步：
- 通过，进入下一阶段
- 不通过，返回当前阶段调整
- 通过，但补充说明后继续
```

## Status Banner

Render a compact banner from the phase states:

```
/dev Pipeline
[✅] Init
[✅] Brainstorm
[▶️] Plan
[ ] Execute
[ ] Verify
[ ] Review
[ ] Finish
Feature: <name>
```

## Path Conventions

Align with native Superpowers defaults:
- design docs: `docs/plans/YYYY-MM-DD-<topic>-design.md`
- implementation plans: `docs/plans/YYYY-MM-DD-<feature-name>.md`

Record the actual generated paths in `[/dev] Meta`.

Do not hardcode alternate directories.

## Phase Details

### Phase 0: Init

**Purpose**: Prepare the working context for the full workflow.

**Native skill**: `superpowers:using-git-worktrees` when isolated workspace is appropriate.

**Actions**:
1. Parse the task description.
2. Decide whether this workflow should resume or start fresh.
3. If feature work should be isolated, invoke `superpowers:using-git-worktrees`.
4. Read `AGENTS.md`.
5. Record `worktree_path` and `agents_md_path` in `[/dev] Meta`.

**Rules**:
- If the user is already in the correct branch or workspace and wants to stay there, do not force a new worktree.
- If `AGENTS.md` exists, read it as-is. `/dev` does not redefine its contents.

**Exit criteria**:
- active workspace is known
- project context source is known

### Phase 1: Brainstorm

**Native skill**: `superpowers:brainstorming`

**Actions**:
1. Pass the task description and `AGENTS.md` context into `brainstorming`.
2. Let the native skill handle clarification, trade-offs, and design approval.
3. Record the design doc path when the approved design is written.

**Rules**:
- Do not add an extra design methodology on top of `brainstorming`.
- If the native flow naturally reaches its handoff point toward planning, treat that as the end of Phase 1.

**Exit criteria**:
- the design is approved
- `design_doc_path` is recorded

### Phase 2: Plan

**Native skill**: `superpowers:writing-plans`

**Actions**:
1. Pass `AGENTS.md` and the approved design into `writing-plans`.
2. Let the native skill produce the implementation plan at its standard path.
3. Record `plan_path`.
4. Record the chosen execution mode:
   - same session → `subagent-driven-development`
   - separate session → `executing-plans`

**Rules**:
- Do not add a second TDD taxonomy.
- Do not require extra task templates beyond what `writing-plans` already defines.
- If Phase 1 already transitioned directly into `writing-plans`, do not invoke planning twice. Capture the resulting plan and continue.

**Exit criteria**:
- implementation plan exists
- execution mode is known

### Phase 3: Execute

**Native skill**:
- `superpowers:subagent-driven-development` for same-session execution
- `superpowers:executing-plans` for separate-session execution

**Actions**:
1. Choose the execution path recorded in Phase 2.
2. Pass the plan path, `AGENTS.md`, and workspace context into the selected workflow.
3. Let the native execution workflow drive implementation.

**Rules**:
- TDD behavior belongs to the native execution path and `superpowers:test-driven-development`.
- `/dev` must not define a second set of test-first rules, labels, or prompts.
- If the user chose `executing-plans` in a separate session, `/dev` pauses after handoff and resumes later at the first incomplete phase.

**Exit criteria**:
- selected execution workflow has completed its implementation scope

### Phase 4: Verify

**Native skill**: `superpowers:verification-before-completion`

**Actions**:
1. Identify the full verification commands from the plan and `AGENTS.md`.
2. Run fresh verification before making any completion claim.
3. Re-check the approved design and plan if needed.
4. Record the evidence summary.

**Rules**:
- Evidence before claims.
- Do not trust implementation reports without fresh verification.

**Exit criteria**:
- verification evidence exists and supports the claimed status

### Phase 5: Review

**Native skill**: `superpowers:requesting-code-review`

**Actions**:
1. Request final review for the completed change set when needed.
2. Use the correct change range or SHAs for the review target.
3. If review finds issues, route fixes back through the appropriate development workflow, then re-run Phase 4 before re-entering review.

**Rules**:
- Do not duplicate per-task review loops already provided by `subagent-driven-development`.
- Use this phase as the final review gate for the overall change when that gate is still needed.

**Exit criteria**:
- required review gate is satisfied

### Phase 6: Finish

**Native skill**: `superpowers:finishing-a-development-branch`

**Actions**:
1. Enter only after verification and required review are complete.
2. Invoke the native finish workflow.
3. Use its standard integration options and cleanup behavior.
4. Record the user's chosen outcome.

**Rules**:
- Do not invent a second finish flow.
- Let the native skill own the merge, PR, keep, or discard decision.

**Exit criteria**:
- the user-selected branch outcome is complete

## Failure Handling

If a delegated phase hits a bug, failing test, broken build, or unexpected behavior:
1. invoke `superpowers:systematic-debugging`
2. resolve the issue with evidence
3. resume the same phase

Do not skip verification or review because an earlier workflow reported success.

## Direct Invocation Guidance

Prefer direct native skills when the user explicitly wants a single stage:
- design only → `superpowers:brainstorming`
- plan only → `superpowers:writing-plans`
- execute an existing plan here → `superpowers:subagent-driven-development`
- execute an existing plan elsewhere → `superpowers:executing-plans`
- verify only → `superpowers:verification-before-completion`
- review only → `superpowers:requesting-code-review`
- finish only → `superpowers:finishing-a-development-branch`

Use `/dev` when the user wants one guided entry point for the full lifecycle.

## Quick Reference

| Phase | Native skill | Recorded output |
|-------|--------------|-----------------|
| 0. Init | `using-git-worktrees` | `worktree_path`, `agents_md_path` |
| 1. Brainstorm | `brainstorming` | `design_doc_path` |
| 2. Plan | `writing-plans` | `plan_path`, `execution_mode` |
| 3. Execute | `subagent-driven-development` or `executing-plans` | implementation changes |
| 4. Verify | `verification-before-completion` | verification evidence |
| 5. Review | `requesting-code-review` | final review outcome |
| 6. Finish | `finishing-a-development-branch` | merge / PR / keep / discard outcome |

## Example Usage

```text
/dev 给项目添加用户认证功能
/dev 重构数据库访问层
/dev 实现新的开放 API 并完成交付
```
