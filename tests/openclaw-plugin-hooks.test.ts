import { strict as assert } from "node:assert";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, test, vi } from "vitest";
import { SessionDB } from "../src/session/db.js";

// ── Helpers ──────────────────────────────────────────────

const cleanups: Array<() => void> = [];

afterAll(() => {
  for (const fn of cleanups) {
    try { fn(); } catch { /* ignore */ }
  }
});

function createTestDB(): SessionDB {
  const dbPath = join(tmpdir(), `plugin-hooks-test-${randomUUID()}.db`);
  const db = new SessionDB({ dbPath });
  cleanups.push(() => db.cleanup());
  return db;
}

// ── Mock API ─────────────────────────────────────────────

interface RegisteredHook {
  hookName: string;
  handler: (...args: unknown[]) => unknown;
  opts?: { priority?: number };
}

function createMockApi() {
  const hooks: RegisteredHook[] = [];
  const typedHooks: RegisteredHook[] = [];

  const api = {
    registerHook(event: string, handler: (...args: unknown[]) => unknown, _meta: unknown) {
      hooks.push({ hookName: event, handler });
    },
    on(hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) {
      typedHooks.push({ hookName, handler, opts });
    },
    registerContextEngine(_id: string, _factory: () => unknown) {},
    registerCommand(_cmd: unknown) {},
  };

  return { api, hooks, typedHooks };
}

// ── Plugin shape test ────────────────────────────────────

describe("Plugin exports", () => {
  beforeEach(() => { vi.resetModules(); });

  test("plugin exports id, name, configSchema, register", async () => {
    const { default: plugin } = await import("../src/openclaw-plugin.js");
    assert.equal(plugin.id, "context-mode");
    assert.equal(plugin.name, "Context Mode");
    assert.ok(plugin.configSchema);
    assert.equal(typeof plugin.register, "function");
  });
});
