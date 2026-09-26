import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parse } from "./support/parser.js";

const histories = [
  [
    "remove NUL and restore a set close",
    "[a\0b]",
    [{ byte: 2, deleteBytes: 1, insert: "" }],
  ],
  [
    "split an ignored suffix into a new physical line",
    "a\0*[b]",
    [{ byte: 2, deleteBytes: 0, insert: "\n" }],
  ],
  [
    "insert and remove a class name",
    "[[::]]",
    [
      { byte: 3, deleteBytes: 0, insert: "digit" },
      { byte: 3, deleteBytes: 5, insert: "" },
    ],
  ],
  [
    "turn the EOF CR into an interior character",
    "a\r",
    [{ byte: 2, deleteBytes: 0, insert: "b" }],
  ],
  [
    "turn the EOF CR into CRLF",
    "a\r",
    [{ byte: 2, deleteBytes: 0, insert: "\n" }],
  ],
  [
    "turn an interior CR into the EOF suffix",
    "a\rb",
    [{ byte: 2, deleteBytes: 1, insert: "" }],
  ],
  [
    "complete a set after trailing spaces and remove its close",
    "[abc  ",
    [
      { byte: 6, deleteBytes: 0, insert: "]" },
      { byte: 6, deleteBytes: 1, insert: "" },
    ],
  ],
  [
    "terminate and reopen a set after trailing spaces",
    "[abc  ",
    [
      { byte: 6, deleteBytes: 0, insert: "\n" },
      { byte: 6, deleteBytes: 1, insert: "" },
    ],
  ],
  [
    "change a class into a range upper bracket and back",
    "[a[:digit:]]",
    [
      { byte: 2, deleteBytes: 0, insert: "-" },
      { byte: 2, deleteBytes: 1, insert: "" },
    ],
  ],
  [
    "replace class delimiters with ordinary equal signs",
    "[[:digit:]]",
    [
      { byte: 2, deleteBytes: 1, insert: "=" },
      { byte: 8, deleteBytes: 1, insert: "=" },
    ],
  ],
  [
    "delete and restore a bracket inside a set",
    "[[.a.]-[.z.]]",
    [
      { byte: 7, deleteBytes: 1, insert: "" },
      { byte: 7, deleteBytes: 0, insert: "[" },
    ],
  ],
  ["complete an escape", "a\\", [{ byte: 2, deleteBytes: 0, insert: "*" }]],
  [
    "end an incomplete escape line",
    "a\\",
    [{ byte: 2, deleteBytes: 0, insert: "\nnext" }],
  ],
  [
    "complete an unclosed character set",
    "[abc",
    [{ byte: 4, deleteBytes: 0, insert: "]" }],
  ],
  ["reopen a set", "[abc]", [{ byte: 4, deleteBytes: 1, insert: "" }]],
  [
    "change a comment to a pattern",
    "# abc",
    [{ byte: 0, deleteBytes: 1, insert: "!" }],
  ],
  [
    "insert negation before a recursive wildcard",
    "**/a",
    [{ byte: 0, deleteBytes: 0, insert: "!" }],
  ],
  [
    "change an asterisk context",
    "a**/",
    [{ byte: 0, deleteBytes: 1, insert: "" }],
  ],
  [
    "turn a range into literal text",
    "[a-z]",
    [{ byte: 2, deleteBytes: 1, insert: "" }],
  ],
  [
    "turn class into set text",
    "[[:alpha:]]",
    [{ byte: 2, deleteBytes: 1, insert: "" }],
  ],
  ["split a UTF-8 character", "éx", [{ byte: 1, deleteBytes: 1, insert: "" }]],
  [
    "repair a decode failure",
    Buffer.from([97, 255, 98]),
    [{ byte: 1, deleteBytes: 1, insert: "é" }],
  ],
  [
    "turn CRLF into bare CR",
    "a\r\nb",
    [{ byte: 2, deleteBytes: 1, insert: "" }],
  ],
  [
    "insert BOM at the start",
    "a\n",
    [{ byte: 0, deleteBytes: 0, insert: "\uFEFF" }],
  ],
  [
    "remove a leading BOM",
    "\uFEFFa",
    [{ byte: 0, deleteBytes: 3, insert: "" }],
  ],
  [
    "make trailing spaces significant",
    "a  ",
    [{ byte: 3, deleteBytes: 0, insert: "b" }],
  ],
  [
    "break a multi-byte literal while keeping the character count",
    Buffer.from("\uFEFF\uFEFF!/a"),
    [{ byte: 4, deleteBytes: 3, insert: "é" }],
  ],
];
for (const [name, source, edits] of histories) {
  test(`gitignore: ${name}`, () => {
    for (let length = 1; length <= edits.length; length++) {
      const history = edits.slice(0, length);
      assert.deepEqual(
        parse(source, history),
        parse(applyEdits(source, history)),
      );
    }
  });
}

test("gitignore: fixed-seed generated histories preserve source structure and issue ranges", () => {
  let state = 0x731dac9;
  const next = (maximum) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
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
  for (let sample = 0; sample < 120; sample++) {
    const source = seeds[sample % seeds.length];
    let bytes = Buffer.from(source);
    const edits = [];
    for (let step = 0; step < 4; step++) {
      const byte = next(bytes.length + 1);
      const edit = {
        byte,
        deleteBytes: Math.min(next(4), bytes.length - byte),
        insert: alphabet[next(alphabet.length)],
      };
      edits.push(edit);
      bytes = applyEdits(bytes, [edit]);
      assert.deepEqual(
        parse(source, edits),
        parse(bytes),
        JSON.stringify({ source, edits }),
      );
    }
  }
});
