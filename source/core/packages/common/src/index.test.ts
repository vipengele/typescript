import { expect, test } from "vitest";
import * as entry from "./index";

test("the entry point loads", () => {
  expect(entry).toBeTypeOf("object");
});
