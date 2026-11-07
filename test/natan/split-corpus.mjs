// Writes the input of every tree-sitter corpus test in <corpus dir> to <out dir>/<file>-<n>.jcl.
//
//   node split-corpus.mjs <corpus dir> <out dir>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [corpusDir, outDir] = process.argv.slice(2);
let count = 0;
for (const file of readdirSync(corpusDir).filter((f) => f.endsWith(".txt"))) {
  const text = readFileSync(join(corpusDir, file), "utf8");
  // A test is: a line of '=', the name, a line of '=', the input, a line of '-', the expected tree.
  const tests = text.split(/^={3,}[^\n]*\n[^\n]*\n={3,}[^\n]*\n/m).slice(1);
  tests.forEach((test, i) => {
    const input = test.split(/^-{3,}[^\n]*$/m)[0].replace(/\n+$/, "\n");
    writeFileSync(join(outDir, `${basename(file, ".txt")}-${String(i + 1).padStart(2, "0")}.jcl`), input);
    count++;
  });
}
console.log(`split-corpus: wrote ${count} test inputs`);
