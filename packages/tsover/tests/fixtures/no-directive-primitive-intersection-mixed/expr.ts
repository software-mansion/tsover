import { Operator } from 'tsover-runtime';

class Box {
  [Operator.plus](lhs: Box, _rhs: Box): Box {
    return lhs;
  }
}

type OverloadedFoo = number | Box;

export function foo<T extends OverloadedFoo>(a: T, b: T) {
  if (typeof a === 'number') {
    return a + b;
  }
  return a;
}
