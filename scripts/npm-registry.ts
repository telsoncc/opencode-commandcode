export async function npmPackageVersions(name: string): Promise<string[]> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${name}`);
  const body = (await res.json()) as { versions?: Record<string, unknown> };
  return Object.keys(body.versions ?? {});
}

export async function npmLatestVersion(name: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${name}@latest`);
  const body = (await res.json()) as { version: string };
  return body.version;
}

export function npmTokenSet(): boolean {
  return Boolean(process.env.NPM_TOKEN?.trim() || process.env.NODE_AUTH_TOKEN?.trim());
}
