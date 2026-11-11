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
  proc_statement: 'PROC',
  set_statement: 'SET',
  jcllib_statement: 'JCLLIB',
  include_statement: 'INCLUDE',
  output_statement: 'OUTPUT',
  cntl_statement: 'CNTL',
  export_statement: 'EXPORT',
  schedule_statement: 'SCHEDULE',
  command_statement: 'COMMAND',
  notify_statement: 'NOTIFY',
};

// JES2 execution control statements (job groups). Their WHEN= and ERROR=
// operands take an IF-style condition, which may contain blanks.
const JEC_STATEMENTS = {
  jobgroup_statement: 'JOBGROUP',
  gjob_statement: 'GJOB',
  jobset_statement: 'JOBSET',
  before_statement: 'BEFORE',
  after_statement: 'AFTER',
  concurrent_statement: 'CONCURRENT',
};

const PLAIN_STATEMENTS = {
  pend_statement: 'PEND',
  else_statement: 'ELSE',
  endif_statement: 'ENDIF',
  endcntl_statement: 'ENDCNTL',
  sjob_statement: 'SJOB',
  endset_statement: 'ENDSET',
  endgroup_statement: 'ENDGROUP',
};

function statementStart($) {
  return seq('//', optional(field('name', $.name)), $._blank);
}

// Each statement kind shares one hidden tail rule instead of inlining its
// own copy, which keeps the parse table small.
function operandTail($, operands) {
  return seq($._blank, optional(seq(field('operands', operands), optional($._comment_tail))));
}

function operandList($, first, rest = first) {
  return choice(
    seq(first, repeat(seq($._separator, optional(rest)))),
    repeat1(seq($._separator, optional(rest))),
  );
}

module.exports = grammar({
  name: 'jcl',

  // src/scanner.c explains why these need a scanner. _data_end is a
  // zero-width token at the start of the line that ends in-stream data.
  externals: $ => [
    $.sequence_number,
    $.instream_data,
    $._data_end,
    $._instream_marker,
    $._dlm_word,
    $._dlm_string,
    $._dlm_delimiter,
    $._jes2_xmit,
    'XMIT',
    $._trailing_comment,
  ],

  extras: $ => [$.sequence_number],

  rules: {
    source_file: $ => seq(
      optional($._line),
      repeat(seq($._newline, optional($._data_end), optional($._line))),
    ),

    _line: $ => choice(
      $.exec_statement,
      $.dd_statement,
      $.xmit_statement,
      ...Object.keys(OPERAND_STATEMENTS).map(name => $[name]),
      ...Object.keys(PLAIN_STATEMENTS).map(name => $[name]),
      ...Object.keys(JEC_STATEMENTS).map(name => $[name]),
      $.if_statement,
      $.statement,
      $.null_statement,
      $.comment,
      $.jes2_statement,
      alias($._jes2_xmit, $.jes2_statement),
      $.delimiter,
      alias($._dlm_delimiter, $.delimiter),
      $.instream_data,
      $.data_line,
    ),

    ...Object.fromEntries(Object.entries(OPERAND_STATEMENTS).map(([name, op]) => [
      name,
      $ => seq(statementStart($), field('operation', op), optional($._operand_tail)),
    ])),

    ...Object.fromEntries(Object.entries(PLAIN_STATEMENTS).map(([name, op]) => [
      name,
      $ => seq(statementStart($), field('operation', op), optional($._comment_tail)),
    ])),

    ...Object.fromEntries(Object.entries(JEC_STATEMENTS).map(([name, op]) => [
      name,
      $ => seq(statementStart($), field('operation', op), optional($._jec_tail)),
    ])),

    _operand_tail: $ => operandTail($, $.operands),
    _jec_tail: $ => operandTail($, alias($._jec_operands, $.operands)),
    _dd_tail: $ => optional($._dd_tail),
    _xmit_tail: $ => optional($._xmit_tail),
    _comment_tail: $ => seq($._blank, optional(alias($._trailing_comment, $.comment))),

    _jec_operands: $ => operandList($, $._jec_parameter),

    _jec_parameter: $ => choice($.parameter, alias($._condition_assignment, $.parameter)),

    _condition_assignment: $ => seq(
      field('key', alias(choice('WHEN', 'ERROR'), $.keyword)),
      '=',
      field('value', alias($._condition_group, $.condition)),
    ),

    _condition_group: $ => seq('(', repeat(choice($._condition_token, $._condition_group)), ')'),

    dd_statement: $ => seq(
      statementStart($),
      field('operation', 'DD'),
      operandTail($, alias($._dd_operands, $.operands)),
    ),

    xmit_statement: $ => seq(
      statementStart($),
      field('operation', 'XMIT'),
      operandTail($, alias($._xmit_operands, $.operands)),
    ),

    _dd_operands: $ => operandList(
      $,
      choice(alias($._instream_parameter, $.parameter), $._dlm_or_parameter),
      $._dlm_or_parameter,
    ),

    _xmit_operands: $ => operandList($, $._dlm_or_parameter),

    _instream_parameter: $ => field('value', alias($._instream_value, $.value)),
    _instream_value: $ => alias($._instream_marker, $.word),

    _dlm_or_parameter: $ => choice($.parameter, alias($._dlm_assignment, $.parameter)),

    _dlm_assignment: $ => seq(
      field('key', alias('DLM', $.keyword)),
      '=',
      optional(field('value', alias($._dlm_value, $.value))),
    ),

    _dlm_value: $ => choice(alias($._dlm_word, $.word), alias($._dlm_string, $.string)),

    exec_statement: $ => seq(
      statementStart($),
      field('operation', 'EXEC'),
      $._blank,
      field('operands', $.operands),
      optional($._comment_tail),
    ),

    if_statement: $ => seq(
      statementStart($),
      field('operation', 'IF'),
      field('condition', $.condition),
      'THEN',
      optional($._comment_tail),
    ),

    condition: $ => repeat1(choice($._condition_token, '(', ')')),

    _condition_token: $ => choice(
      $._blank,
      alias(/\r?\n\/\/[ \t]+/, $.continuation),
      alias(/[=<>¬^&|!]+/, $.operator),
      alias(/[A-Za-z0-9@#$&._+-]+/, $.word),
    ),

    statement: $ => seq(statementStart($), field('operation', $.operation), optional($._operand_tail)),

    null_statement: $ => seq('//', optional($._blank)),

    operands: $ => operandList($, $.parameter),

    parameter: $ => choice($._assignment, field('value', $.value)),

    _assignment: $ => seq(
      field('key', alias($._word, $.keyword)),
      '=',
      optional(field('value', choice(alias($._assignment, $.parameter), $.value))),
    ),

    value: $ => repeat1(choice($.word, $.string, $.list)),

    list: $ => seq('(', optional(operandList($, $.parameter)), ')'),

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

    jes2_statement: _ => /\/\*[A-Z$][^\r\n]*/,
    delimiter: _ => /\/\*([ \t][^\r\n]*)?/,
    data_line: _ => /([^\/\r\n]|\/[^\/*\r\n])[^\r\n]*/,

    _blank: _ => /[ \t]+/,
    _newline: _ => /\r?\n/,
  },
});
