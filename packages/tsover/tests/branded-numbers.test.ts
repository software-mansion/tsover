import { expectTypeOf, test } from 'vitest';
import { Operator } from 'tsover-runtime';

test('branded numerics', () => {
  type F32 = F32Class & number;
  class F32Class {
    [Operator.plus](lhs: F32, rhs: F32): F32;
    [Operator.plus](lhs: F32, rhs: number): F32;
    [Operator.plus](_lhs: F32, _rhs: number | (F32Class & number)): F32 {
      return new F32Class() as F32;
    }

    valueOf() {
      return 0;
    }
  }

  const scalar: F32 = new F32Class() as F32;

  (() => {
    'use tsover';
    const result = scalar + 1;
    // In a tsover scope, branded types respect overloads
    expectTypeOf(result).toEqualTypeOf<F32>();
  })();

  const result = scalar + 1;
  // Outside of a tsover scope, the branded types behave as plain numbers
  expectTypeOf(result).toEqualTypeOf<number>();
});
