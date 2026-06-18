import { Operator } from 'tsover-runtime';

interface Box {
  [Operator.plus](lhs: Box, rhs: Box): Box;
}

type OverloadedFoo = number | Box;

export function foo<T extends OverloadedFoo>(a: T) {
  if (typeof a === 'number') {
    return a + 1;
  }
  return a;
}
