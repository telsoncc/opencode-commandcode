const UNRELEASED = /^## \[Unreleased\]\s*$/;
const VERSION = /^## \[/;

export function cutKeepAChangelog(markdown: string, version: string, date: string): string {
  if (new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m").test(markdown)) return markdown;

  const lines = markdown.split(/(?<=\n)/);
  let start: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && UNRELEASED.test(line.replace(/\n$/, ""))) {
      start = i;
      break;
    }
  }
  if (start === null) throw new Error("CHANGELOG.md has no ## [Unreleased] heading");

  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line === undefined) continue;
    const stripped = line.replace(/\n$/, "");
    if (VERSION.test(stripped) && !UNRELEASED.test(stripped)) {
      end = j;
      break;
    }
  }

  const before = lines.slice(0, start + 1).join("");
  const body = lines
    .slice(start + 1, end)
    .join("")
    .replace(/^\n+/, "\n");
  const after = lines.slice(end).join("");
  return `${before}\n## [${version}] - ${date}\n${body}${after}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
