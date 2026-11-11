# Gotchas

- Keyword values are not validated (`LRECL=` with nothing after it, a
  positional operand on PROC). mapa's parser rejects those; this grammar
  accepts them.
- Operations must be uppercase, as on z/OS. `//s1 exec pgm=x` is a generic
  `statement`.
- A sequence number is whatever starts in column 73 or later, as long as it is
  only letters, digits and blanks. An operand that runs past column 72 stays
  an operand, which z/OS itself would cut off.
- In-stream data follows JES2: `DD *,DLM=xx` still ends at `//`. JES3 would
  only end it at the delimiter.
- JES3 control statements (`//*MAIN`, `//**MESSAGE`) are plain comments.
  z/OS 3.1 no longer has JES3, and `//*****` banner comments would otherwise
  look like JES3 commands.
- Data without a `DD *` or `DD DATA` in front of it (z/OS supplies a SYSIN
  DD) is a series of `data_line`s and ends at the first `//` line.
- `test/mapa/run.sh` takes about 80 s: mapa's grammar is large and ANTLR
  needs full-context prediction on many of the files.
