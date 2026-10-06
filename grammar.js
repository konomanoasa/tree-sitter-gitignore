const issueKinds = [
  ["missing_set_close", "invalid_syntax", "missing_set_close"],
  ["incomplete_set_close", "incomplete_syntax", "missing_set_close"],
  ["invalid_encoding", "invalid_syntax", "invalid_encoding"],
  ["invalid_escape", "invalid_syntax", "incomplete_escape"],
  ["incomplete_escape", "incomplete_syntax", "incomplete_escape"],
];
const issueRules = Object.fromEntries(
  issueKinds.flatMap(([token, outcome, reason]) => [
    [`_${token}_outcome`, ($) => alias($[`_${token}`], $[reason])],
    [`_${token}_issue`, ($) => alias($[`_${token}_outcome`], $[outcome])],
  ]),
);
const issue = ($, name) =>
  field("issue", alias($[`_${name}_issue`], $.syntax_issue));
const issues = ($, ...names) => names.map((name) => issue($, name));
const globIssues = ($) => [
  ...issues($, "invalid_encoding", "invalid_escape", "incomplete_escape"),
  seq($._escape_prefix, issue($, "invalid_encoding")),
];

export default grammar({
  name: "gitignore",
  externals: ($) => [
    $._blank_start,
    $._comment_start,
    $._pattern_start,
    $._eof,
    $._glob_start,
    $._set_item_start,
    $.comment_marker,
    $.comment_text,
    $.negation,
    $._literal,
    $.wildcard,
    $.recursive_wildcard,
    $.single_character,
    $.path_separator,
    $.escape,
    $._escape_prefix,
    $.set_open,
    $.set_negation,
    $.set_text,
    $.set_close,
    $._range_start,
    $.range_character,
    $.range_operator,
    $._compound_open,
    $._compound_close,
    $._class_open,
    $.class_name,
    $._class_close,
    $.trailing_space,
    $.trailing_carriage_return,
    $._ignored_start,
    $.ignored_text,
    ...issueKinds.map(([name]) => $[`_${name}`]),
    $._error_sentinel,
  ],
  extras: () => [],
  rules: {
    document: ($) => repeat(choice($.blank_line, $.comment, $.pattern)),
    line_ending: () => /\r?\n/,
    _line_end: ($) =>
      choice($.line_ending, seq(optional($.trailing_carriage_return), $._eof)),
    _end: ($) => seq(optional($.trailing_space), $._suffix),
    _suffix: ($) => seq(optional($.ignored_suffix), $._line_end),
    ignored_suffix: ($) =>
      seq(
        $._ignored_start,
        repeat1(choice($.ignored_text, issue($, "invalid_encoding"))),
      ),
    blank_line: ($) => seq($._blank_start, $._end),
    comment: ($) =>
      seq(
        $._comment_start,
        $.comment_marker,
        repeat(choice($.comment_text, issue($, "invalid_encoding"))),
        $._suffix,
      ),
    pattern: ($) =>
      seq(
        $._pattern_start,
        optional(field("negation", $.negation)),
        repeat(
          choice(
            $.glob_literal,
            seq(
              $._glob_start,
              choice(
                $.wildcard,
                $.recursive_wildcard,
                $.single_character,
                $.path_separator,
                $.escape,
                $.character_set,
                ...globIssues($),
              ),
            ),
          ),
        ),
        $._end,
      ),
    glob_literal: ($) => $._literal,
    character_set: ($) =>
      seq(
        field("opening", $.set_open),
        optional(field("negation", $.set_negation)),
        repeat(
          seq(
            $._set_item_start,
            choice(
              $.set_text,
              $.escape,
              $.character_range,
              $.character_class,
              ...globIssues($),
            ),
          ),
        ),
        choice(
          field("closing", $.set_close),
          ...issues($, "missing_set_close", "incomplete_set_close"),
        ),
      ),
    character_range: ($) =>
      seq(
        $._range_start,
        field("lower", $._endpoint),
        $.range_operator,
        field("upper", $._endpoint),
      ),
    _endpoint: ($) => choice($.range_character, $.escape),
    character_class: ($) =>
      seq(
        alias($._compound_open, "["),
        alias($._class_open, ":"),
        repeat(
          choice(field("name", $.class_name), issue($, "invalid_encoding")),
        ),
        alias($._class_close, ":"),
        alias($._compound_close, "]"),
      ),
    ...issueRules,
  },
});
