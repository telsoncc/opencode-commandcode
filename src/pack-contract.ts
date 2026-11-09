/**
 * Contract between `package.json` and the files a `npm pack` tarball actually
 * ships. The published entrypoints point at compiled output (`dist/`), so a
 * pack that skips the build — or a `files` list that drops `dist/` — produces
 * a package whose imports fail at runtime on hosts without a TypeScript
 * loader (the opencode IDE server runs plain Node inside Electron).
 */

export type PackPackageJson = {
  main?: string;
  types?: string;
  exports?: Record<string, string | { import?: string; types?: string }>;
};

/** Normalize `tar -tzf` output, which uses CRLF on Windows and LF on Linux. */
export function parseTarListing(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""));
}

/**
 * Every file `package.json` promises to resolve, relative to the package root.
 * `main` and each `exports` target are included so a build regression cannot
 * ship silently.
 */
export function declaredEntrypoints(pkg: PackPackageJson): string[] {
  const targets: string[] = [];
  const push = (value: string | undefined): void => {
    if (typeof value !== "string") return;
    targets.push(value.replace(/^\.\//, ""));
  };

  push(pkg.main);
  for (const entry of Object.values(pkg.exports ?? {})) {
    if (typeof entry === "string") {
      push(entry);
      continue;
    }
    push(entry.import);
    push(entry.types);
  }
  return [...new Set(targets)];
}

/** Entrypoints declared by `package.json` but absent from the tarball. */
export function missingEntrypoints(packageJson: PackPackageJson, packed: string[]): string[] {
  const present = new Set(packed);
  return declaredEntrypoints(packageJson).filter((entry) => !present.has(entry));
}
