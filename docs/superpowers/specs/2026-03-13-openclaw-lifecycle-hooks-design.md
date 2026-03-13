# Design: OpenClaw Lifecycle Hooks for context-mode

**Date:** 2026-03-13
**Branch:** copilot/add-openclaw-plugin
**File:** `src/openclaw-plugin.ts`

## Problem

The plugin currently:
- Creates a session keyed to a local `randomUUID()` — not OpenClaw's own session ID
- Never flushes events before compaction, so the snapshot may be stale when OpenClaw compacts
- Never injects a resume snapshot into the system context when a session resumes
- Calls `db.incrementCompactCount()` only inside the context engine's `compact()`, not in response to OpenClaw-triggered compactions

## Solution

Add four lifecycle hooks using `api.on()`. All hook names are confirmed from OpenClaw source (`tts-core-y4rdRVZv.js`, `discord-BGqJ05Bl.js`).

---

## Hook API Constraints (from source)

| Hook | Runner | Return value used? |
|------|--------|--------------------|
| `session_start` | `runVoidHook` | No — void |
| `before_compaction` | `runVoidHook` | No — void |
| `after_compaction` | `runVoidHook` | No — void |
| `before_prompt_build` | `runModifyingHook` | Yes — `{ prependSystemContext?, appendSystemContext? }` |

`session:loaded` does **not** exist. Resume injection must go through `before_prompt_build`.

---

## Hook Designs

### 1. `session_start`

**Purpose:** Re-key the DB session to OpenClaw's own session ID.

**When called:** Once per session, before any prompt is built.

**Event shape:** `{ sessionId?: string; agentId?: string; startedAt?: string }` (inferred from source).

**Behavior:**
- Extract `event.sessionId` if present
- If it differs from the local `randomUUID()` session, call `db.ensureSession(openclawSessionId, projectDir)` and update the local `sessionId` variable
- Fall back to the existing UUID if event has no `sessionId`
- Side-effect only (void)

---

### 2. `before_compaction`

**Purpose:** Flush buffered events into a resume snapshot before OpenClaw discards context.

**When called:** Immediately before OpenClaw compacts the conversation.

**Behavior:**
- Call `db.getEvents(sessionId)`
- If events exist, call `db.getSessionStats(sessionId)` fresh (do NOT use a stale module-level cached value), then `buildResumeSnapshot(events, { compactCount: (freshStats?.compact_count ?? 0) + 1 })`
- Call `db.upsertResume(sessionId, snapshot, events.length)`
- Side-effect only (void)
- Mirrors the existing `compact()` method in the context engine, ensuring both paths produce a snapshot

---

### 3. `after_compaction`

**Purpose:** Increment the compact counter after OpenClaw-triggered compaction.

**When called:** After OpenClaw finishes compacting.

**Behavior:**
- Call `db.incrementCompactCount(sessionId)`
- Side-effect only (void)

---

### 4. `before_prompt_build` (resume injection)

**Purpose:** Inject stored resume snapshot into the system context when the session has one.

**When called:** Before every LLM prompt is assembled.

**Behavior:**
- Load resume from `db.getResume(sessionId)`
- Call `db.getSessionStats(sessionId)` fresh to get current `compact_count` (do NOT rely on a stale closure)
- If resume exists and `compact_count > 0`, return `{ prependSystemContext: formattedSnapshot }`
- If resume is null or `compact_count === 0`, return `undefined` (no injection)
- Guard: only inject once per session restart using a `resumeInjected` flag (set to `true` after first injection, reset to `false` in `session_start` hook)
- Priority: `10`

**Priority ordering note:** OpenClaw's `runModifyingHook` sorts handlers by descending priority (`toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0))`), so **higher number = runs first**. Resume snapshot at priority 10 is prepended before routing instructions at priority 5 are appended — the combined system context is: `[resume snapshot] ... [model prompt] ... [routing instructions]`.

**Note:** The existing `before_prompt_build` registration for routing instructions uses `api.on()` at priority 5 and only fires if `routingInstructions` is non-empty. The resume hook is always registered at priority 10.

---

## Implementation Notes

- All four hooks use `api.on(hookName, handler, { priority? })` — NOT `api.registerHook()`
- `registerHook` is the old string-keyed API; `api.on` uses the typed `pluginHookNameSet`
- `session_start` is void — update `sessionId` via closure mutation (the variable is `let`)
- `resumeInjected` flag prevents injecting the same snapshot on every turn
- All handlers wrapped in `try/catch` — lifecycle hooks must never break the gateway

---

## Changes to `src/openclaw-plugin.ts`

1. Change `const sessionId = randomUUID()` → `let sessionId = randomUUID()`
2. Add `let resumeInjected = false` flag
3. Add `session_start` hook via `api.on()`
4. Add `before_compaction` hook via `api.on()`
5. Add `after_compaction` hook via `api.on()`
6. Add resume-injection `before_prompt_build` hook via `api.on()` at priority 10
7. Update `OpenClawPluginApi` interface: the `on()` method must accept the four new hook name literals: `"session_start"`, `"before_compaction"`, `"after_compaction"`, `"before_prompt_build"` (the last one already registered for routing, but ensure the signature matches)
8. Update `HOOKS` list in file-level comment

No new files. No new DB methods needed (all methods already exist).

---

## Out of Scope

- `session_end` hook — no DB cleanup needed (cleanup happens on `command:new` already)
- `llm_input` / `llm_output` — no value for current use case
- `gateway_start` — no per-gateway state needed
- `before_agent_start` — overlaps with `before_prompt_build`, not needed
