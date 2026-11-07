#include "tree_sitter/parser.h"

// Columns 73-80 of a JCL record hold sequence numbers, which the system
// ignores. A grammar rule can't see columns, so this scanner claims what
// starts there as one sequence_number token, up to the end of the line. Only
// letters, digits and blanks count, so an operand that overruns column 72
// stays an operand.

enum TokenType { SEQUENCE_NUMBER };

void *tree_sitter_jcl_external_scanner_create(void) { return NULL; }
void tree_sitter_jcl_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_jcl_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_jcl_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_jcl_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  if (!valid_symbols[SEQUENCE_NUMBER]) return false;
  if (lexer->eof(lexer) || lexer->lookahead == '\n' || lexer->lookahead == '\r') return false;
  if (lexer->get_column(lexer) < 72) return false;
  while (!lexer->eof(lexer) && lexer->lookahead != '\n' && lexer->lookahead != '\r') {
    int32_t c = lexer->lookahead;
    bool plain = c == ' ' || (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    if (!plain) return false;
    lexer->advance(lexer, false);
  }
  lexer->result_symbol = SEQUENCE_NUMBER;
  return true;
}
