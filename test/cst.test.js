import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import nodeTypes from "../src/node-types.json" with { type: "json" };
import { hasError, leaves, parseCst } from "./support/cst.js";
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
    cases.push({ name, source, error: attributes.includes(":error") });
  }
  return cases;
}

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source, error } of entries) {
    test(`gitignore: corpus fresh determinism and normal source coverage: ${file}: ${name}`, () => {
      const tree = parse(source);
      assert.equal(hasError(tree), error);
      assert.deepEqual(parse(source), tree);
      if (error) return;
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
    { name: "Empty", source: "", error: false },
    { name: "Layout", source: "\uFEFF \t\v\f\r\na=b\n\n", error: false },
    { name: "NUL", source: "\0=\0", error: false },
    { name: "Final CR", source: "a=b\r", error: false },
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

test("gitignore: public metadata contains no custom diagnostics", () => {
  const diagnosticNodes = new Set([
    "syntax_issue",
    "invalid_syntax",
    "incomplete_syntax",
    "invalid_encoding",
    "incomplete_escape",
    "missing_set_close",
  ]);
  for (const node of nodeTypes) {
    assert.equal(diagnosticNodes.has(node.type), false, node.type);
    assert.equal(Object.hasOwn(node.fields ?? {}, "issue"), false, node.type);
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
    assert.deepEqual(Object.keys(node.fields), ["name"]);
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
    false,
  ],
  ["one long literal", "a".repeat(largeInputCounts.literalCharacters), false],
];
for (const [name, source, expectedError] of largeInputCases) {
  test(`gitignore: large input: ${name}`, () => {
    const tree = parse(source);
    assert.equal(hasError(tree), expectedError);
  });
}

const encodingCases = [
  ["ignored suffix", [97, 0, 255, 98]],
  ["literal", [97, 255, 98]],
  ["comment", [35, 255, 98]],
  ["escape", [92, 255, 98]],
  ["set", [91, 97, 255, 93]],
  ["class name", [91, 91, 58, 100, 255, 254, 58, 93, 93]],
  ["consecutive failures", [97, 255, 254, 128, 98]],
  ["failures before CRLF", [35, 255, 254, 13, 10, 97]],
  ["escaped failures in a set", [91, 92, 255, 254, 93]],
  ["truncated sequence at EOF", [97, 226, 130]],
  [
    "replacement character between failures",
    [255, 254, 239, 191, 189, 128, 129],
  ],
  ["NUL between failures", [255, 254, 0, 128, 129]],
  ["unclosed set", [91, 255, 254]],
];
for (const [name, bytes] of encodingCases) {
  test(`gitignore: rejects invalid UTF-8 in ${name} with deterministic fresh recovery`, () => {
    const source = Buffer.from(bytes);
    const tree = parse(source);
    assert.equal(hasError(tree), true);
    assert.deepEqual(parse(source), tree);
  });
}

test("gitignore: decoded replacement characters are ordinary source", () => {
  for (const source of ["�", "# �", "[�]", "[[:�:]]", "a\0�", "\\�"]) {
    const tree = parse(source);
    assert.equal(hasError(tree), false, source);
    assert.equal(
      leaves(source, tree)
        .map(([, text]) => text)
        .join(""),
      source,
    );
  }
});

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

test("gitignore: CST helpers reject truncated output and retain standard artifacts", () => {
  assert.throws(() => parseCst("0:0 - 0:1   document", "ab"));
  const root = parseCst("0:0 - 0:1   •ERROR", "a");
  assert.equal(root[0].kind, "ERROR");
  assert.equal(hasError(root), true);
  const nodes = parseCst(
    "0:0 - 0:1   •document\n0:1 - 0:1     closing: •set_close",
    "a",
  );
  assert.deepEqual(nodes[1], {
    kind: "MISSING set_close",
    field: "closing",
    start: 1,
    end: 1,
    parent: 0,
  });
  assert.equal(hasError(nodes), true);
});
