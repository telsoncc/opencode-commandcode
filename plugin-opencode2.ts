import commandcodePlugin from "./plugin.js";
import {
  COMMANDCODE_INTEGRATION_ID,
  applyIntegration,
  applyProviderInventory,
  loadCatalogForV2,
  type V2SetupContext,
} from "./src/opencode2.js";
import type { ModelEntry } from "./src/catalog.js";

/**
 * OpenCode 2.0 entrypoint (`@telsoncc/opencode-commandcode/server` and
 * `@telsoncc/opencode-commandcode/plugin/opencode2`).
 *
 * Models register in memory via `ctx.provider.transform` + `editor.add` +
 * `reload()` — nothing is written into `opencode.json`. Auth registers a
 * `commandcode` integration (API key via `/connect`, `COMMANDCODE_API_KEY`
 * env fallback).
 *
 * Dual export: `{ id, setup, server }`. OpenCode 2.0 loads this module and
 * calls `setup()`; OpenCode 1.18.29+ prefers `exports["./server"]` and calls
 * `server()`, which is the classic V1 plugin in `plugin.ts` (unchanged).
 * OpenCode <1.18.29 needs the pre-dual package version.
 *
 * Do not load this entrypoint together with the bare V1 `plugin.ts` shape in
 * the same host.
 */

export const id = "commandcode";

export async function setup(ctx: V2SetupContext): Promise<() => Promise<void>> {
  const registrations: Array<{ dispose: () => Promise<void> }> = [];

  // Credentials first so the provider inventory can bind to the connection.
  registrations.push(
    await ctx.integration.transform((draft) => {
      applyIntegration(draft);
    }),
  );

  const catalog = loadCatalogForV2();
  const inventory: ModelEntry[] = catalog.models;
  let sourceConnection: unknown;
  const refreshConnection = async (): Promise<void> => {
    try {
      sourceConnection = await ctx.integration.connection.active(COMMANDCODE_INTEGRATION_ID);
    } catch {
      sourceConnection = undefined;
    }
  };
  await refreshConnection();

  registrations.push(
    await ctx.provider.transform((editor) => {
      applyProviderInventory(editor, inventory, sourceConnection);
    }),
  );
  try {
    await ctx.provider.reload();
  } catch {
    // Keep the last-good inventory when the reload fails.
  }

  // Rebind the inventory when credentials switch; the transform closure reads
  // the current `inventory`/`sourceConnection` on every replay.
  let stopped = false;
  try {
    const stream = ctx.event?.subscribe();
    if (stream && typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
      void (async () => {
        for await (const event of stream as AsyncIterable<{ type?: unknown }>) {
          if (stopped) break;
          const type = event?.type;
          if (type === "credential.switched" || type === "credential.updated") {
            await refreshConnection();
            try {
              await ctx.provider.reload();
            } catch {
              // ignore reload failure; next replay retries
            }
          }
        }
      })().catch(() => {});
    }
  } catch {
    // The event stream is optional; inventory still works without it.
  }

  return async () => {
    stopped = true;
    for (const registration of registrations.reverse()) {
      try {
        await registration.dispose();
      } catch {
        // ignore disposal failure
      }
    }
  };
}

export const server = commandcodePlugin;

export default { id, setup, server };
