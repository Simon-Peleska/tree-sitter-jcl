#!/usr/bin/env bash
# Compares this grammar with natan-sysview/tree-sitter-jcl on that grammar's
# test corpus and examples.
#
#   nix develop -c test/natan/run.sh [--update]
#
# Fetches natan-sysview/tree-sitter-jcl at a pinned commit into
# test/natan/.work, writes every corpus test input to its own file, records
# that grammar's accept/reject verdict per file and hands both parsers'
# verdicts to ../compare.mjs, which checks them against baseline.tsv.
set -euo pipefail

NATAN_COMMIT=e27eab82e51845d78cd8b6e0b4d29480cde00891
here=$(cd "$(dirname "$0")" && pwd)
work=$here/.work
natan=$work/natan
texts=$work/texts

if [ "$(git -C "$natan" rev-parse HEAD 2>/dev/null || true)" != "$NATAN_COMMIT" ]; then
	echo "run: fetching natan-sysview/tree-sitter-jcl $NATAN_COMMIT"
	mkdir -p "$natan"
	git -C "$natan" init -q
	git -C "$natan" remote add origin https://github.com/natan-sysview/tree-sitter-jcl.git 2>/dev/null || true
	git -C "$natan" fetch -q --depth 1 origin "$NATAN_COMMIT"
	git -C "$natan" checkout -q FETCH_HEAD
fi

rm -rf "$texts"
mkdir -p "$texts"
node "$here/split-corpus.mjs" "$natan/test/corpus" "$texts"
cp "$natan"/examples/*.jcl "$texts/"
ls "$texts"/*.jcl >"$work/paths.txt"

# tree-sitter exits 1 when any file has a parse error; that's an expected outcome here.
# natan's grammar is also named jcl; its own library dir keeps it out of
# the cache this grammar is built into.
(TREE_SITTER_LIBDIR="$work/lib" tree-sitter parse --grammar-path "$natan" --quiet --json-summary --paths "$work/paths.txt" || true) >"$work/natan-summary.txt"
node -e '
const fs = require("fs");
const output = fs.readFileSync(process.argv[1], "utf8");
const summary = JSON.parse(output.slice(output.search(/^\{$/m)));
for (const s of summary.parse_summaries) console.log(`${s.file}\t${s.successful ? "ok" : "error"}\t`);
' "$work/natan-summary.txt" >"$work/natan-verdicts.tsv"

node "$here/../compare.mjs" "$work/natan-verdicts.tsv" "$here/baseline.tsv" "$@"
