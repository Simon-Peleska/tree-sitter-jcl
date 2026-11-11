#include "tree_sitter/parser.h"

#include <stdlib.h>
#include <string.h>

// Three things a grammar rule can't do in JCL:
//
// Columns 73-80 of a record hold sequence numbers, which the system ignores.
// A grammar rule can't see columns, so this scanner claims what starts there
// as one sequence_number token, up to the end of the line. Only letters,
// digits and blanks count, so an operand that overruns column 72 stays an
// operand.
//
// In-stream data ends at a delimiter that depends on the statement that
// started it: DD * ends at // or /*, DD DATA, XMIT and /*XMIT end at /*, and
// DLM= replaces /* with its own delimiter (DD * still ends at // on JES2).
// The scanner remembers the mode and delimiter between tokens and emits the
// data lines as one instream_data token.
//
// A comment after the operands continues onto the next line when column 72
// is not blank and that line starts with // and a blank.

enum TokenType {
  SEQUENCE_NUMBER,
  INSTREAM_DATA,
  DATA_END,
  INSTREAM_MARKER,
  DLM_WORD,
  DLM_STRING,
  DLM_DELIMITER,
  JES2_XMIT,
  XMIT,
  TRAILING_COMMENT,
};

enum Mode { MODE_NONE, MODE_STAR, MODE_DATA };

#define MAX_DLM 18

typedef struct {
  uint8_t mode;
  uint8_t dlm_length;
  int32_t dlm[MAX_DLM];
} Scanner;

void *tree_sitter_jcl_external_scanner_create(void) { return calloc(1, sizeof(Scanner)); }
void tree_sitter_jcl_external_scanner_destroy(void *payload) { free(payload); }

unsigned tree_sitter_jcl_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *s = payload;
  buffer[0] = (char)s->mode;
  buffer[1] = (char)s->dlm_length;
  memcpy(buffer + 2, s->dlm, s->dlm_length * sizeof(int32_t));
  return 2 + s->dlm_length * sizeof(int32_t);
}

void tree_sitter_jcl_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *s = payload;
  memset(s, 0, sizeof(Scanner));
  if (length < 2) return;
  s->mode = (uint8_t)buffer[0];
  s->dlm_length = (uint8_t)buffer[1];
  memcpy(s->dlm, buffer + 2, s->dlm_length * sizeof(int32_t));
}

static bool at_line_end(TSLexer *lexer) {
  return lexer->eof(lexer) || lexer->lookahead == '\n' || lexer->lookahead == '\r';
}

static bool is_blank(TSLexer *lexer) { return lexer->lookahead == ' ' || lexer->lookahead == '\t'; }

static bool at_operand_end(TSLexer *lexer) {
  return at_line_end(lexer) || lexer->lookahead == ',' || is_blank(lexer);
}

static bool is_sequence_char(int32_t c) {
  return c == ' ' || (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

static void skip_rest_of_line(TSLexer *lexer) {
  while (!at_line_end(lexer)) lexer->advance(lexer, false);
}

static bool consume_word(TSLexer *lexer, const char *word) {
  for (; *word; word++) {
    if (lexer->lookahead != *word) return false;
    lexer->advance(lexer, false);
  }
  return true;
}

static void set_mode(Scanner *s, enum Mode mode) {
  s->mode = mode;
  s->dlm_length = 0;
}

// A delimiter shorter than 2 characters is invalid; JES2 then ends the data
// at // or /*, as for DD *.
static void set_delimiter(Scanner *s, const int32_t *dlm, unsigned length) {
  if (s->mode == MODE_NONE) return;
  if (length < 2) {
    set_mode(s, MODE_STAR);
    return;
  }
  memcpy(s->dlm, dlm, length * sizeof(int32_t));
  s->dlm_length = (uint8_t)length;
}

// Reads a DLM= value, unquoting 'A''B' and '&&7', and keeps its first
// MAX_DLM characters. Returns 0 if the value is empty or the quote is not
// closed on this line.
static unsigned read_delimiter(TSLexer *lexer, int32_t *dlm) {
  unsigned n = 0;
  if (lexer->lookahead == '\'') {
    lexer->advance(lexer, false);
    for (;;) {
      if (at_line_end(lexer)) return 0;
      int32_t c = lexer->lookahead;
      lexer->advance(lexer, false);
      if (c == '\'') {
        if (lexer->lookahead != '\'') break;
        lexer->advance(lexer, false);
      } else if (c == '&' && lexer->lookahead == '&') {
        lexer->advance(lexer, false);
      }
      if (n < MAX_DLM) dlm[n++] = c;
    }
    return n;
  }
  while (!at_operand_end(lexer) && lexer->lookahead != '(' && lexer->lookahead != ')' &&
         lexer->lookahead != '=' && lexer->lookahead != '\'') {
    if (n < MAX_DLM) dlm[n++] = lexer->lookahead;
    lexer->advance(lexer, false);
  }
  return n;
}

enum Terminator { NOT_TERMINATOR, JCL_TERMINATOR, DLM_TERMINATOR };

// Consumes the start of a line and reports whether it ends the current
// in-stream data, and how: a line the grammar parses as // or /*, or the DLM
// delimiter, which the scanner has to emit itself.
static enum Terminator at_terminator(Scanner *s, TSLexer *lexer) {
  int32_t start[MAX_DLM];
  unsigned want = s->dlm_length > 2 ? s->dlm_length : 2;
  unsigned n = 0;
  while (n < want && !at_line_end(lexer)) {
    start[n++] = lexer->lookahead;
    lexer->advance(lexer, false);
  }
  bool slash_slash = n >= 2 && start[0] == '/' && start[1] == '/';
  bool slash_star = n >= 2 && start[0] == '/' && start[1] == '*';
  if (s->mode == MODE_STAR && slash_slash) return JCL_TERMINATOR;
  if (s->dlm_length == 0) return slash_star ? JCL_TERMINATOR : NOT_TERMINATOR;
  bool dlm = n >= s->dlm_length && memcmp(start, s->dlm, s->dlm_length * sizeof(int32_t)) == 0;
  return dlm ? DLM_TERMINATOR : NOT_TERMINATOR;
}

static bool scan_instream_data(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
  // Leading empty lines are left to the grammar's newlines.
  if (at_line_end(lexer)) return false;
  lexer->mark_end(lexer);
  bool has_data = false;
  while (!lexer->eof(lexer)) {
    bool empty_line = at_line_end(lexer);
    enum Terminator terminator = at_terminator(s, lexer);
    if (terminator == DLM_TERMINATOR && !has_data) {
      if (!valid_symbols[DLM_DELIMITER]) return false;
      skip_rest_of_line(lexer);
      lexer->mark_end(lexer);
      set_mode(s, MODE_NONE);
      lexer->result_symbol = DLM_DELIMITER;
      return true;
    }
    if (terminator == JCL_TERMINATOR && !has_data) {
      if (!valid_symbols[DATA_END]) return false;
      set_mode(s, MODE_NONE);
      lexer->result_symbol = DATA_END;
      return true;
    }
    if (terminator != NOT_TERMINATOR) break;
    skip_rest_of_line(lexer);
    if (!empty_line) lexer->mark_end(lexer);
    has_data = true;
    if (lexer->lookahead == '\r') lexer->advance(lexer, false);
    if (lexer->lookahead == '\n') lexer->advance(lexer, false);
  }
  if (!has_data || !valid_symbols[INSTREAM_DATA]) return false;
  lexer->result_symbol = INSTREAM_DATA;
  return true;
}

// /*XMIT node [DLM=xx] starts in-stream data like the XMIT JCL statement.
static bool scan_jes2_xmit(Scanner *s, TSLexer *lexer) {
  if (!consume_word(lexer, "/*XMIT")) return false;
  if (!at_operand_end(lexer)) return false;
  set_mode(s, MODE_DATA);
  while (!at_line_end(lexer)) {
    bool after_blank = is_blank(lexer);
    lexer->advance(lexer, false);
    if (!after_blank || !consume_word(lexer, "DLM=")) continue;
    int32_t dlm[MAX_DLM];
    set_delimiter(s, dlm, read_delimiter(lexer, dlm));
  }
  lexer->result_symbol = JES2_XMIT;
  return true;
}

bool tree_sitter_jcl_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *s = payload;

  if (valid_symbols[SEQUENCE_NUMBER] && !at_line_end(lexer) && lexer->get_column(lexer) >= 72) {
    bool plain = true;
    while (!at_line_end(lexer)) {
      plain = plain && is_sequence_char(lexer->lookahead);
      if (!plain && !valid_symbols[TRAILING_COMMENT]) return false;
      lexer->advance(lexer, false);
    }
    lexer->result_symbol = plain ? SEQUENCE_NUMBER : TRAILING_COMMENT;
    return true;
  }

  // During error recovery every symbol is valid; none of the tokens below
  // can be told apart without the grammar's context.
  if (valid_symbols[INSTREAM_DATA] && valid_symbols[DLM_WORD]) return false;

  if (lexer->get_column(lexer) == 0) {
    if (s->mode != MODE_NONE && (valid_symbols[INSTREAM_DATA] || valid_symbols[DATA_END])) {
      return scan_instream_data(s, lexer, valid_symbols);
    }
    if (valid_symbols[JES2_XMIT] && lexer->lookahead == '/') return scan_jes2_xmit(s, lexer);
    return false;
  }

  // The comment stops at column 72 so that a sequence number after it stays
  // a sequence_number, unless it continues onto the next line.
  if (valid_symbols[TRAILING_COMMENT] && !at_line_end(lexer) && !is_blank(lexer)) {
    unsigned column = lexer->get_column(lexer);
    for (;;) {
      bool continued = false;
      bool plain = true;
      for (; !at_line_end(lexer); column++) {
        if (column == 71) continued = !is_blank(lexer);
        if (column == 72) lexer->mark_end(lexer);
        if (column >= 72) plain = plain && is_sequence_char(lexer->lookahead);
        lexer->advance(lexer, false);
      }
      if (column <= 72 || !plain) lexer->mark_end(lexer);
      if (!continued) break;
      if (lexer->lookahead == '\r') lexer->advance(lexer, false);
      if (lexer->lookahead != '\n') break;
      lexer->advance(lexer, false);
      if (!consume_word(lexer, "//")) break;
      if (!at_line_end(lexer) && !is_blank(lexer)) break;
      column = 2;
    }
    lexer->result_symbol = TRAILING_COMMENT;
    return true;
  }

  if (valid_symbols[INSTREAM_MARKER]) {
    enum Mode mode = MODE_NONE;
    if (lexer->lookahead == '*') {
      lexer->advance(lexer, false);
      mode = MODE_STAR;
    } else if (consume_word(lexer, "DATA")) {
      mode = MODE_DATA;
    }
    if (mode == MODE_NONE || !at_operand_end(lexer)) return false;
    set_mode(s, mode);
    lexer->result_symbol = INSTREAM_MARKER;
    return true;
  }

  if (valid_symbols[DLM_WORD] || valid_symbols[DLM_STRING]) {
    bool quoted = lexer->lookahead == '\'';
    int32_t dlm[MAX_DLM];
    unsigned length = read_delimiter(lexer, dlm);
    if (length == 0) return false;
    set_delimiter(s, dlm, length);
    lexer->result_symbol = quoted ? DLM_STRING : DLM_WORD;
    return true;
  }

  if (valid_symbols[XMIT] && consume_word(lexer, "XMIT") && at_operand_end(lexer)) {
    set_mode(s, MODE_DATA);
    lexer->result_symbol = XMIT;
    return true;
  }

  return false;
}
