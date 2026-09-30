/**
 * Export the locked Stage 5 arena into Stage 6 data.
 * Does not modify Stage 5 strings or labels.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { buildStage5Examples } from "../stage5/examples";

const examples = buildStage5Examples();
const outDir = join(process.cwd(), "benchmarks/semantic/stage6/data");
mkdirSync(outDir, { recursive: true });
const payload = {
  source: "benchmarks/semantic/stage5/examples.ts buildStage5Examples()",
  n: examples.length,
  examples,
};
writeFileSync(join(outDir, "locked-test.json"), JSON.stringify(payload));
if (examples.length !== 189) {
  throw new Error(`expected 189 locked pairs, got ${examples.length}`);
}
console.log(`locked ${examples.length}`);
