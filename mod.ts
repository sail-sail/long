/**
 * @license
 * Copyright 2009 The Closure Library Authors
 * Copyright 2020 Daniel Wirtz / The long.js Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// The internal representation of a long is the two given signed, 32-bit values.
// We use 32-bit pieces because these are the size of integers on which
// Javascript performs bit-operations.  For operations like addition and
// multiplication, we split each number into 16 bit pieces, which can easily be
// multiplied within Javascript's floating-point representation without overflow
// or change in sign.
//
// In the algorithms below, we frequently reduce the negative case to the
// positive case by negating the input(s) and then post-processing the result.
// Note that we must ALWAYS check specially whether those values are MIN_VALUE
// (-2^63) because -MIN_VALUE == MIN_VALUE (since 2^63 cannot be represented as
// a positive number, it overflows back into a negative).  Not handling this
// case would often result in infinite recursion.
//
// Common constant values ZERO, ONE, NEG_ONE, etc. are defined below the from*
// methods on which they depend.

// WebAssembly optimizations to do native i64 multiplication and divide
// deno-lint-ignore no-explicit-any
let wasm: any = null;
try {
  wasm = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 2, 96, 0, 1, 127, 96, 4, 127, 127, 127, 127, 1, 127, 3, 7, 6, 0, 1, 1, 1, 1, 1, 6, 6, 1, 127, 1, 65, 0, 11, 7, 50, 6, 3, 109, 117, 108, 0, 1, 5, 100, 105, 118, 95, 115, 0, 2, 5, 100, 105, 118, 95, 117, 0, 3, 5, 114, 101, 109, 95, 115, 0, 4, 5, 114, 101, 109, 95, 117, 0, 5, 8, 103, 101, 116, 95, 104, 105, 103, 104, 0, 0, 10, 191, 1, 6, 4, 0, 35, 0, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 126, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 127, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 128, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 129, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 130, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11
  ])), {}).exports;
} catch (_e) {
  // no wasm support :(
}

/**
 * @function
 * @param {*} value number
 * @returns {number}
 * @inner
 */
 function ctz32(value: number): number {
  const c = Math.clz32(value & -value);
  return value ? 31 - c : c;
}

/**
 * Constructs a 64 bit two's-complement integer, given its low and high 32 bit values as *signed* integers.
 *  See the from* functions below for more convenient ways of constructing Longs.
 * @exports Long
 * @class A Long class for representing a 64 bit two's-complement integer value.
 * @param {number} low The low (signed) 32 bits of the long
 * @param {number} high The high (signed) 32 bits of the long
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @constructor
 */
class Long {
  
  low: number;
  
  high: number;
  
  unsigned: boolean;
  
  /**
   * A cache of the Long representations of small integer values.
   * @type {!Object}
   * @inner
   */
  static INT_CACHE: {[key: number]: Long} = { };

  /**
   * A cache of the Long representations of small unsigned integer values.
   * @type {!Object}
   * @inner
  */
  static UINT_CACHE: {[key: number]: Long} = {};
  
  constructor(low: number, high: number, unsigned?: boolean) {
    /**
     * The low 32 bits as a signed value.
     * @type {number}
     */
    this.low = low | 0;

    /**
     * The high 32 bits as a signed value.
     * @type {number}
     */
    this.high = high | 0;

    /**
     * Whether unsigned or not.
     * @type {boolean}
     */
    this.unsigned = !!unsigned;
  }
  
  // deno-lint-ignore no-explicit-any
  static isLong(obj: any): boolean {
    return obj && obj instanceof Long;
  }
  
  static fromInt(value: number, unsigned = false): Long {
    let obj, cachedObj, cache;
    if (unsigned) {
      value >>>= 0;
      // deno-lint-ignore no-cond-assign
      if (cache = (0 <= value && value < 256)) {
        cachedObj = Long.UINT_CACHE[value];
        if (cachedObj) {
          return cachedObj;
        }
      }
      obj = Long.fromBits(value, 0, true);
      if (cache)
      Long.UINT_CACHE[value] = obj;
      return obj;
    } else {
      value |= 0;
      // deno-lint-ignore no-cond-assign
      if (cache = (-128 <= value && value < 128)) {
        cachedObj = Long.INT_CACHE[value];
        if (cachedObj) {
          return cachedObj;
        }
      }
      obj = Long.fromBits(value, value < 0 ? -1 : 0, false);
      if (cache) {
        Long.INT_CACHE[value] = obj;
      }
      return obj;
    }
  }
  
  static fromNumber(value: number, unsigned = false): Long {
    if (isNaN(value)) {
      return unsigned ? Long.UZERO : Long.ZERO;
    }
    if (unsigned) {
      if (value < 0)
        return Long.UZERO;
      if (value >= Long.TWO_PWR_64_DBL)
        return Long.MAX_UNSIGNED_VALUE;
    } else {
      if (value <= -Long.TWO_PWR_63_DBL)
        return Long.MIN_VALUE;
      if (value + 1 >= Long.TWO_PWR_63_DBL)
        return Long.MAX_VALUE;
    }
    if (value < 0) {
      return Long.fromNumber(-value, unsigned).neg();
    }
    return Long.fromBits((value % Long.TWO_PWR_32_DBL) | 0, (value / Long.TWO_PWR_32_DBL) | 0, unsigned);
  }
  
  static fromBits(lowBits: number, highBits: number, unsigned = false): Long {
    return new Long(lowBits, highBits, unsigned);
  }
  
  static fromString(str: string, unsigned: boolean|number, radix?: number): Long {
    if (str.length === 0)
      throw Error('empty string');
    if (typeof unsigned === 'number') {
      // For goog.math.long compatibility
      radix = unsigned;
      unsigned = false;
    } else {
      unsigned = !!unsigned;
    }
    if (str === "NaN" || str === "Infinity" || str === "+Infinity" || str === "-Infinity")
      return unsigned ? Long.UZERO : Long.ZERO;
    radix = radix || 10;
    if (radix < 2 || 36 < radix)
      throw RangeError('radix');
  
    let p;
    if ((p = str.indexOf('-')) > 0)
      throw Error('interior hyphen');
    else if (p === 0) {
      return Long.fromString(str.substring(1), unsigned, radix).neg();
    }
  
    // Do several (8) digits each time through the loop, so as to
    // minimize the calls to the very expensive emulated div.
    const radixToPower = Long.fromNumber(Math.pow(radix, 8));
  
    let result = Long.ZERO;
    for (let i = 0; i < str.length; i += 8) {
      const size = Math.min(8, str.length - i),
        value = parseInt(str.substring(i, i + size), radix);
      if (size < 8) {
        const power = Long.fromNumber(Math.pow(radix, size));
        result = result.mul(power).add(Long.fromNumber(value));
      } else {
        result = result.mul(radixToPower);
        result = result.add(Long.fromNumber(value));
      }
    }
    result.unsigned = unsigned;
    return result;
  }
  
  static fromValue(val: Long|number|string|{low: number, high: number, unsigned: boolean}, unsigned = false): Long {
    if (typeof val === 'number')
      return Long.fromNumber(val, unsigned);
    if (typeof val === 'string')
      return Long.fromString(val, unsigned);
    // Throws for non-objects, converts non-instanceof Long:
    return Long.fromBits(val.low, val.high, typeof unsigned === 'boolean' ? unsigned : val.unsigned);
  }
  
  static ZERO: Long = Long.fromInt(0);
  
  static UZERO: Long = Long.fromInt(0, true);
  
  static ONE: Long = Long.fromInt(1);
  
  static UONE: Long = Long.fromInt(1, true);
  
  static MAX_VALUE: Long = Long.fromBits(0xFFFFFFFF | 0, 0x7FFFFFFF | 0, false);
  
  static NEG_ONE: Long = Long.fromInt(-1);
  
  static MIN_VALUE: Long = Long.fromBits(0, 0x80000000 | 0, false);
  
  toInt(): number {
    return this.unsigned ? this.low >>> 0 : this.low;
  }
  
  static MAX_UNSIGNED_VALUE: Long = Long.fromBits(0xFFFFFFFF | 0, 0xFFFFFFFF | 0, true);
  
  static TWO_PWR_16_DBL = 1 << 16;
  
  static TWO_PWR_24_DBL = 1 << 24;
  
  static TWO_PWR_32_DBL = Long.TWO_PWR_16_DBL * Long.TWO_PWR_16_DBL;
  
  static TWO_PWR_64_DBL = Long.TWO_PWR_32_DBL * Long.TWO_PWR_32_DBL;
  
  static TWO_PWR_63_DBL = Long.TWO_PWR_64_DBL / 2;
  
  static TWO_PWR_24 = Long.fromInt(Long.TWO_PWR_24_DBL);
  
  toNumber() {
    if (this.unsigned) {
      return ((this.high >>> 0) * Long.TWO_PWR_32_DBL) + (this.low >>> 0);
    }
    return this.high * Long.TWO_PWR_32_DBL + (this.low >>> 0);
  }
  
  toString(radix?: number): string {
    radix = radix || 10;
    if (radix < 2 || 36 < radix) {
      throw RangeError('radix');
    }
    if (this.isZero()) {
      return '0';
    }
    if (this.isNegative()) { // Unsigned Longs are never negative
      if (this.eq(Long.MIN_VALUE)) {
        // We need to change the Long value before it can be negated, so we remove
        // the bottom-most digit in this base and then recurse to do the rest.
        const radixLong = Long.fromNumber(radix);
        const div = this.div(radixLong);
        const rem1 = div.mul(radixLong).sub(this);
        return div.toString(radix) + rem1.toInt().toString(radix);
      } else {
        return '-' + this.neg().toString(radix);
      }
    }
    
    // Do several (6) digits each time through the loop, so as to
    // minimize the calls to the very expensive emulated div.
    const radixToPower = Long.fromNumber(Math.pow(radix, 6), this.unsigned);
    // deno-lint-ignore no-explicit-any no-this-alias
    let rem: any = this;
    let result = '';
    while (true) {
      const remDiv = rem.div(radixToPower);
      const intval = rem.sub(remDiv.mul(radixToPower)).toInt() >>> 0;
      let digits = intval.toString(radix);
      rem = remDiv;
      if (rem.isZero()) {
        return digits + result;
      } else {
        while (digits.length < 6) {
          digits = '0' + digits;
        }
        result = '' + digits + result;
      }
    }
  }
  
  getHighBits() {
    return this.high;
  }
  
  getHighBitsUnsigned() {
    return this.high >>> 0;
  }
  
  getLowBits() {
    return this.low;
  }
  
  getLowBitsUnsigned() {
    return this.low >>> 0;
  }
  
  getNumBitsAbs(): number {
    if (this.isNegative()) {
      return this.eq(Long.MIN_VALUE) ? 64 : this.neg().getNumBitsAbs();
    }
    const val = this.high != 0 ? this.high : this.low;
    let bit: number;
    for (bit = 31; bit > 0; bit--) {
      if ((val & (1 << bit)) != 0) {
        break;
      }
    }
    return this.high != 0 ? bit + 33 : bit + 1;
  }
  
  isZero() {
    return this.high === 0 && this.low === 0;
  }
  
  eqz() {
    return this.high === 0 && this.low === 0;
  }
  
  isNegative() {
    return !this.unsigned && this.high < 0;
  }
  
  isPositive() {
    return this.unsigned || this.high >= 0;
  }
  
  isOdd() {
    return (this.low & 1) === 1;
  }
  
  isEven() {
    return (this.low & 1) === 0;
  }
  
  equals(other: Long|number|string): boolean {
    if (!Long.isLong(other)) {
      other = Long.fromValue(other);
    }
    if (this.unsigned !== (other as Long).unsigned && (this.high >>> 31) === 1 && ((other as Long).high >>> 31) === 1) {
      return false;
    }
    return this.high === (other as Long).high && this.low === (other as Long).low;
  }
  
  eq(other: Long|number|string): boolean {
    return this.equals(other);
  }
  
  notEquals(other: Long|number|string): boolean {
    return !this.eq(other);
  }
  
  neq(other: Long|number|string): boolean {
    return this.notEquals(other);
  }
  
  ne(other: Long|number|string): boolean {
    return this.notEquals(other);
  }
  
  lessThan(other: Long|number|string) {
    return this.comp(/* validates */ other) < 0;
  }
  
  lt(other: Long|number|string) {
    return this.lessThan(other);
  }
  
  lessThanOrEqual(other: Long|number|string) {
    return this.comp(/* validates */ other) <= 0;
  }
  
  lte(other: Long|number|string) {
    return this.lessThanOrEqual(other);
  }
  
  le(other: Long|number|string) {
    return this.lessThanOrEqual(other);
  }
  
  greaterThan(other: Long|number|string) {
    return this.comp(/* validates */ other) > 0;
  }
  
  gt(other: Long|number|string) {
    return this.greaterThan(other);
  }
  
  greaterThanOrEqual(other: Long|number|string) {
    return this.comp(/* validates */ other) >= 0;
  }
  
  gte(other: Long|number|string) {
    return this.greaterThanOrEqual(other);
  }
  
  ge(other: Long|number|string) {
    return this.greaterThanOrEqual(other);
  }
  
  compare(other0: Long|number|string) {
    let other: Long;
    if (!Long.isLong(other0)) {
      other = Long.fromValue(other0);
    } else {
      other = other0 as Long;
    }
    if (this.eq(other)) {
      return 0;
    }
    const thisNeg = this.isNegative();
    const otherNeg = other.isNegative();
    if (thisNeg && !otherNeg) {
      return -1;
    }
    if (!thisNeg && otherNeg) {
      return 1;
    }
    // At this point the sign bits are the same
    if (!this.unsigned) {
      return this.sub(other).isNegative() ? -1 : 1;
    }
    // Both are positive if at least one is unsigned
    return (other.high >>> 0) > (this.high >>> 0) || (other.high === this.high && (other.low >>> 0) > (this.low >>> 0)) ? -1 : 1;
  }
  
  comp(other: Long|number|string) {
    return this.compare(other);
  }
  
  negate() {
    if (!this.unsigned && this.eq(Long.MIN_VALUE)) {
      return Long.MIN_VALUE;
    }
    return this.not().add(Long.ONE);
  }
  
  neg() {
    return this.negate();
  }
  
  add(addend0: Long|number|string): Long {
    let addend: Long;
    if (!Long.isLong(addend0)) {
      addend = Long.fromValue(addend0);
    } else {
      addend = addend0 as Long;
    }
    
    // Divide each number into 4 chunks of 16 bits, and then sum the chunks.
    
    const a48 = this.high >>> 16;
    const a32 = this.high & 0xFFFF;
    const a16 = this.low >>> 16;
    const a00 = this.low & 0xFFFF;
  
    const b48 = addend.high >>> 16;
    const b32 = addend.high & 0xFFFF;
    const b16 = addend.low >>> 16;
    const b00 = addend.low & 0xFFFF;
  
    let c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 + b00;
    c16 += c00 >>> 16;
    c00 &= 0xFFFF;
    c16 += a16 + b16;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c32 += a32 + b32;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c48 += a48 + b48;
    c48 &= 0xFFFF;
    return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
  }
  
  subtract(subtrahend: Long|number|string): Long {
    if (!Long.isLong(subtrahend)) {
      subtrahend = Long.fromValue(subtrahend);
    }
    return this.add((subtrahend as Long).neg());
  }
  
  sub(subtrahend: Long|number|string): Long {
    return this.subtract(subtrahend);
  }
  
  multiply(multiplier0: Long|number|string) {
    if (this.isZero()) {
      return this;
    }
    let multiplier: Long;
    if (!Long.isLong(multiplier0)) {
      multiplier = Long.fromValue(multiplier0);
    } else {
      multiplier = multiplier0 as Long;
    }
    
    // use wasm support if present
    if (wasm) {
      const low = wasm["mul"](this.low,
        this.high,
        multiplier.low,
        multiplier.high);
      return Long.fromBits(low, wasm["get_high"](), this.unsigned);
    }
    
    if (multiplier.isZero()) {
      return this.unsigned ? Long.UZERO : Long.ZERO;
    }
    if (this.eq(Long.MIN_VALUE)) {
      return multiplier.isOdd() ?Long. MIN_VALUE : Long.ZERO;
    }
    if (multiplier.eq(Long.MIN_VALUE)) {
      return this.isOdd() ? Long.MIN_VALUE : Long.ZERO;
    }
    
    if (this.isNegative()) {
      if (multiplier.isNegative()) {
        return this.neg().mul(multiplier.neg());
      } else {
        return this.neg().mul(multiplier).neg();
      }
    } else if (multiplier.isNegative()) {
      return this.mul(multiplier.neg()).neg();
    }
    
    // If both longs are small, use float multiplication
    if (this.lt(Long.TWO_PWR_24) && multiplier.lt(Long.TWO_PWR_24)) {
      return Long.fromNumber(this.toNumber() * multiplier.toNumber(), this.unsigned);
    }
    
    // Divide each long into 4 chunks of 16 bits, and then add up 4x4 products.
    // We can skip products that would overflow.
  
    const a48 = this.high >>> 16;
    const a32 = this.high & 0xFFFF;
    const a16 = this.low >>> 16;
    const a00 = this.low & 0xFFFF;
  
    const b48 = multiplier.high >>> 16;
    const b32 = multiplier.high & 0xFFFF;
    const b16 = multiplier.low >>> 16;
    const b00 = multiplier.low & 0xFFFF;
  
    let c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 * b00;
    c16 += c00 >>> 16;
    c00 &= 0xFFFF;
    c16 += a16 * b00;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c16 += a00 * b16;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c32 += a32 * b00;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c32 += a16 * b16;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c32 += a00 * b32;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
    c48 &= 0xFFFF;
    return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
  }
  
  mul(multiplier: Long|number|string): Long {
    return this.multiply(multiplier);
  }
  
  divide(divisor0: Long|number|string): Long {
    let divisor: Long;
    if (!Long.isLong(divisor0)) {
      divisor = Long.fromValue(divisor0);
    } else {
      divisor = divisor0 as Long;
    }
    if (divisor.isZero()) {
      throw Error('division by zero');
    }
  
    // use wasm support if present
    if (wasm) {
      // guard against signed division overflow: the largest
      // negative number / -1 would be 1 larger than the largest
      // positive number, due to two's complement.
      if (!this.unsigned &&
        this.high === -0x80000000 &&
        divisor.low === -1 && divisor.high === -1) {
        // be consistent with non-wasm code path
        return this;
      }
      const low = (this.unsigned ? wasm["div_u"] : wasm["div_s"])(
        this.low,
        this.high,
        divisor.low,
        divisor.high
      );
      return Long.fromBits(low, wasm["get_high"](), this.unsigned);
    }
  
    if (this.isZero()) {
      return this.unsigned ? Long.UZERO : Long.ZERO;
    }
    let approx: Long|number, rem: Long, res: Long;
    if (!this.unsigned) {
      // This section is only relevant for signed longs and is derived from the
      // closure library as a whole.
      if (this.eq(Long.MIN_VALUE)) {
        if (divisor.eq(Long.ONE) || divisor.eq(Long.NEG_ONE)) {
          return Long.MIN_VALUE;  // recall that -MIN_VALUE == MIN_VALUE
        } else if (divisor.eq(Long.MIN_VALUE)) {
          return Long.ONE;
        } else {
          // At this point, we have |other| >= 2, so |this/other| < |MIN_VALUE|.
          const halfThis = this.shr(1);
          approx = halfThis.div(divisor).shl(1);
          if (approx.eq(Long.ZERO)) {
            return divisor.isNegative() ? Long.ONE : Long.NEG_ONE;
          } else {
            rem = this.sub(divisor.mul(approx));
            res = approx.add(rem.div(divisor));
            return res;
          }
        }
      } else if (divisor.eq(Long.MIN_VALUE))
        return this.unsigned ? Long.UZERO : Long.ZERO;
      if (this.isNegative()) {
        if (divisor.isNegative()) {
          return this.neg().div(divisor.neg());
        }
        return this.neg().div(divisor).neg();
      } else if (divisor.isNegative()) {
        return this.div(divisor.neg()).neg();
      }
      res = Long.ZERO;
    } else {
      // The algorithm below has not been made for unsigned longs. It's therefore
      // required to take special care of the MSB prior to running it.
      if (!divisor.unsigned) {
        divisor = divisor.toUnsigned();
      }
      if (divisor.gt(this)) {
        return Long.UZERO;
      }
      if (divisor.gt(this.shru(1))) {
        // 15 >>> 1 = 7 ; with divisor = 8 ; true
        return Long.UONE;
      }
      res = Long.UZERO;
    }
  
    // Repeat the following until the remainder is less than other:  find a
    // floating-point that approximates remainder / other *from below*, add this
    // into the result, and subtract it from the remainder.  It is critical that
    // the approximate value is less than or equal to the real value so that the
    // remainder never becomes negative.
    rem = this;
    while (rem.gte(divisor)) {
      // Approximate the result of division. This may be a little greater or
      // smaller than the actual value.
      approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));
  
      // We will tweak the approximate result by changing it in the 48-th digit or
      // the smallest non-fractional digit, whichever is larger.
      const log2 = Math.ceil(Math.log(approx) / Math.LN2);
      const delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48);
      
        // Decrease the approximation until it is smaller than the remainder.  Note
        // that if it is too large, the product overflows and is negative.
      let approxRes = Long.fromNumber(approx);
      let approxRem = approxRes.mul(divisor);
      while (approxRem.isNegative() || approxRem.gt(rem)) {
        approx -= delta;
        approxRes = Long.fromNumber(approx, this.unsigned);
        approxRem = approxRes.mul(divisor);
      }
  
      // We know the answer can't be zero... and actually, zero would cause
      // infinite recursion since we would make no progress.
      if (approxRes.isZero()) {
        approxRes = Long.ONE;
      }
  
      res = res.add(approxRes);
      rem = rem.sub(approxRem);
    }
    return res;
  }
  
  div(divisor0: Long|number|string) {
    return this.divide(divisor0);
  }
  
  modulo(divisor0: Long|number|string) {
    let divisor: Long;
    if (!Long.isLong(divisor0)) {
      divisor = Long.fromValue(divisor0);
    } else {
      divisor = divisor0 as Long;
    }
    
    // use wasm support if present
    if (wasm) {
      const low = (this.unsigned ? wasm["rem_u"] : wasm["rem_s"])(
        this.low,
        this.high,
        divisor.low,
        divisor.high
      );
      return Long.fromBits(low, wasm["get_high"](), this.unsigned);
    }
    
    return this.sub(this.div(divisor).mul(divisor));
  }
  
  mod(divisor0: Long|number|string) {
    return this.modulo(divisor0);
  }
  
  rem(divisor0: Long|number|string) {
    return this.modulo(divisor0);
  }
  
  not() {
    return Long.fromBits(~this.low, ~this.high, this.unsigned);
  }
  
  countLeadingZeros() {
    return this.high ? Math.clz32(this.high) : Math.clz32(this.low) + 32;
  }
  
  clz() {
    return this.countLeadingZeros();
  }
  
  countTrailingZeros() {
    return this.low ? ctz32(this.low) : ctz32(this.high) + 32;
  }
  
  ctz() {
    return this.countTrailingZeros();
  }
  
  and(other0: Long|number|string) {
    let other: Long;
    if (!Long.isLong(other0)) {
      other = Long.fromValue(other0);
    } else {
      other = other0 as Long;
    }
    return Long.fromBits(this.low & other.low, this.high & other.high, this.unsigned);
  }
  
  or(other0: Long|number|string) {
    let other: Long;
    if (!Long.isLong(other0)) {
      other = Long.fromValue(other0);
    } else {
      other = other0 as Long;
    }
    return Long.fromBits(this.low | other.low, this.high | other.high, this.unsigned);
  }
  
  xor(other0: Long|number|string) {
    let other: Long;
    if (!Long.isLong(other0)) {
      other = Long.fromValue(other0);
    } else {
      other = other0 as Long;
    }
    return Long.fromBits(this.low ^ other.low, this.high ^ other.high, this.unsigned);
  }
  
  shiftLeft(numBits0: Long|number) {
    let numBits: number;
    if (Long.isLong(numBits0)) {
      numBits = (numBits0 as Long).toInt();
    } else {
      numBits = (numBits0 as number);
    }
    if ((numBits &= 63) === 0) {
      return this;
    } else if (numBits < 32) {
      return Long.fromBits(this.low << numBits, (this.high << numBits) | (this.low >>> (32 - numBits)), this.unsigned);
    } else {
      return Long.fromBits(0, this.low << (numBits - 32), this.unsigned);
    }
  }
  
  shl(numBits0: Long|number) {
    return this.shiftLeft(numBits0);
  }
  
  shiftRight(numBits0: Long|number) {
    let numBits: number;
    if (Long.isLong(numBits0)) {
      numBits = (numBits0 as Long).toInt();
    } else {
      numBits = (numBits0 as number);
    }
    if ((numBits &= 63) === 0) {
      return this;
    } else if (numBits < 32) {
      return Long.fromBits((this.low >>> numBits) | (this.high << (32 - numBits)), this.high >> numBits, this.unsigned);
    } else {
      return Long.fromBits(this.high >> (numBits - 32), this.high >= 0 ? 0 : -1, this.unsigned);
    }
  }
  
  shr(numBits0: Long|number) {
    return this.shiftRight(numBits0);
  }
  
  shiftRightUnsigned(numBits0: Long|number) {
    let numBits: number;
    if (Long.isLong(numBits0)) {
      numBits = (numBits0 as Long).toInt();
    } else {
      numBits = (numBits0 as number);
    }
    if ((numBits &= 63) === 0) return this;
    if (numBits < 32) return Long.fromBits((this.low >>> numBits) | (this.high << (32 - numBits)), this.high >>> numBits, this.unsigned);
    if (numBits === 32) return Long.fromBits(this.high, 0, this.unsigned);
    return Long.fromBits(this.high >>> (numBits - 32), 0, this.unsigned);
  }
  
  shru(numBits0: Long|number) {
    return this.shiftRightUnsigned(numBits0);
  }
  
  shr_u(numBits0: Long|number) {
    return this.shiftRightUnsigned(numBits0);
  }
  
  rotateLeft(numBits0: Long|number) {
    let numBits: number;
    if (Long.isLong(numBits0)) {
      numBits = (numBits0 as Long).toInt();
    } else {
      numBits = (numBits0 as number);
    }
    let b: number;
    if ((numBits &= 63) === 0) return this;
    if (numBits === 32) return Long.fromBits(this.high, this.low, this.unsigned);
    if (numBits < 32) {
      b = (32 - numBits);
      return Long.fromBits(((this.low << numBits) | (this.high >>> b)), ((this.high << numBits) | (this.low >>> b)), this.unsigned);
    }
    numBits -= 32;
    b = (32 - numBits);
  }
  
  rotl(numBits0: Long|number) {
    return this.rotateLeft(numBits0);
  }
  
  rotateRight(numBits0: Long|number) {
    let numBits: number;
    if (Long.isLong(numBits0)) {
      numBits = (numBits0 as Long).toInt();
    } else {
      numBits = (numBits0 as number);
    }
    let b: number;
    if ((numBits &= 63) === 0) return this;
    if (numBits === 32) return Long.fromBits(this.high, this.low, this.unsigned);
    if (numBits < 32) {
      b = (32 - numBits);
      return Long.fromBits(((this.high << b) | (this.low >>> numBits)), ((this.low << b) | (this.high >>> numBits)), this.unsigned);
    }
    numBits -= 32;
    b = (32 - numBits);
    return Long.fromBits(((this.low << b) | (this.high >>> numBits)), ((this.high << b) | (this.low >>> numBits)), this.unsigned);
  }
  
  rotr(numBits0: Long|number) {
    return this.rotateRight(numBits0);
  }
  
  toSigned() {
    if (!this.unsigned) return this;
    return Long.fromBits(this.low, this.high, false);
  }
  
  toUnsigned() {
    if (this.unsigned) return this;
    return Long.fromBits(this.low, this.high, true);
  }
  
  toBytes(le: boolean) {
    return le ? this.toBytesLE() : this.toBytesBE();
  }
  
  toBytesLE() {
    const hi = this.high,
      lo = this.low;
    return [
      lo & 0xff,
      lo >>> 8 & 0xff,
      lo >>> 16 & 0xff,
      lo >>> 24,
      hi & 0xff,
      hi >>> 8 & 0xff,
      hi >>> 16 & 0xff,
      hi >>> 24
    ];
  }
  
  toBytesBE() {
    const hi = this.high,
      lo = this.low;
    return [
      hi >>> 24,
      hi >>> 16 & 0xff,
      hi >>> 8 & 0xff,
      hi & 0xff,
      lo >>> 24,
      lo >>> 16 & 0xff,
      lo >>> 8 & 0xff,
      lo & 0xff
    ];
  }
  
  static fromBytes(bytes: number[], unsigned = false, le = true) {
    return le ? Long.fromBytesLE(bytes, unsigned) : Long.fromBytesBE(bytes, unsigned);
  }
  
  static fromBytesLE(bytes: number[], unsigned = false) {
    return new Long(
      bytes[0] |
      bytes[1] << 8 |
      bytes[2] << 16 |
      bytes[3] << 24,
      bytes[4] |
      bytes[5] << 8 |
      bytes[6] << 16 |
      bytes[7] << 24,
      unsigned
    );
  }
  
  static fromBytesBE(bytes: number[], unsigned = false) {
    return new Long(
      bytes[4] << 24 |
      bytes[5] << 16 |
      bytes[6] << 8 |
      bytes[7],
      bytes[0] << 24 |
      bytes[1] << 16 |
      bytes[2] << 8 |
      bytes[3],
      unsigned
    );
  }
  
}
export default Long;
