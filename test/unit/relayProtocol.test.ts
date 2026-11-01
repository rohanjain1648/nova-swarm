import { expect, test } from "vitest";
import { normalizeCode } from "../../src/net/relayProtocol";

test("normalizeCode trims and uppercases a valid code", () => {
  expect(normalizeCode(" abcd ")).toBe("ABCD");
  expect(normalizeCode("x7k2")).toBe("X7K2");
});

test("normalizeCode rejects confusable characters and wrong lengths", () => {
  expect(normalizeCode("AB0D")).toBeNull();
  expect(normalizeCode("ABID")).toBeNull();
  expect(normalizeCode("ABC")).toBeNull();
  expect(normalizeCode("ABCDE")).toBeNull();
  expect(normalizeCode("")).toBeNull();
});
