# OpenCode 2.x

Dedicated entrypoint: `@telsoncc/opencode-commandcode/plugin/opencode2`.
`exports["./server"]` serves the same module. Do **not** also load the classic
V1 `plugin.ts` shape in the same host.

Requires OpenCode **2.x**, or OpenCode **1.18.29+** (object entrypoints) via
`./server`. Older 1.x needs the pre-dual package version.

## How models register

The bundled catalog (`models.json`, 71 models) is published **in memory**
through `ctx.provider.transform` → `editor.add({ info, models })` →
`ctx.provider.reload()`. The plugin does **not** write a model list into
`opencode.json`. Auth registers a `commandcode` integration: API key via
`/connect`, `COMMANDCODE_API_KEY` env fallback (picked up automatically).

The provider uses the native `openai-compatible` runtime against
`https://api.commandcode.ai/provider/v1`. No extra env vars are required.

Synced models set `time.released` to `0` (the catalog carries no release
dates). The picker sorts by `released` descending, so filter by provider
**Command Code** if the global list looks empty.

## From npm

```jsonc
{
  "plugins": ["@telsoncc/opencode-commandcode/plugin/opencode2"],
}
```

Pin a version by inserting `@<version>` before `/plugin/opencode2`.
The legacy V1 `plugin` key keeps working through V2's V1-compat
normalization, but prefer the native `plugins` form above.

## Safe transition (from a hand-written provider block)

If you previously pointed OpenCode at the Provider API yourself — a
`provider.commandcode` (V1) or `providers.commandcode` block, especially one
with models dumped by `bun run sync -- --update-global` — remove it. It is a
second writer and fights the plugin-owned in-memory inventory.

1. Back up config:
   `cp ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.bak`
2. Delete the entire `"commandcode"` object under `"provider"`/`"providers"`.
   If `"providers"` is then empty, delete it too. **Keep** the `plugins`
   entry, `model` selection, MCP, permissions, and anything else you added.
3. Restart OpenCode (`opencode service restart`) so the plugin re-registers.
4. Run `/connect` → **Command Code** if credentials are missing, then
   `/models` filtered by provider **Command Code**.

`bun run sync -- --update-global` stays 1.x-only; it never touches 2.x.

## From a local clone

OpenCode 2.x rejects bare `.ts`/`.js` file paths in `plugins` — it must be a
**package directory** with `package.json`. Re-export the entrypoint:

```bash
mkdir -p "$OPENCODE_CONFIG_DIR/plugins/commandcode"
cat > "$OPENCODE_CONFIG_DIR/plugins/commandcode/package.json" <<'EOF'
{ "name": "commandcode-local", "type": "module", "main": "./index.ts" }
EOF
cat > "$OPENCODE_CONFIG_DIR/plugins/commandcode/index.ts" <<'EOF'
export { default } from "/absolute/path/to/opencode-commandcode/plugin-opencode2.ts";
EOF
```

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-commandcode"],
}
```

or point at the `$OPENCODE_CONFIG_DIR/plugins/commandcode` directory itself.
Keep the clone's dependencies installed and restart the service after changes.
Unpublished local paths never receive CI catalog patches — prefer npm.

## Optional local CLI override

Maintainers only. The 2.x entrypoint honors the same override as V1: it
scrapes a local `command-code` install when `COMMANDCODE_PACKAGE_PATH` or
`commandCodePackagePath` in `~/.config/opencode/opencode-commandcode.json` is
set. Restart OpenCode after setting it. Only point it at a `command-code`
install you trust: the extractor evaluates minified bundle spans from that
package, so an untrusted source would run code during the scrape.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| No Command Code models in the picker | `/connect` → **Command Code** (or set `COMMANDCODE_API_KEY`). Filter by provider **Command Code** (`time.released` is `0`). Remove leftover `provider(s).commandcode` blocks (see above). Restart the service. |
| `configured plugin path must be a directory` | Load a package directory, not the `.ts` file (see local clone). |
| `startup.json` / cache inspection | `~/.local/state/opencode/commandcode-provider/` (`COMMANDCODE_PROVIDER_STATE_DIR` overrides). `catalogSource`, `modelCount`, `degraded` mirror the V1 hook. |
| Still on OpenCode 1.x | Use the classic `plugin` + `provider` recipe in the README instead. |
