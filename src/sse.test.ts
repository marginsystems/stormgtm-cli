import { test } from "node:test";
import assert from "node:assert/strict";
import { SseDecoder } from "./sse.js";

function decodeAll(chunks: string[]): string[] {
  const decoder = new SseDecoder();
  return [...chunks.flatMap((chunk) => decoder.push(chunk)), ...decoder.flush()];
}

test("reads several frames from one chunk", () => {
  assert.deepEqual(decodeAll(['data: {"type":"status"}\n\ndata: {"type":"done"}\n\n']), ['{"type":"status"}', '{"type":"done"}']);
});

test("joins frames split across chunks at any point", () => {
  const stream = 'data: {"type":"delta","text":"hi"}\n\ndata: {"type":"done"}\n\n';
  for (let cut = 1; cut < stream.length; cut++) {
    assert.deepEqual(decodeAll([stream.slice(0, cut), stream.slice(cut)]), ['{"type":"delta","text":"hi"}', '{"type":"done"}'], `cut at ${cut}`);
  }
});

test("handles CRLF line endings, including a CR and LF in different chunks", () => {
  const stream = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n';
  assert.deepEqual(decodeAll([stream]), ['{"a":1}', '{"b":2}']);
  for (let cut = 1; cut < stream.length; cut++) {
    assert.deepEqual(decodeAll([stream.slice(0, cut), stream.slice(cut)]), ['{"a":1}', '{"b":2}'], `cut at ${cut}`);
  }
  assert.deepEqual(decodeAll(["data: x\r", "\r", "data: y\r\r"]), ["x", "y"]);
});

test("ignores comments and other fields, joins multi-line data and keeps a trailing frame", () => {
  assert.deepEqual(decodeAll([": keepalive\n\nevent: message\nid: 4\ndata: one\ndata:two\n\nretry: 10\n\ndata: tail"]), ["one\ntwo", "tail"]);
});

test("a frame stays buffered until its blank line arrives", () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push("data: partial"), []);
  assert.deepEqual(decoder.push("\n"), []);
  assert.deepEqual(decoder.push("\n"), ["partial"]);
  assert.deepEqual(decoder.flush(), []);
});
