import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { issues } from "./support/cst.js";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  parse,
} from "./support/parser.js";

test("gitignore: Git runtime checks the documented supplementary cases", (t) => {
  const relativePathPrefix = "./";
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
      `Supplementary behavior established with Git 2.55.0 (escaped-slash boundaries: Git 2.56.0); checked with ${version.stdout.trim()}`,
    );
    assert.equal(run(["init", "--quiet"]).status, 0);
    const cases = [
      {
        pattern: "x\\/**/b",
        paths: ["x/b", "x/y/b", "x/y/z/b"],
        expected: ["x/b", "x/y/b", "x/y/z/b"],
      },
      {
        pattern: "x/**\\/b",
        paths: ["x/b", "x/y/b", "x/y/z/b"],
        expected: ["x/y/b", "x/y/z/b"],
      },
      {
        pattern: "**\\/b",
        paths: ["b", "x/b", "x/y/b"],
        expected: ["x/b", "x/y/b"],
      },
      {
        pattern: "x\\/*/b",
        paths: ["x/b", "x/y/b", "x/y/z/b"],
        expected: ["x/y/b"],
      },
      {
        pattern: "x/*\\/b",
        paths: ["x/b", "x/y/b", "x/y/z/b"],
        expected: ["x/y/b"],
      },
      {
        pattern: "[a-[:digit:]]",
        paths: ["a", "1", "-", "a]", "d]", ":]", "1]"],
        expected: ["a]", "d]", ":]"],
      },
      {
        pattern: "[A-[:digit:]]",
        paths: ["A]", "Z]", "[]", "1"],
        expected: ["A]", "Z]", "[]"],
      },
      {
        pattern: "[]-[:digit:]]",
        paths: ["]]", "d]", "1"],
        expected: ["]]", "d]"],
      },
      {
        pattern: "[a-b-[:digit:]]",
        paths: ["a", "b", "-", "1", "d]"],
        expected: ["a", "b", "-", "1"],
      },
      {
        pattern: "[[:alpha:]A-[:digit:]]",
        paths: ["a]", "Z]", "1"],
        expected: ["a]", "Z]"],
      },
      {
        pattern: "[[:a-\\]-[:digit:]]",
        paths: ["1", "[", "a", "-", "1]", "d]"],
        expected: ["1", "[", "a", "-"],
      },
      {
        pattern: "[\\A-[:digit:]]",
        paths: ["A]", "Z]", "1"],
        expected: ["A]", "Z]"],
      },
      {
        pattern: "[A-\\[:digit:]]",
        paths: ["A]", "Z]", "1"],
        expected: ["A]", "Z]"],
      },
      { pattern: "[[:]]", paths: ["a", "[]", ":]"], expected: ["[]", ":]"] },
      { pattern: "[[::]]", paths: ["a", "[]", ":]"], expected: [] },
      { pattern: "[a[::]]", paths: ["a", "[]", ":]"], expected: [] },
      { pattern: "[![::]]", paths: ["a", "[]", ":]"], expected: [] },
      { pattern: "[[:unknown:]]", paths: ["a", "[]", ":]"], expected: [] },
      { pattern: "[a[:unknown:]]", paths: ["a", "[]", ":]"], expected: [] },
      { pattern: "[![:unknown:]]", paths: ["a", "[]", ":]"], expected: [] },
      {
        pattern: "a/***/b",
        paths: ["a/b", "a/x/b", "a/x/y/b"],
        expected: ["a/b", "a/x/b", "a/x/y/b"],
      },
      { pattern: "a\rb", paths: ["a", "ab", "a\rb"], expected: ["a\rb"] },
      { pattern: "a\r", paths: ["a", "a\r"], expected: ["a"], ending: "" },
      {
        pattern: "a\r\r",
        paths: ["a", "a\r", "a\r\r"],
        expected: ["a\r"],
        ending: "",
      },
      {
        pattern: "a \r",
        paths: ["a", "a ", "a\r"],
        expected: ["a"],
        ending: "",
      },
      { pattern: "a\r ", paths: ["a", "a\r"], expected: ["a\r"], ending: "" },
      { pattern: "a\0b", paths: ["a", "ab", "b"], expected: ["a"], ending: "" },
      { pattern: "a\r\0b", paths: ["a", "a\r"], expected: ["a\r"], ending: "" },
      { pattern: "a \0b", paths: ["a", "a "], expected: ["a"], ending: "" },
      { pattern: "\0a\nb", paths: ["a", "b"], expected: ["b"], ending: "" },
      {
        pattern: "[a\0]\nb",
        paths: ["a", "b", "[a"],
        expected: ["b"],
        ending: "",
      },
      {
        pattern: "a\0b\nc",
        paths: ["a", "ab", "b", "c"],
        expected: ["a", "c"],
        ending: "",
      },
      { pattern: "[^a]", paths: ["a", "b", "^"], expected: ["b", "^"] },
      { pattern: "[a^]", paths: ["a", "b", "^"], expected: ["a", "^"] },
      { pattern: "[[.a.]]", paths: ["a", "a]", ".]"], expected: ["a]", ".]"] },
      { pattern: "[[=a=]]", paths: ["a", "a]", "=]"], expected: ["a]", "=]"] },
      {
        pattern: "[[:digit]]",
        paths: ["d", "d]", ":]"],
        expected: ["d]", ":]"],
      },
      { pattern: "[[:digit:]]", paths: ["a", "1", "1]"], expected: ["1"] },
      { pattern: "[abc", paths: ["a", "[abc"], expected: [] },
      { pattern: "[]", paths: ["]", "[]"], expected: [] },
    ];
    for (const { pattern, paths, expected, ending = "\n" } of cases) {
      writeFileSync(join(directory, ".gitignore"), pattern + ending);
      const result = run(
        ["check-ignore", "--no-index", "-z", "--stdin"],
        `${paths.map((path) => `${relativePathPrefix}${path}`).join("\0")}\0`,
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
          .map((path) => path.slice(relativePathPrefix.length)),
        expected,
        pattern,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const largeInputCounts = {
  lines: 10_000,
  literalCharacters: 200_000,
  unmatchedBrackets: 50_000,
  incompleteClassPrefixes: 16_000,
  characterSets: 10_000,
  unclosedClassPrefixes: 20_000,
  invalidEscapes: 10_000,
  mixedItemPrefixes: 80_000,
};
const largeInputCases = [
  [
    "many independent lines",
    "!**/node_modules/\n".repeat(largeInputCounts.lines),
    0,
  ],
  ["one long literal", "a".repeat(largeInputCounts.literalCharacters), 0],
  [
    "many unmatched open brackets",
    "[".repeat(largeInputCounts.unmatchedBrackets),
    1,
  ],
  [
    "many incomplete class prefixes",
    `${"[:".repeat(largeInputCounts.incompleteClassPrefixes)}]`,
    1,
  ],
  [
    "many complete character sets",
    "[a-z]".repeat(largeInputCounts.characterSets),
    0,
  ],
  [
    "many unmatched brackets before a class",
    `${"[".repeat(largeInputCounts.unmatchedBrackets)}[:x]`,
    0,
  ],
  [
    "many unclosed brackets holding classes",
    "[[:x:]".repeat(largeInputCounts.unclosedClassPrefixes),
    1,
  ],
  [
    "many independently invalid escapes",
    "a\\\n".repeat(largeInputCounts.invalidEscapes),
    largeInputCounts.invalidEscapes,
  ],
  [
    "many mixed named item prefixes",
    `${"[:[.[=".repeat(largeInputCounts.mixedItemPrefixes)}]`,
    0,
  ],
];
for (const [name, source, expectedIssues] of largeInputCases) {
  test(`gitignore: large input: ${name}`, () => {
    const tree = parse(source);
    assert.equal(issues(tree).length, expectedIssues);
  });
}

const editCases = [
  {
    name: "remove NUL and restore a set close",
    source: "[a\0b]",
    edits: [{ byte: 2, deleteBytes: 1, insert: "" }],
  },
  {
    name: "insert and remove a class name",
    source: "[[::]]",
    edits: [
      { byte: 3, deleteBytes: 0, insert: "digit" },
      { byte: 3, deleteBytes: 5, insert: "" },
    ],
  },
  {
    name: "turn the EOF CR into an interior character",
    source: "a\r",
    edits: [{ byte: 2, deleteBytes: 0, insert: "b" }],
  },
  {
    name: "turn the EOF CR into CRLF",
    source: "a\r",
    edits: [{ byte: 2, deleteBytes: 0, insert: "\n" }],
  },
  {
    name: "turn an interior CR into the EOF suffix",
    source: "a\rb",
    edits: [{ byte: 2, deleteBytes: 1, insert: "" }],
  },
  {
    name: "complete a set after trailing spaces and remove its close",
    source: "[abc  ",
    edits: [
      { byte: 6, deleteBytes: 0, insert: "]" },
      { byte: 6, deleteBytes: 1, insert: "" },
    ],
  },
  {
    name: "terminate and reopen a set after trailing spaces",
    source: "[abc  ",
    edits: [
      { byte: 6, deleteBytes: 0, insert: "\n" },
      { byte: 6, deleteBytes: 1, insert: "" },
    ],
  },
  {
    name: "change a class into a range upper bracket and back",
    source: "[a[:digit:]]",
    edits: [
      { byte: 2, deleteBytes: 0, insert: "-" },
      { byte: 2, deleteBytes: 1, insert: "" },
    ],
  },
  {
    name: "replace class delimiters with ordinary equal signs",
    source: "[[:digit:]]",
    edits: [
      { byte: 2, deleteBytes: 1, insert: "=" },
      { byte: 8, deleteBytes: 1, insert: "=" },
    ],
  },
  {
    name: "delete and restore a bracket inside a set",
    source: "[[.a.]-[.z.]]",
    edits: [
      { byte: 7, deleteBytes: 1, insert: "" },
      { byte: 7, deleteBytes: 0, insert: "[" },
    ],
  },
  {
    name: "complete an escape",
    source: "a\\",
    edits: [{ byte: 2, deleteBytes: 0, insert: "*" }],
  },
  {
    name: "end an incomplete escape line",
    source: "a\\",
    edits: [{ byte: 2, deleteBytes: 0, insert: "\nnext" }],
  },
  {
    name: "complete an unclosed character set",
    source: "[abc",
    edits: [{ byte: 4, deleteBytes: 0, insert: "]" }],
  },
  {
    name: "reopen a set",
    source: "[abc]",
    edits: [{ byte: 4, deleteBytes: 1, insert: "" }],
  },
  {
    name: "change a comment to a pattern",
    source: "# abc",
    edits: [{ byte: 0, deleteBytes: 1, insert: "!" }],
  },
  {
    name: "insert negation before a recursive wildcard",
    source: "**/a",
    edits: [{ byte: 0, deleteBytes: 0, insert: "!" }],
  },
  {
    name: "change an asterisk context",
    source: "a**/",
    edits: [{ byte: 0, deleteBytes: 1, insert: "" }],
  },
  {
    name: "turn a range into literal text",
    source: "[a-z]",
    edits: [{ byte: 2, deleteBytes: 1, insert: "" }],
  },
  {
    name: "turn class into set text",
    source: "[[:alpha:]]",
    edits: [{ byte: 2, deleteBytes: 1, insert: "" }],
  },
  {
    name: "make trailing spaces significant",
    source: "a  ",
    edits: [{ byte: 3, deleteBytes: 0, insert: "b" }],
  },
];
for (const entry of editCases) {
  test(`gitignore: ${entry.name}`, () => {
    assertEditHistory(entry);
  });
}

const escapedSeparatorHistories = [
  {
    name: "change the escaped slash before double asterisk",
    source: "x\\/**/b",
    edits: [
      { byte: 2, deleteBytes: 1, insert: "a" },
      { byte: 2, deleteBytes: 1, insert: "/" },
      { byte: 1, deleteBytes: 1, insert: "" },
      { byte: 1, deleteBytes: 0, insert: "\\" },
    ],
    expected: [
      "wildcard",
      "recursive_wildcard",
      "recursive_wildcard",
      "recursive_wildcard",
    ],
  },
  {
    name: "change the escaped slash after double asterisk",
    source: "x/**b",
    edits: [
      { byte: 4, deleteBytes: 0, insert: "\\/" },
      { byte: 5, deleteBytes: 1, insert: "a" },
      { byte: 5, deleteBytes: 1, insert: "/" },
      { byte: 4, deleteBytes: 1, insert: "" },
    ],
    expected: [
      "recursive_wildcard",
      "wildcard",
      "recursive_wildcard",
      "recursive_wildcard",
    ],
  },
  {
    name: "change backslash parity before the following slash",
    source: "x/**\\/b",
    edits: [
      { byte: 4, deleteBytes: 0, insert: "\\" },
      { byte: 4, deleteBytes: 1, insert: "" },
    ],
    expected: ["wildcard", "recursive_wildcard"],
  },
  {
    name: "extend and restore the double asterisk run",
    source: "x\\/**\\/b",
    edits: [
      { byte: 3, deleteBytes: 0, insert: "*" },
      { byte: 3, deleteBytes: 1, insert: "" },
    ],
    expected: ["wildcard", "recursive_wildcard"],
  },
];
for (const { name, source, edits, expected } of escapedSeparatorHistories) {
  test(`gitignore: ${name}`, () => {
    for (let length = 1; length <= edits.length; length++) {
      const history = edits.slice(0, length);
      const incremental = assertIncrementalEqualsFresh(
        source,
        history,
        applyEdits(source, history),
      );
      assert.deepEqual(issues(incremental), []);
      assert.deepEqual(
        incremental
          .filter(
            ({ kind }) => kind === "wildcard" || kind === "recursive_wildcard",
          )
          .map(({ kind }) => kind),
        [expected[length - 1]],
      );
    }
  });
}
