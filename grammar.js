/**
 * @file z/OS JCL grammar for tree-sitter
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Blanks are significant in JCL (they separate name, operation, operands and
// comments), so the only extra is the sequence number in columns 73-80 and
// every blank is spelled out.

const OPERAND_STATEMENTS = {
  job_statement: 'JOB',
  dd_statement: 'DD',
  proc_statement: 'PROC',
  set_statement: 'SET',
  jcllib_statement: 'JCLLIB',
  include_statement: 'INCLUDE',
  output_statement: 'OUTPUT',
  cntl_statement: 'CNTL',
  export_statement: 'EXPORT',
  schedule_statement: 'SCHEDULE',
  xmit_statement: 'XMIT',
  command_statement: 'COMMAND',
};

const PLAIN_STATEMENTS = {
  pend_statement: 'PEND',
  else_statement: 'ELSE',
  endif_statement: 'ENDIF',
  endcntl_statement: 'ENDCNTL',
};

function statementStart($) {
  return seq('//', optional(field('name', $.name)), $._blank);
}

function operandTail($) {
  return optional(seq(
    $._blank,
    optional(seq(
      field('operands', $.operands),
      optional(seq($._blank, optional(alias($._trailing_comment, $.comment)))),
    )),
  ));
}

function commentTail($) {
  return optional(seq($._blank, optional(alias($._trailing_comment, $.comment))));
}

module.exports = grammar({
  name: 'jcl',

  externals: $ => [$.sequence_number],

  extras: $ => [$.sequence_number],

  rules: {
    source_file: $ => seq(
      optional($._line),
      repeat(seq($._newline, optional($._line))),
    ),

    _line: $ => choice(
      $.exec_statement,
      ...Object.keys(OPERAND_STATEMENTS).map(name => $[name]),
      ...Object.keys(PLAIN_STATEMENTS).map(name => $[name]),
      $.if_statement,
      $.statement,
      $.null_statement,
      $.comment,
      $.jes2_statement,
      $.delimiter,
      $.data_line,
    ),

    ...Object.fromEntries(Object.entries(OPERAND_STATEMENTS).map(([name, op]) => [
      name,
      $ => seq(statementStart($), field('operation', op), operandTail($)),
    ])),

    ...Object.fromEntries(Object.entries(PLAIN_STATEMENTS).map(([name, op]) => [
      name,
      $ => seq(statementStart($), field('operation', op), commentTail($)),
    ])),

    exec_statement: $ => seq(
      statementStart($),
      field('operation', 'EXEC'),
      $._blank,
      field('operands', $.operands),
      commentTail($),
    ),

    if_statement: $ => seq(
      statementStart($),
      field('operation', 'IF'),
      field('condition', $.condition),
      'THEN',
      commentTail($),
    ),

    condition: $ => repeat1(choice(
      $._blank,
      alias(/\r?\n\/\/[ \t]+/, $.continuation),
      '(',
      ')',
      alias(/[=<>¬^&|!]+/, $.operator),
      alias(/[A-Za-z0-9@#$&._+-]+/, $.word),
    )),

    statement: $ => seq(statementStart($), field('operation', $.operation), operandTail($)),

    null_statement: $ => seq('//', optional($._blank)),

    operands: $ => choice(
      seq($.parameter, repeat(seq($._separator, optional($.parameter)))),
      repeat1(seq($._separator, optional($.parameter))),
    ),

    parameter: $ => choice($._assignment, field('value', $.value)),

    _assignment: $ => seq(
      field('key', alias($._word, $.keyword)),
      '=',
      optional(field('value', choice(alias($._assignment, $.parameter), $.value))),
    ),

    value: $ => repeat1(choice($.word, $.string, $.list)),

    list: $ => seq(
      '(',
      choice(
        seq($.parameter, repeat(seq($._separator, optional($.parameter)))),
        repeat1(seq($._separator, optional($.parameter))),
        blank(),
      ),
      ')',
    ),

    // A comma may end the line, optionally followed by a comment; the next
    // operand then starts after `//` and blanks on the next line, with comment
    // lines allowed in between.
    _separator: $ => seq(',', optional(alias($._continuation, $.continuation))),

    _continuation: _ => token(seq(
      /([ \t][^\r\n]*)?\r?\n/,
      repeat(/\/\/\*[^\r\n]*\r?\n/),
      /\/\/[ \t]+/,
    )),

    word: $ => $._word,
    _word: _ => /[^\s,()'=]+/,

    // A quoted string may run past the end of a line and resume after `//`
    // and blanks on the next one.
    string: _ => token(seq(
      '\'',
      repeat(choice(/[^'\r\n]/, '\'\'', /\r?\n\/\/\*[^\r\n]*/, /\r?\n\/\/[ \t]+/)),
      '\'',
    )),

    name: _ => /[A-Za-z@#$][A-Za-z0-9@#$]*(\.[A-Za-z@#$][A-Za-z0-9@#$]*)?/,
    operation: _ => /[A-Z@#$][A-Z0-9@#$]*/,

    comment: _ => /\/\/\*[^\r\n]*/,
    _trailing_comment: _ => /[^\s][^\r\n]*/,

    jes2_statement: _ => /\/\*[A-Z$][^\r\n]*/,
    delimiter: _ => /\/\*([ \t][^\r\n]*)?/,
    data_line: _ => /([^\/\r\n]|\/[^\/*\r\n])[^\r\n]*/,

    _blank: _ => /[ \t]+/,
    _newline: _ => /\r?\n/,
  },
});
