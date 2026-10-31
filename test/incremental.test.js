import assert from "node:assert/strict";
import { test } from "node:test";
import { hasError } from "./support/cst.js";
import {
  applyEdits,
  assertEditHistory,
  assertEditMatchesContract,
  parse,
} from "./support/parser.js";

const editCases = [
  {
    name: "split a UTF-8 character",
    source: "éx",
    edits: [{ byte: 1, deleteBytes: 1, insert: "" }],
  },
  {
    name: "repair a decode failure",
    source: Buffer.from([97, 255, 98]),
    edits: [{ byte: 1, deleteBytes: 1, insert: "é" }],
  },
  {
    name: "insert BOM at the start",
    source: "a\n",
    edits: [{ byte: 0, deleteBytes: 0, insert: "\uFEFF" }],
  },
  {
    name: "remove a leading BOM",
    source: "\uFEFFa",
    edits: [{ byte: 0, deleteBytes: 3, insert: "" }],
  },
  {
    name: "break a multi-byte literal while keeping the character count",
    source: Buffer.from("\uFEFF\uFEFF!/a"),
    edits: [{ byte: 4, deleteBytes: 3, insert: "é" }],
  },
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
  {
    name: "split an ignored suffix into a new physical line",
    source: "a\0*[b]",
    edits: [{ byte: 2, deleteBytes: 0, insert: "\n" }],
  },
  {
    name: "turn CRLF into bare CR",
    source: "a\r\nb",
    edits: [{ byte: 2, deleteBytes: 1, insert: "" }],
  },
];
for (const entry of editCases) {
  test(`gitignore: ${entry.name}`, () => {
    assertEditHistory(entry);
  });
}

const encodingHistories = [
  {
    name: "split and merge a decode failure run with a valid character",
    source: Buffer.from([97, 255, 254, 128, 98]),
    edits: [
      { byte: 2, deleteBytes: 0, insert: "é" },
      { byte: 2, deleteBytes: 2, insert: "" },
      { byte: 1, deleteBytes: 3, insert: "x" },
    ],
    expectedError: [true, true, false],
  },
  {
    name: "close and reopen a set between undecodable bytes",
    source: Buffer.from([91, 255, 254, 128]),
    edits: [
      { byte: 2, deleteBytes: 0, insert: "]" },
      { byte: 2, deleteBytes: 1, insert: "" },
    ],
    expectedError: [true, true],
  },
  {
    name: "repair a decode failure after a set backslash",
    source: Buffer.from([91, 92, 255, 254, 93]),
    edits: [{ byte: 2, deleteBytes: 2, insert: "a" }],
    expectedError: [false],
  },
];
for (const { name, source, edits, expectedError } of encodingHistories) {
  test(`gitignore: ${name}`, () => {
    for (let length = 1; length <= edits.length; length++) {
      const history = edits.slice(0, length);
      assertEditMatchesContract(source, history, applyEdits(source, history));
      assert.equal(
        hasError(parse(applyEdits(source, history))),
        expectedError[length - 1],
      );
    }
  });
}

for (const [owner, prefix, suffix] of [
  ["pattern", "a", "b"],
  ["comment", "# a", "b"],
  ["set", "[a", "]"],
  ["ignored suffix", "a\u0000", "b"],
]) {
  test(`gitignore: splitting and repairing UTF-8 characters in ${owner}`, () => {
    const source = Buffer.concat([
      Buffer.from(prefix),
      Buffer.from([255]),
      Buffer.from(`é${suffix}`),
    ]);
    const edits = [
      { byte: Buffer.byteLength(prefix) + 2, deleteBytes: 1, insert: "" },
    ];
    edits.push({
      byte: Buffer.byteLength(prefix),
      deleteBytes: 2,
      insert: "é",
    });
    assertEditHistory({ source, edits });
    assert.equal(hasError(parse(applyEdits(source, edits))), false);
  });
}

test("gitignore: fixed-seed generated histories preserve fresh determinism and repaired CST", () => {
  const seed = 0x731dac9;
  const historyCount = 120;
  const editsPerHistory = 4;
  const maxDeletedBytes = 3;
  const lcgMultiplier = 1_664_525;
  const lcgIncrement = 1_013_904_223;
  let state = seed;
  const next = (maximum) => {
    state = (Math.imul(state, lcgMultiplier) + lcgIncrement) >>> 0;
    return state % maximum;
  };
  const alphabet = "ab []!:.*?\\/\n\r\t-^=é";
  const seeds = [
    "",
    "# comment\n!**/a\n",
    "[a-z]  \r\n",
    "[[:alpha:]]",
    "foo\\",
    "[[.ch.]-z]",
    "[[::]]\r",
    "[a\0]ignored\nnext",
  ];
  for (let sample = 0; sample < historyCount; sample++) {
    const source = seeds[sample % seeds.length];
    let bytes = Buffer.from(source);
    const edits = [];
    for (let step = 0; step < editsPerHistory; step++) {
      const byte = next(bytes.length + 1);
      const edit = {
        byte,
        deleteBytes: Math.min(next(maxDeletedBytes + 1), bytes.length - byte),
        insert: alphabet[next(alphabet.length)],
      };
      edits.push(edit);
      bytes = applyEdits(bytes, [edit]);
      assertEditMatchesContract(source, edits, bytes);
    }
    const repaired = "!**/[a-z]\n";
    edits.push({ byte: 0, deleteBytes: bytes.length, insert: repaired });
    assert.equal(
      hasError(assertEditMatchesContract(source, edits, repaired)),
      false,
    );
  }
});
