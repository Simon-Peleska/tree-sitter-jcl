# Gotchas

- `DD DATA` and `DLM=` are not tracked. In-stream data that itself starts
  with `//` (IEBUPDTE input, JCL submitted through INTRDR) parses as JCL
  statements, not as `data_line`s.
- JES2 execution control conditions (`JOBGROUP ERROR=(RC > 4 | ABEND)`,
  `AFTER WHEN=(RC EQ 4 OR RC EQ 8)`) are parse errors: blanks inside
  parentheses end the operand field everywhere else in JCL.
- Keyword values are not validated (`LRECL=` with nothing after it, a
  positional operand on PROC). mapa's parser rejects those; this grammar
  accepts them.
- Operations must be uppercase, as on z/OS. `//s1 exec pgm=x` is a generic
  `statement`.
- A sequence number is whatever starts in column 73 or later, as long as it is
  only letters, digits and blanks. An operand that runs past column 72 stays
  an operand, which z/OS itself would cut off.
- `test/mapa/run.sh` takes about 80 s: mapa's grammar is large and ANTLR
  needs full-context prediction on many of the files.
