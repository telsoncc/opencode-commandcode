export function catalogBreakTitle(commandCodeVersion: string): string {
  const version = commandCodeVersion.trim().replace(/^v/, "");
  return `[catalog-break] command-code@${version} — model extraction failed`;
}

export function renderCatalogBreakBody(input: {
  commandCodeVersion: string;
  error: string;
  workflowUrl: string;
  bundledCommandCodeVersion: string | null;
}): string {
  const bundled = input.bundledCommandCodeVersion ?? "(none)";
  return `Model catalog extraction failed for \`command-code@${input.commandCodeVersion}\`.

## Error

\`\`\`
${input.error}
\`\`\`

## Workflow

${input.workflowUrl}

## Still serving

Bundled catalog is still \`command-code@${bundled}\`. No npm release was published.

## Manual fix

- [ ] Check extraction anchors in \`src/catalog.ts\`
- [ ] Add/adjust unit fixtures under \`tests/fixtures/command-code/\`
- [ ] Re-run **Catalog sync** with \`force=true\`
`;
}

export function catalogBreakResolvedComment(input: { commit: string; tag: string }): string {
  return `Catalog sync recovered. Fix commit: \`${input.commit}\`. Release: \`${input.tag}\`.`;
}

export const CATALOG_BREAK_LABEL = "catalog-break";
