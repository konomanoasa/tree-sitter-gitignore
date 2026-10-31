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
    ignored_suffix: ($) => seq($._ignored_start, $.ignored_text),
    blank_line: ($) => seq($._blank_start, $._end),
    comment: ($) =>
      seq(
        $._comment_start,
        $.comment_marker,
        optional($.comment_text),
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
        repeat($._set_item),
        field("closing", $.set_close),
      ),
    _set_item: ($) =>
      seq(
        $._set_item_start,
        choice($.set_text, $.escape, $.character_range, $.character_class),
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
        optional(field("name", $.class_name)),
        alias($._class_close, ":"),
        alias($._compound_close, "]"),
      ),
  },
});
