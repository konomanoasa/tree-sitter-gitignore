import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import nodeTypes from "../src/node-types.json" with { type: "json" };
import { issues, leaves, owners, parseCst } from "./support/cst.js";
import { parse } from "./support/parser.js";

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    for (const attribute of attributes) {
      assert.ok(
        attribute === ":cst" || attribute === ":error",
        `unsupported corpus attribute: ${attribute}`,
      );
    }
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source });
  }
  return cases;
}

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source } of entries) {
    test(`gitignore: corpus source coverage issue structure and fresh determinism: ${file}: ${name}`, () => {
      const tree = parse(source);
      issues(tree);
      const content = source.startsWith("\uFEFF") ? source.slice(1) : source;
      assert.equal(
        tree[0].start,
        Buffer.byteLength(source) - Buffer.byteLength(content),
      );
      assert.equal(
        leaves(source, tree)
          .map(([, text]) => text)
          .join(""),
        content,
      );
      for (const node of tree.filter(({ kind }) => kind === "syntax_issue")) {
        assert.equal(node.field, "issue");
      }
      assert.deepEqual(parse(source), tree);
    });
  }
}

test("gitignore: corpus inputs retain BOM NUL whitespace and line endings", () => {
  const text = [
    "==================\nEmpty\n==================\n\n---\n(document)\n\n",
    "==================\nLayout\n:cst\n==================\n",
    "\uFEFF \t\v\f\r\na=b\n\n\n---\nignored output\n\n",
    "==================\nNUL\n:cst\n==================\n",
    "\0=\0\n---\nignored output\n\n",
    "==================\nFinal CR\n:cst\n==================\n",
    "a=b\r\r\n---\nignored output\n",
  ].join("");
  assert.deepEqual(parseCorpus(text), [
    { name: "Empty", source: "" },
    { name: "Layout", source: "\uFEFF \t\v\f\r\na=b\n\n" },
    { name: "NUL", source: "\0=\0" },
    { name: "Final CR", source: "a=b\r" },
  ]);
});

test("gitignore: corpus input reader rejects unsupported conditions and framing", () => {
  for (const text of [
    "not a corpus file",
    "==================\nUnclosed header\n",
    "==================\nSkipped\n:skip\n==================\na=b\n---\n",
    "==================\nNo separator\n==================\na=b\n",
  ]) {
    assert.throws(() => parseCorpus(text), { code: "ERR_ASSERTION" }, text);
  }
});

test("gitignore: public issue nodes have one outcome and one reason leaf", () => {
  const issue = nodeTypes.find(({ type }) => type === "syntax_issue");
  assert.ok(issue);
  assert.ok(issue.children);
  assert.equal(issue.children.required, true);
  assert.equal(issue.children.multiple, false);
  assert.deepEqual(
    issue.children.types.map(({ type }) => type),
    ["incomplete_syntax", "invalid_syntax"],
  );
  for (const { type } of issue.children.types) {
    const outcome = nodeTypes.find((node) => node.type === type);
    assert.ok(outcome, type);
    assert.ok(outcome.children, type);
    assert.equal(outcome.children.required, true);
    assert.equal(outcome.children.multiple, false);
    for (const child of outcome.children.types) {
      const reason = nodeTypes.find((node) => node.type === child.type);
      assert.ok(reason, child.type);
      assert.equal(reason.children, undefined);
    }
  }
});

test("gitignore: compound delimiters are anonymous and have no opening or closing fields", () => {
  for (const type of ["[", "]", ":"]) {
    assert.equal(nodeTypes.find((node) => node.type === type)?.named, false);
  }
  for (const type of ["character_class"]) {
    const node = nodeTypes.find((node) => node.type === type);
    assert.ok(node, type);
    assert.ok(node.fields, type);
    assert.deepEqual(Object.keys(node.fields), ["issue", "name"]);
  }
});

const largeInputCounts = {
  lines: 10_000,
  literalCharacters: 200_000,
};
const largeInputCases = [
  [
    "many independent lines",
    "!**/node_modules/\n".repeat(largeInputCounts.lines),
    0,
  ],
  ["one long literal", "a".repeat(largeInputCounts.literalCharacters), 0],
];
for (const [name, source, expectedIssues] of largeInputCases) {
  test(`gitignore: large input: ${name}`, () => {
    const tree = parse(source);
    assert.equal(issues(tree).length, expectedIssues);
  });
}

const encodingCases = [
  [
    "decode failure inside ignored suffix remains visible",
    Buffer.from([97, 0, 255, 98]),
    [["invalid_syntax", "invalid_encoding", 2, 3]],
    ["ignored_suffix"],
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
  [
    "consecutive decode failures form one pattern issue",
    Buffer.from([97, 255, 254, 128, 98]),
    [["invalid_syntax", "invalid_encoding", 1, 4]],
    ["pattern"],
  ],
  [
    "consecutive decode failures stop before the comment line ending",
    Buffer.from([35, 255, 254, 13, 10, 97]),
    [["invalid_syntax", "invalid_encoding", 1, 3]],
    ["comment"],
  ],
  [
    "consecutive decode failures stop before the set close",
    Buffer.from([91, 97, 255, 254, 93]),
    [["invalid_syntax", "invalid_encoding", 2, 4]],
    ["character_set"],
  ],
  [
    "consecutive decode failures stop before the class close",
    Buffer.from([91, 91, 58, 100, 255, 254, 58, 93, 93]),
    [["invalid_syntax", "invalid_encoding", 4, 6]],
    ["character_class"],
  ],
  [
    "consecutive decode failures in an ignored suffix remain one issue",
    Buffer.from([97, 0, 255, 254, 98]),
    [["invalid_syntax", "invalid_encoding", 2, 4]],
    ["ignored_suffix"],
  ],
  [
    "a backslash before consecutive decode failures adds no escape issue",
    Buffer.from([92, 255, 254, 98]),
    [["invalid_syntax", "invalid_encoding", 1, 3]],
    ["pattern"],
  ],
  [
    "a set backslash before consecutive decode failures adds no escape issue",
    Buffer.from([91, 92, 255, 254, 93]),
    [["invalid_syntax", "invalid_encoding", 2, 4]],
    ["character_set"],
  ],
  [
    "a truncated UTF-8 sequence at EOF is an invalid encoding run",
    Buffer.from([97, 226, 130]),
    [["invalid_syntax", "invalid_encoding", 1, 3]],
    ["pattern"],
  ],
  [
    "a decoded replacement character separates invalid encoding runs",
    Buffer.from([255, 254, 239, 191, 189, 128, 129]),
    [
      ["invalid_syntax", "invalid_encoding", 0, 2],
      ["invalid_syntax", "invalid_encoding", 5, 7],
    ],
    ["pattern", "pattern"],
  ],
  [
    "NUL separates decode failures owned by a pattern and its ignored suffix",
    Buffer.from([255, 254, 0, 128, 129]),
    [
      ["invalid_syntax", "invalid_encoding", 0, 2],
      ["invalid_syntax", "invalid_encoding", 3, 5],
    ],
    ["pattern", "ignored_suffix"],
  ],
  [
    "decode failures and a missing set close are independent at EOF",
    Buffer.from([91, 255, 254]),
    [
      ["invalid_syntax", "invalid_encoding", 1, 3],
      ["incomplete_syntax", "missing_set_close", 3, 3],
    ],
    ["character_set", "character_set"],
  ],
];
for (const [name, source, expected, owner] of encodingCases) {
  test(`gitignore: ${name}`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), expected);
    assert.deepEqual(owners(tree), owner);
    for (const node of tree.filter(({ kind }) => kind === "syntax_issue"))
      assert.equal(node.field, "issue");
  });
}

test("gitignore: CST helpers preserve fields, anonymous nodes and UTF-8 ranges across CRLF", () => {
  const source = "é0123456789\r\n[[:x:]]";
  const text = [
    "0:0  - 1:7    document",
    "0:0  - 1:0      pattern",
    "0:0  - 0:12       glob_literal `é0123456789`",
    "0:12 - 1:0        line_ending",
    "0:12 - 0:14         `\\r\\n`",
    "1:0  - 1:7      pattern",
    "1:0  - 1:7        character_set",
    "1:0  - 1:1          opening: set_open `[`",
    "1:1  - 1:6          character_class",
    '1:1  - 1:2            "["',
    '1:2  - 1:3            ":"',
    "1:3  - 1:4            name: class_name `x`",
    '1:4  - 1:5            ":"',
    '1:5  - 1:6            "]"',
    "1:6  - 1:7          closing: set_close `]`",
  ].join("\n");
  const nodes = parseCst(text, source);
  assert.deepEqual(nodes, [
    { kind: "document", field: null, start: 0, end: 21, parent: null },
    { kind: "pattern", field: null, start: 0, end: 14, parent: 0 },
    { kind: "glob_literal", field: null, start: 0, end: 12, parent: 1 },
    { kind: "line_ending", field: null, start: 12, end: 14, parent: 1 },
    { kind: "pattern", field: null, start: 14, end: 21, parent: 0 },
    { kind: "character_set", field: null, start: 14, end: 21, parent: 4 },
    { kind: "set_open", field: "opening", start: 14, end: 15, parent: 5 },
    { kind: "character_class", field: null, start: 15, end: 20, parent: 5 },
    { kind: "[", field: null, start: 15, end: 16, parent: 7 },
    { kind: ":", field: null, start: 16, end: 17, parent: 7 },
    { kind: "class_name", field: "name", start: 17, end: 18, parent: 7 },
    { kind: ":", field: null, start: 18, end: 19, parent: 7 },
    { kind: "]", field: null, start: 19, end: 20, parent: 7 },
    { kind: "set_close", field: "closing", start: 20, end: 21, parent: 5 },
  ]);
  assert.equal(
    leaves(source, nodes)
      .map(([, text]) => text)
      .join(""),
    source,
  );
});

test("gitignore: CST helpers reject truncated roots and native recovery nodes", () => {
  assert.throws(() => parseCst("0:0 - 0:1   document", "ab"));
  for (const kind of ["ERROR", "MISSING"]) {
    const text = `0:0 - 0:1   document\n0:0 - 0:1     ${kind}`;
    assert.throws(() => parseCst(text, "a"));
  }
});
