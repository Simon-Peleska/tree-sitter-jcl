# tree-sitter-jcl

A [tree-sitter](https://tree-sitter.github.io/) grammar for z/OS JCL, written
for the jobs of an IMS / MVS shop. It aims at structure (statements, names,
operations and parameters) rather than at validating every keyword value, so
editors and code-graph tools can read real-world JCL without choking on it.
The corpus tests follow the examples of the z/OS 3.1 MVS JCL Reference.

## What it parses

- `JOB`, `EXEC`, `DD`, `PROC`/`PEND`, `SET`, `JCLLIB`, `INCLUDE`, `OUTPUT`,
  `IF`/`THEN`/`ELSE`/`ENDIF`, `CNTL`/`ENDCNTL`, `EXPORT`, `SCHEDULE`, `XMIT`,
  `COMMAND` and `NOTIFY` each get their own node (`exec_statement`, ...).
- JES2 execution control: `JOBGROUP`/`ENDGROUP`, `GJOB`, `SJOB`,
  `JOBSET`/`ENDSET`, `BEFORE`, `AFTER` and `CONCURRENT`. Their `WHEN=` and
  `ERROR=` values are `condition` nodes, which may contain blanks and nested
  parentheses (`WHEN=((RC EQ 4 OR RC EQ 8) | ABEND)`).
- Any other operation becomes a plain `statement` with an `operation` node.
  That includes the JCL command statement (`// START XWTR`) and program
  control statements inside `CNTL`.
- Operands are `parameter` nodes, keyword (`key: (keyword)`, `value`) or
  positional (`value`). A value is words, quoted strings and parenthesised
  lists, nested as deep as the JCL goes: `VOL=SER=(A,B)` is a parameter whose
  value is the parameter `SER=(A,B)`.
- Continuations after a comma, with comments on the continued line and
  `//*` comment lines in between; strings that run on into the next line.
- Comments: `//*` lines and the text after the operands. A comment with a
  non-blank column 72 continues onto the next `// ` line.
- In-stream data after `DD *`, `DD DATA`, `XMIT` and `/*XMIT` is one
  `instream_data` node. It ends where z/OS ends it: `DD *` at `//` or `/*`,
  the others at `/*`, and `DLM=` (quoted or not) replaces `/*` with its own
  delimiter. Stray lines without such a statement are `data_line`s.
- `/*` delimiters, JES2 statements (`/*JOBPARM ...`) and the null
  statement `//`.
- Sequence numbers in columns 73-80 become `sequence_number` extras.

The external scanner in `src/scanner.c` handles what depends on columns or
on earlier statements: sequence numbers, comment continuation and in-stream
data.

Finding the program a step runs:

```scheme
(exec_statement
  operands: (operands
    (parameter key: (keyword) @k value: (value) @program
      (#eq? @k "PGM"))))
```

A step that calls a procedure has a positional first parameter instead
(`EXEC MYPROC`) or the key `PROC`.

## Development

```sh
nix develop
tree-sitter generate && tree-sitter test   # about 0.1 s and 0.3 s
```

## Comparison with other parsers

Two reference parsers are checked against this grammar. Each `run.sh` fetches
the reference at a pinned commit into `test/*/.work`, records its
accept/reject verdict for every sample, and `test/compare.mjs` checks both
verdicts against the committed `baseline.tsv`. `--update` accepts new verdicts.

```sh
nix develop -c test/mapa/run.sh    # mapa's ANTLR JCL parser, 216 files, ~80 s
nix develop -c test/natan/run.sh   # natan-sysview/tree-sitter-jcl corpus, 77 files, ~15 s
```

- [mapa](https://github.com/cschneid-the-elder/mapa) (MIT), `jcl/testdata`:
  both accept 206 files and both reject 2. mapa also rejects 8 of its
  negative tests that are not syntax errors here: a DD before any JOB, empty
  `LRECL=`, a positional operand on PROC, `ORDER(...)` without `=`, a COBOL
  program and an EBCDIC file (z/OS reads stray lines as in-stream data).
  No file is rejected only by this grammar.
- [natan-sysview/tree-sitter-jcl](https://github.com/natan-sysview/tree-sitter-jcl)
  (MIT): both accept 48 of the 77 inputs (corpus snippets plus one example). natan's
  parser is lenient by design and accepts the other 29, which this grammar
  rejects: corpus snippets that are lone continuation lines, names with `%`
  or lowercase letters, blanks around `=`, operands cut off by a blank, and
  natan's error-recovery tests.

Known gaps are in `GOTCHAS.md`.
