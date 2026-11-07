#!/usr/bin/env bash
# Compares this grammar with mapa's ANTLR JCL parser on mapa's JCL test data.
#
#   nix develop -c test/mapa/run.sh [--update]
#
# Fetches mapa at a pinned commit into test/mapa/.work, builds its parser,
# records its accept/reject verdict per file and hands both parsers' verdicts
# to compare.mjs, which checks them against test/mapa/baseline.tsv.
set -euo pipefail

MAPA_COMMIT=6ebe2d4059f5b9b908341fea7c286856f4b544af
here=$(cd "$(dirname "$0")" && pwd)
work=$here/.work
mapa=$work/mapa
build=$work/build

if [ "$(git -C "$mapa" rev-parse HEAD 2>/dev/null || true)" != "$MAPA_COMMIT" ]; then
	echo "run: fetching mapa $MAPA_COMMIT"
	mkdir -p "$mapa"
	git -C "$mapa" init -q
	git -C "$mapa" remote add origin https://github.com/cschneid-the-elder/mapa.git 2>/dev/null || true
	git -C "$mapa" sparse-checkout set jcl db2z
	git -C "$mapa" fetch -q --depth 1 origin "$MAPA_COMMIT"
	git -C "$mapa" checkout -q FETCH_HEAD
fi

antlr_jar=$(dirname "$(readlink -f "$(command -v antlr4)")")/../share/java/antlr-4.13.2-complete.jar
if [ ! -f "$build/classes/Verdicts.class" ] || [ "$here/Verdicts.java" -nt "$build/classes/Verdicts.class" ]; then
	echo "run: building mapa's JCL parser"
	mkdir -p "$build"
	cp "$mapa/jcl/src/JCLLexer.g4" "$mapa/jcl/src/JCLParser.g4" "$build/"
	(cd "$build" && java -jar "$antlr_jar" JCLLexer.g4 && java -jar "$antlr_jar" JCLParser.g4)
	javac -nowarn -cp "$antlr_jar" -d "$build/classes" "$build"/*.java "$here/Verdicts.java"
fi

ls "$mapa"/jcl/testdata/*.jcl >"$work/paths.txt"
echo "run: mapa parses $(wc -l <"$work/paths.txt") files (takes about a minute)"
java -cp "$antlr_jar:$build/classes" Verdicts "$work/paths.txt" >"$work/mapa-verdicts.tsv"

node "$here/../compare.mjs" "$work/mapa-verdicts.tsv" "$here/baseline.tsv" "$@"
