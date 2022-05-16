# long

A Long class for representing a 64 bit two's-complement integer value derived from the Closure Library for stand-alone use and extended with unsigned support.

## usage
```ts
import { assert, assertEquals } from "https://deno.land/std@0.139.0/testing/asserts.ts";
import Long from "https://deno.land/x/long@v1.0.0/mod.ts";

Deno.test("long", function() {
  const value = new Long(0xFFFFFFFF, 0x7FFFFFFF);
  assertEquals(value.toString(), "9223372036854775807");
});

Deno.test("isLong", function() {
  const value = new Long(0xFFFFFFFF, 0x7FFFFFFF);
  assert(Long.isLong(value));
});
```
