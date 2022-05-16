import { assert, assertEquals } from "https://deno.land/std@0.139.0/testing/asserts.ts";
import Long from "./mod.ts";

Deno.test("long", function() {
  const value = new Long(0xFFFFFFFF, 0x7FFFFFFF);
  assertEquals(value.toString(), "9223372036854775807");
});

Deno.test("isLong", function() {
  const value = new Long(0xFFFFFFFF, 0x7FFFFFFF);
  assert(Long.isLong(value));
});
