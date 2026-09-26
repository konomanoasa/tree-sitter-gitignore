import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import nodeTypes from "../src/node-types.json" with { type: "json" };
import { issues, leaves, owners, parse } from "./support/parser.js";

test("gitignore: public issue nodes have one outcome and one reason leaf", () => {
  const issue = nodeTypes.find(({ type }) => type === "syntax_issue");
  assert.equal(issue.children.required, true);
  assert.equal(issue.children.multiple, false);
  assert.deepEqual(
    issue.children.types.map(({ type }) => type),
    ["incomplete_syntax", "invalid_syntax"],
  );
  for (const { type } of issue.children.types) {
    const outcome = nodeTypes.find((node) => node.type === type);
    assert.equal(outcome.children.required, true);
    assert.equal(outcome.children.multiple, false);
    for (const child of outcome.children.types) {
      const reason = nodeTypes.find((node) => node.type === child.type);
      assert.equal(reason.children, undefined);
    }
  }
});

const validCases = [
  [
    "empty class retains its four delimiters without a name",
    "[[::]]",
    [
      ["set_open", "["],
      ["[", "["],
      [":", ":"],
      [":", ":"],
      ["]", "]"],
      ["set_close", "]"],
    ],
  ],
  [
    "EOF carriage return is separate from pattern text",
    "a\r",
    [
      ["glob_literal", "a"],
      ["trailing_carriage_return", "\r"],
    ],
    [
      ["document", null, null, 0, 2],
      ["pattern", null, 0, 0, 2],
      ["glob_literal", null, 1, 0, 1],
      ["trailing_carriage_return", null, 1, 1, 2],
    ],
  ],
  [
    "only the last carriage return is removed at EOF",
    "a\r\r",
    [
      ["glob_literal", "a\r"],
      ["trailing_carriage_return", "\r"],
    ],
  ],
  [
    "trailing spaces precede the EOF carriage return",
    "a  \r",
    [
      ["glob_literal", "a"],
      ["trailing_space", "  "],
      ["trailing_carriage_return", "\r"],
    ],
  ],
  [
    "carriage return before a space is literal",
    "a\r ",
    [
      ["glob_literal", "a\r"],
      ["trailing_space", " "],
    ],
  ],
  [
    "NUL suffix has no glob tokens and preserves the next line",
    "a \0*[]\\\nc",
    [
      ["glob_literal", "a"],
      ["trailing_space", " "],
      ["ignored_text", "\0*[]\\"],
      ["line_ending", "\n"],
      ["glob_literal", "c"],
    ],
  ],
  [
    "NUL suffix in a comment is distinct from comment text",
    "# a \0b\r",
    [
      ["comment_marker", "#"],
      ["comment_text", " a "],
      ["ignored_text", "\0b"],
      ["trailing_carriage_return", "\r"],
    ],
  ],
  [
    "NUL does not remove the preceding carriage return",
    "a\r\0b\r\n",
    [
      ["glob_literal", "a\r"],
      ["ignored_text", "\0b"],
      ["line_ending", "\r\n"],
    ],
  ],
  ["NUL-only content is preserved", "\0a", [["ignored_text", "\0a"]]],
  ["CR-only content is preserved", "\r", [["trailing_carriage_return", "\r"]]],
  [
    "leading close can be the lower endpoint before a class prefix",
    "[]-[:digit:]]",
    [
      ["set_open", "["],
      ["range_character", "]"],
      ["range_operator", "-"],
      ["range_character", "["],
      ["set_text", ":digit:"],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "class after a failed candidate whose escaped bracket ends a range",
    "[[:a-\\]-[:digit:]]",
    [
      ["set_open", "["],
      ["set_text", "[:"],
      ["range_character", "a"],
      ["range_operator", "-"],
      ["escape", "\\]"],
      ["set_text", "-"],
      ["[", "["],
      [":", ":"],
      ["class_name", "digit"],
      [":", ":"],
      ["]", "]"],
      ["set_close", "]"],
    ],
  ],
  [
    "range after a class consumes an escaped upper bracket",
    "[[:alpha:]A-\\[:digit:]]",
    [
      ["set_open", "["],
      ["[", "["],
      [":", ":"],
      ["class_name", "alpha"],
      [":", ":"],
      ["]", "]"],
      ["range_character", "A"],
      ["range_operator", "-"],
      ["escape", "\\["],
      ["set_text", ":digit:"],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "three asterisks between separators follow the manual",
    "a/***/b",
    [
      ["glob_literal", "a"],
      ["path_separator", "/"],
      ["wildcard", "***"],
      ["path_separator", "/"],
      ["glob_literal", "b"],
    ],
  ],
  [
    "malformed class remains in the outer set",
    "[[:]]",
    [
      ["set_open", "["],
      ["set_text", "[:"],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "missing class colon preserves the outer set boundary",
    "[[:digit]]",
    [
      ["set_open", "["],
      ["set_text", "[:digit"],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "bracket as a range endpoint is not a collating symbol",
    "[[-z]",
    [
      ["set_open", "["],
      ["range_character", "["],
      ["range_operator", "-"],
      ["range_character", "z"],
      ["set_close", "]"],
    ],
  ],
  [
    "dot bracket text closes the set before a following hyphen",
    "[[.a.]-z]",
    [
      ["set_open", "["],
      ["set_text", "[.a."],
      ["set_close", "]"],
      ["glob_literal", "-z]"],
    ],
  ],
  [
    "opening bracket can end a range before dot text",
    "[a-[.z.]]",
    [
      ["set_open", "["],
      ["range_character", "a"],
      ["range_operator", "-"],
      ["range_character", "["],
      ["set_text", ".z."],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "range endpoint is not reused",
    "[a-m-o]",
    [
      ["set_open", "["],
      ["range_character", "a"],
      ["range_operator", "-"],
      ["range_character", "m"],
      ["set_text", "-o"],
      ["set_close", "]"],
    ],
  ],

  [
    "leading spaces preserve literal comment and negation markers",
    " #a !b",
    [["glob_literal", " #a !b"]],
  ],
  ["inline hash is literal", "a#b", [["glob_literal", "a#b"]]],
  [
    "comment retains spaces and ignores glob escapes",
    "# \\*  ",
    [
      ["comment_marker", "#"],
      ["comment_text", " \\*  "],
    ],
  ],
  ["negation without a pattern is preserved", "!", [["negation", "!"]]],
  ["slash-only pattern is preserved", "/", [["path_separator", "/"]]],
  [
    "negation applies only once",
    "!!a",
    [
      ["negation", "!"],
      ["glob_literal", "!a"],
    ],
  ],
  [
    "literal braces do not disable wildcards",
    "{a,b}*",
    [
      ["glob_literal", "{a,b}"],
      ["wildcard", "*"],
    ],
  ],
  [
    "escaped special markers",
    "\\#\\!\\*\\?\\[",
    [
      ["escape", "\\#"],
      ["escape", "\\!"],
      ["escape", "\\*"],
      ["escape", "\\?"],
      ["escape", "\\["],
    ],
  ],
  [
    "recursive wildcard at the beginning",
    "**/a",
    [
      ["recursive_wildcard", "**"],
      ["path_separator", "/"],
      ["glob_literal", "a"],
    ],
  ],
  [
    "recursive wildcard at the end",
    "a/**",
    [
      ["glob_literal", "a"],
      ["path_separator", "/"],
      ["recursive_wildcard", "**"],
    ],
  ],
  [
    "recursive wildcard in the middle",
    "a/**/b",
    [
      ["glob_literal", "a"],
      ["path_separator", "/"],
      ["recursive_wildcard", "**"],
      ["path_separator", "/"],
      ["glob_literal", "b"],
    ],
  ],
  ["standalone double asterisk is ordinary", "**", [["wildcard", "**"]]],
  [
    "long asterisk run is ordinary",
    "***/",
    [
      ["wildcard", "***"],
      ["path_separator", "/"],
    ],
  ],
  [
    "adjacent text makes double asterisk ordinary",
    "a**/",
    [
      ["glob_literal", "a"],
      ["wildcard", "**"],
      ["path_separator", "/"],
    ],
  ],
  [
    "escaped slash does not anchor a recursive wildcard",
    "\\/**",
    [
      ["escape", "\\/"],
      ["wildcard", "**"],
    ],
  ],
  [
    "trailing spaces are separate",
    "a  ",
    [
      ["glob_literal", "a"],
      ["trailing_space", "  "],
    ],
  ],
  [
    "escaped trailing space stays in the pattern",
    "a\\  ",
    [
      ["glob_literal", "a"],
      ["escape", "\\ "],
      ["trailing_space", " "],
    ],
  ],
  ["tabs are not trimmed", "a\t", [["glob_literal", "a\t"]]],
  ["space-only line", "  ", [["trailing_space", "  "]]],
  ["LF blank line", "\n", [["line_ending", "\n"]]],
  ["CRLF blank line", "\r\n", [["line_ending", "\r\n"]]],
  [
    "CRLF trailing spaces",
    "a  \r\n",
    [
      ["glob_literal", "a"],
      ["trailing_space", "  "],
      ["line_ending", "\r\n"],
    ],
    [
      ["document", null, null, 0, 5],
      ["pattern", null, 0, 0, 5],
      ["glob_literal", null, 1, 0, 1],
      ["trailing_space", null, 1, 1, 3],
      ["line_ending", null, 1, 3, 5],
    ],
  ],
  ["interior bare CR is literal", "a\rb", [["glob_literal", "a\rb"]]],
  [
    "Unicode literal and escape",
    "日本\\é",
    [
      ["glob_literal", "日本"],
      ["escape", "\\é"],
    ],
  ],
  ["leading BOM is excluded", "\uFEFFa", [["glob_literal", "a"]]],
  [
    "only the first BOM is excluded",
    "\uFEFF\uFEFFa",
    [["glob_literal", "\uFEFFa"]],
  ],

  [
    "simple set",
    "[abc]",
    [
      ["set_open", "["],
      ["set_text", "abc"],
      ["set_close", "]"],
    ],
  ],
  [
    "negated set",
    "[!abc]",
    [
      ["set_open", "["],
      ["set_negation", "!"],
      ["set_text", "abc"],
      ["set_close", "]"],
    ],
  ],
  [
    "leading closing bracket is a member",
    "[]!]",
    [
      ["set_open", "["],
      ["set_text", "]!"],
      ["set_close", "]"],
    ],
  ],
  [
    "caret negates a character set",
    "[^a]",
    [
      ["set_open", "["],
      ["set_negation", "^"],
      ["set_text", "a"],
      ["set_close", "]"],
    ],
  ],
  [
    "character range",
    "[a-z]",
    [
      ["set_open", "["],
      ["range_character", "a"],
      ["range_operator", "-"],
      ["range_character", "z"],
      ["set_close", "]"],
    ],
  ],
  [
    "text surrounding a range",
    "[ab-dxy]",
    [
      ["set_open", "["],
      ["set_text", "a"],
      ["range_character", "b"],
      ["range_operator", "-"],
      ["range_character", "d"],
      ["set_text", "xy"],
      ["set_close", "]"],
    ],
  ],
  [
    "edge hyphens are literal",
    "[-ab-]",
    [
      ["set_open", "["],
      ["set_text", "-ab-"],
      ["set_close", "]"],
    ],
  ],
  [
    "escaped range endpoint",
    "[\\a-z]",
    [
      ["set_open", "["],
      ["escape", "\\a"],
      ["range_operator", "-"],
      ["range_character", "z"],
      ["set_close", "]"],
    ],
  ],
  [
    "escaped set close",
    "[a\\]b]",
    [
      ["set_open", "["],
      ["set_text", "a"],
      ["escape", "\\]"],
      ["set_text", "b"],
      ["set_close", "]"],
    ],
  ],
  [
    "character class",
    "[[:digit:]]",
    [
      ["set_open", "["],
      ["[", "["],
      [":", ":"],
      ["class_name", "digit"],
      [":", ":"],
      ["]", "]"],
      ["set_close", "]"],
    ],
  ],
  [
    "range upper bracket takes precedence over a class prefix",
    "[a-[:digit:]]",
    [
      ["set_open", "["],
      ["range_character", "a"],
      ["range_operator", "-"],
      ["range_character", "["],
      ["set_text", ":digit:"],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "class after a completed range remains independent",
    "[a-b-[:digit:]]",
    [
      ["set_open", "["],
      ["range_character", "a"],
      ["range_operator", "-"],
      ["range_character", "b"],
      ["set_text", "-"],
      ["[", "["],
      [":", ":"],
      ["class_name", "digit"],
      [":", ":"],
      ["]", "]"],
      ["set_close", "]"],
    ],
  ],
  [
    "dot bracket notation is ordinary set text",
    "[[.ch.]]",
    [
      ["set_open", "["],
      ["set_text", "[.ch."],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "equal bracket notation is ordinary set text",
    "[[=a=]]",
    [
      ["set_open", "["],
      ["set_text", "[=a="],
      ["set_close", "]"],
      ["glob_literal", "]"],
    ],
  ],
  [
    "class closes at its first colon bracket pair",
    "[[:a[::][.b:]c.][:d:]",
    [
      ["set_open", "["],
      ["[", "["],
      [":", ":"],
      ["class_name", "a[:"],
      [":", ":"],
      ["]", "]"],
      ["set_text", "[.b:"],
      ["set_close", "]"],
      ["glob_literal", "c.]"],
      ["set_open", "["],
      ["set_text", ":d:"],
      ["set_close", "]"],
    ],
  ],
];
for (const [name, source, expected, structure] of validCases) {
  test(`gitignore: ${name}`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), []);
    assert.deepEqual(leaves(source, tree), expected);
    if (structure) {
      assert.deepEqual(
        tree.map(({ kind, field, parent, start, end }) => [
          kind,
          field,
          parent,
          start,
          end,
        ]),
        structure,
      );
    }
  });
}

test("gitignore: empty document has no invented line", () => {
  assert.deepEqual(parse(""), [
    { kind: "document", field: null, start: 0, end: 0, parent: null },
  ]);
});

test("gitignore: CR and NUL boundaries retain their complete source range", () => {
  for (const source of ["a\r", "a\r\0b", "a\0b\nc"]) {
    const tree = parse(source);
    assert.equal(tree[0].start, 0);
    assert.equal(tree[0].end, Buffer.byteLength(source));
    assert.equal(
      leaves(source, tree)
        .map(([, text]) => text)
        .join(""),
      source,
    );
  }
});

const invalidCases = [
  [
    "NUL fixes the missing set close before EOF",
    "[a\0]",
    [["invalid_syntax", "missing_set_close", 2, 2]],
    ["character_set"],
  ],
  [
    "NUL fixes an unfinished escape before EOF",
    "a\\\0b",
    [["invalid_syntax", "incomplete_escape", 1, 2]],
    ["pattern"],
  ],
  [
    "EOF CR leaves an unfinished escape incomplete",
    "a\\\r",
    [["incomplete_syntax", "incomplete_escape", 1, 2]],
    ["pattern"],
  ],
  [
    "EOF CR leaves an unfinished set incomplete",
    "[a\r",
    [["incomplete_syntax", "missing_set_close", 2, 2]],
    ["character_set"],
  ],
  [
    "empty class does not close its outer set",
    "[[::]",
    [["incomplete_syntax", "missing_set_close", 5, 5]],
    ["character_set"],
  ],
  [
    "decode failure inside ignored suffix remains visible",
    Buffer.from([97, 0, 255, 98]),
    [["invalid_syntax", "invalid_encoding", 2, 3]],
    ["ignored_suffix"],
  ],
  [
    "unclosed set before trailing spaces at EOF stays incomplete",
    "[abc  ",
    [["incomplete_syntax", "missing_set_close", 4, 4]],
    ["character_set"],
  ],
  [
    "unclosed set before trailing spaces and LF is invalid",
    "[abc  \n",
    [["invalid_syntax", "missing_set_close", 4, 4]],
    ["character_set"],
  ],
  [
    "unclosed set before trailing spaces and CRLF is invalid",
    "[abc  \r\n",
    [["invalid_syntax", "missing_set_close", 4, 4]],
    ["character_set"],
  ],
  [
    "class closing bracket does not also close its set",
    "a[:[:[:]\n",
    [["invalid_syntax", "missing_set_close", 8, 8]],
    ["character_set"],
  ],
  [
    "unclosed set at EOF",
    "x[abc",
    [["incomplete_syntax", "missing_set_close", 5, 5]],
    ["character_set"],
  ],
  [
    "unclosed set at line end",
    "[abc\nnext",
    [["invalid_syntax", "missing_set_close", 4, 4]],
    ["character_set"],
  ],
  [
    "leading close remains a member of an incomplete set",
    "[]",
    [["incomplete_syntax", "missing_set_close", 2, 2]],
    ["character_set"],
  ],
  [
    "wildcards inside an incomplete set remain set text",
    "x[a*?",
    [["incomplete_syntax", "missing_set_close", 5, 5]],
    ["character_set"],
  ],
  [
    "set and trailing escape are independently incomplete",
    "[a\\",
    [
      ["incomplete_syntax", "incomplete_escape", 2, 3],
      ["incomplete_syntax", "missing_set_close", 3, 3],
    ],
    ["character_set", "character_set"],
  ],
  [
    "escape at EOF",
    "foo\\",
    [["incomplete_syntax", "incomplete_escape", 3, 4]],
    ["pattern"],
  ],
  [
    "escape before LF recovers the next line",
    "foo\\\nnext\n",
    [["invalid_syntax", "incomplete_escape", 3, 4]],
    ["pattern"],
  ],
  [
    "escape before CRLF",
    "\\\r\n",
    [["invalid_syntax", "incomplete_escape", 0, 1]],
    ["pattern"],
  ],
  [
    "decode failure within literal",
    Buffer.from([97, 255, 98]),
    [["invalid_syntax", "invalid_encoding", 1, 2]],
    ["pattern"],
  ],
  [
    "decode failure within comment",
    Buffer.from([35, 255, 98]),
    [["invalid_syntax", "invalid_encoding", 1, 2]],
    ["comment"],
  ],
  [
    "decode failure after escape",
    Buffer.from([92, 255, 98]),
    [["invalid_syntax", "invalid_encoding", 1, 2]],
    ["pattern"],
  ],
  [
    "decode failure stays inside the character set",
    Buffer.from([91, 97, 255, 93]),
    [["invalid_syntax", "invalid_encoding", 2, 3]],
    ["character_set"],
  ],
];
for (const [name, source, expected, owner] of invalidCases) {
  test(`gitignore: ${name}`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), expected);
    assert.deepEqual(owners(tree), owner);
    for (const node of tree.filter(({ kind }) => kind === "syntax_issue"))
      assert.equal(node.field, "issue");
  });
}

const compoundCases = [
  [
    "class delimiters",
    "[[:digit:]]",
    "character_class",
    [
      ["[", null, 1, 2],
      [":", null, 2, 3],
      ["class_name", "name", 3, 8],
      [":", null, 8, 9],
      ["]", null, 9, 10],
    ],
  ],
  [
    "dot bracket text preserves Unicode byte ranges",
    "[[.é.]]",
    "character_set",
    [
      ["set_open", "opening", 0, 1],
      ["set_text", null, 1, 6],
      ["set_close", "closing", 6, 7],
    ],
  ],
  [
    "equal bracket text preserves set boundaries",
    "[[=a=]]",
    "character_set",
    [
      ["set_open", "opening", 0, 1],
      ["set_text", null, 1, 5],
      ["set_close", "closing", 5, 6],
    ],
  ],
];
for (const [name, source, owner, expected] of compoundCases) {
  test(`gitignore: ${name} retain direct children and original byte ranges`, () => {
    const nodes = parse(source);
    assert.deepEqual(issues(nodes), []);
    const index = nodes.findIndex(({ kind }) => kind === owner);
    assert.notEqual(index, -1);
    assert.deepEqual(
      nodes
        .filter(({ parent }) => parent === index)
        .map(({ kind, field, start, end }) => [kind, field, start, end]),
      expected,
    );
    assert.deepEqual(
      [nodes[index].start, nodes[index].end],
      [expected[0][2], expected.at(-1)[3]],
    );
  });
}

test("gitignore: compound delimiters are anonymous and have no opening or closing fields", () => {
  for (const type of ["[", "]", ":"]) {
    assert.equal(nodeTypes.find((node) => node.type === type)?.named, false);
  }
  for (const type of ["character_class"]) {
    const node = nodeTypes.find((node) => node.type === type);
    assert.deepEqual(Object.keys(node.fields), ["issue", "name"]);
  }
});

test("gitignore: Git runtime checks the documented supplementary cases", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "git-syntax-reference-"));
  const run = (args, input = "") =>
    spawnSync("git", ["-c", "core.ignoreCase=false", ...args], {
      cwd: directory,
      input,
      encoding: "utf8",
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_ATTR_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(directory, "absent-config"),
      },
    });
  try {
    const version = run(["--version"]);
    assert.equal(version.status, 0, version.stderr);
    t.diagnostic(
      `Supplementary behavior established with Git 2.55.0; checked with ${version.stdout.trim()}`,
    );
    assert.equal(run(["init", "--quiet"]).status, 0);
    const cases = [
      [
        "[a-[:digit:]]",
        ["a", "1", "-", "a]", "d]", ":]", "1]"],
        ["a]", "d]", ":]"],
      ],
      ["[A-[:digit:]]", ["A]", "Z]", "[]", "1"], ["A]", "Z]", "[]"]],
      ["[]-[:digit:]]", ["]]", "d]", "1"], ["]]", "d]"]],
      ["[a-b-[:digit:]]", ["a", "b", "-", "1", "d]"], ["a", "b", "-", "1"]],
      ["[[:alpha:]A-[:digit:]]", ["a]", "Z]", "1"], ["a]", "Z]"]],
      [
        "[[:a-\\]-[:digit:]]",
        ["1", "[", "a", "-", "1]", "d]"],
        ["1", "[", "a", "-"],
      ],
      ["[\\A-[:digit:]]", ["A]", "Z]", "1"], ["A]", "Z]"]],
      ["[A-\\[:digit:]]", ["A]", "Z]", "1"], ["A]", "Z]"]],
      ["[[:]]", ["a", "[]", ":]"], ["[]", ":]"]],
      ["[[::]]", ["a", "[]", ":]"], []],
      ["[a[::]]", ["a", "[]", ":]"], []],
      ["[![::]]", ["a", "[]", ":]"], []],
      ["[[:unknown:]]", ["a", "[]", ":]"], []],
      ["[a[:unknown:]]", ["a", "[]", ":]"], []],
      ["[![:unknown:]]", ["a", "[]", ":]"], []],
      ["a/***/b", ["a/b", "a/x/b", "a/x/y/b"], ["a/b", "a/x/b", "a/x/y/b"]],
      ["a\rb", ["a", "ab", "a\rb"], ["a\rb"]],
      ["a\r", ["a", "a\r"], ["a"], ""],
      ["a\r\r", ["a", "a\r", "a\r\r"], ["a\r"], ""],
      ["a \r", ["a", "a ", "a\r"], ["a"], ""],
      ["a\r ", ["a", "a\r"], ["a\r"], ""],
      ["a\0b", ["a", "ab", "b"], ["a"], ""],
      ["a\r\0b", ["a", "a\r"], ["a\r"], ""],
      ["a \0b", ["a", "a "], ["a"], ""],
      ["\0a\nb", ["a", "b"], ["b"], ""],
      ["[a\0]\nb", ["a", "b", "[a"], ["b"], ""],
      ["a\0b\nc", ["a", "ab", "b", "c"], ["a", "c"], ""],
      ["[^a]", ["a", "b", "^"], ["b", "^"]],
      ["[a^]", ["a", "b", "^"], ["a", "^"]],
      ["[[.a.]]", ["a", "a]", ".]"], ["a]", ".]"]],
      ["[[=a=]]", ["a", "a]", "=]"], ["a]", "=]"]],
      ["[[:digit]]", ["d", "d]", ":]"], ["d]", ":]"]],
      ["[[:digit:]]", ["a", "1", "1]"], ["1"]],
      ["[abc", ["a", "[abc"], []],
      ["[]", ["]", "[]"], []],
    ];
    for (const [pattern, paths, expected, ending = "\n"] of cases) {
      writeFileSync(join(directory, ".gitignore"), pattern + ending);
      const result = run(
        ["check-ignore", "--no-index", "-z", "--stdin"],
        `${paths.map((path) => `./${path}`).join("\0")}\0`,
      );
      assert.equal(
        result.status,
        expected.length ? 0 : 1,
        pattern + result.stderr,
      );
      assert.deepEqual(
        result.stdout
          .split("\0")
          .filter(Boolean)
          .map((path) => path.slice(2)),
        expected,
        pattern,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const largeInputCases = [
  ["many independent lines", "!**/node_modules/\n".repeat(10000), 0],
  ["one long literal", "a".repeat(200000), 0],
  ["many unmatched open brackets", "[".repeat(50000), 1],
  ["many incomplete class prefixes", `${"[:".repeat(16000)}]`, 1],
  ["many complete character sets", "[a-z]".repeat(10000), 0],
  ["many unmatched brackets before a class", `${"[".repeat(50000)}[:x]`, 0],
  ["many unclosed brackets holding classes", "[[:x:]".repeat(20000), 1],
  ["many independently invalid escapes", "a\\\n".repeat(10000), 10000],
  ["many mixed named item prefixes", `${"[:[.[=".repeat(80000)}]`, 0],
];
for (const [name, source, expectedIssues] of largeInputCases) {
  test(`gitignore: large input: ${name}`, () => {
    const tree = parse(source);
    assert.equal(issues(tree).length, expectedIssues);
  });
}
