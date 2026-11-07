# tree-sitter-jcl

A [tree-sitter](https://tree-sitter.github.io/) grammar for z/OS JCL, written
for the jobs of an IMS / MVS shop. It aims at structure (statements, names,
operations and parameters) rather than at validating every keyword value, so
editors and code-graph tools can read real-world JCL without choking on it.

## What it parses

- `JOB`, `EXEC`, `DD`, `PROC`/`PEND`, `SET`, `JCLLIB`, `INCLUDE`, `OUTPUT`,
  `IF`/`THEN`/`ELSE`/`ENDIF`, `CNTL`/`ENDCNTL`, `EXPORT`, `SCHEDULE`, `XMIT`
  and `COMMAND` each get their own node (`exec_statement`, ...). Any other
  operation becomes a plain `statement` with an `operation` node.
- Operands are `parameter` nodes, keyword (`key: (keyword)`, `value`) or
  positional (`value`). A value is words, quoted strings and parenthesised
  lists, nested as deep as the JCL goes: `VOL=SER=(A,B)` is a parameter whose
  value is the parameter `SER=(A,B)`.
- Continuations after a comma, with comments on the continued line and
  `//*` comment lines in between; strings that run on into the next line.
- Comments: `//*` lines and the text after the operands.
- In-stream data lines (`data_line`), `/*` delimiters, JES2 statements
  (`/*JOBPARM ...`) and the null statement `//`.
- Sequence numbers in columns 73-80 become `sequence_number` extras (a small
  external scanner in `src/scanner.c` handles the columns).

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
tree-sitter generate && tree-sitter test
```

## Comparison with other parsers

Two reference parsers are checked against this grammar. Each `run.sh` fetches
the reference at a pinned commit into `test/*/.work`, records its
accept/reject verdict for every sample, and `test/compare.mjs` checks both
verdicts against the committed `baseline.tsv`. `--update` accepts new verdicts.

```sh
nix develop -c test/mapa/run.sh    # mapa's ANTLR JCL parser, 216 files
nix develop -c test/natan/run.sh   # natan-sysview/tree-sitter-jcl corpus, 77 files
```

- [mapa](https://github.com/cschneid-the-elder/mapa) (MIT), `jcl/testdata`:
  both accept 203 files and both reject 2. mapa also rejects 8 of its
  negative tests that are not syntax errors here: a DD before any JOB, empty
  `LRECL=`, a positional operand on PROC, `ORDER(...)` without `=`, a COBOL
  program and an EBCDIC file (z/OS reads stray lines as in-stream data).
  Only this grammar rejects 3 files: JES2 `JOBGROUP`/`AFTER` conditions with
  blanks inside parentheses (`WHEN=(RC EQ 4 OR RC EQ 8)`).
- [natan-sysview/tree-sitter-jcl](https://github.com/natan-sysview/tree-sitter-jcl)
  (MIT): both accept all 76 corpus inputs and the example.

Known gaps are in `GOTCHAS.md`.
