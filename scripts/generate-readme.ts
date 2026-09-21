import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const MODELS_JSON = join(ROOT, "models.json");

const models: unknown[] = JSON.parse(readFileSync(MODELS_JSON, "utf-8"));
const withEfforts = models.filter((m: any) => m.reasoningEfforts?.length > 0).length;

console.log(`models.json: ${models.length} models (${withEfforts} with reasoning efforts)`);
console.log("The README no longer contains a model table — check models.json directly.");
