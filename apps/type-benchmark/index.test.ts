import { attest } from "@ark/attest";
import { expect, test } from "vitest";

import { Operator } from 'tsover-runtime';

class Vec2f {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  [Operator.plus](lhs: Vec2f, rhs: Vec2f): Vec2f {
    return new Vec2f(lhs.x + rhs.x, lhs.y + rhs.y);
  }

  [Operator.star](lhs: Vec2f | number, rhs: Vec2f | number): Vec2f;
  [Operator.star](
    lhs: Vec2f | number,
    rhs: Vec2f | number,
  ): Vec2f | typeof Operator.deferOperation {
    if (typeof lhs === 'number' && rhs instanceof Vec2f) {
      return new Vec2f(lhs * rhs.x, lhs * rhs.y);
    } else if (typeof rhs === 'number' && lhs instanceof Vec2f) {
      return new Vec2f(lhs.x * rhs, lhs.y * rhs);
    } else if (lhs instanceof Vec2f && rhs instanceof Vec2f) {
      return new Vec2f(lhs.x * rhs.x, lhs.y * rhs.y);
    }
    return Operator.deferOperation;
  }

  [Operator.starStar](lhs: Vec2f, rhs: Vec2f | number): Vec2f;
  [Operator.starStar](lhs: Vec2f, rhs: Vec2f | number): Vec2f | typeof Operator.deferOperation {
    if (!(lhs instanceof Vec2f)) {
      return Operator.deferOperation;
    }

    if (typeof rhs === 'number') {
      return new Vec2f(lhs.x ** rhs, lhs.y ** rhs);
    } else if (rhs instanceof Vec2f) {
      return new Vec2f(lhs.x ** rhs.x, lhs.y ** rhs.y);
    }

    return Operator.deferOperation;
  }

  [Operator.percent](lhs: Vec2f | number, rhs: Vec2f | number): Vec2f;
  [Operator.percent](
    lhs: Vec2f | number,
    rhs: Vec2f | number,
  ): Vec2f | typeof Operator.deferOperation {
    if (typeof lhs === 'number' && rhs instanceof Vec2f) {
      return new Vec2f(lhs % rhs.x, lhs % rhs.y);
    } else if (typeof rhs === 'number' && lhs instanceof Vec2f) {
      return new Vec2f(lhs.x % rhs, lhs.y % rhs);
    } else if (lhs instanceof Vec2f && rhs instanceof Vec2f) {
      return new Vec2f(lhs.x % rhs.x, lhs.y % rhs.y);
    }
    return Operator.deferOperation;
  }

  toString(): string {
    return `(${this.x}, ${this.y})`;
  }
}

class Vec3f {
  x: number;
  y: number;
  z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  [Operator.plus](lhs: Vec3f, rhs: Vec3f): Vec3f {
    return new Vec3f(lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z);
  }

  [Operator.star](lhs: Vec3f | number, rhs: Vec3f | number): Vec3f;
  [Operator.star](
    lhs: Vec3f | number,
    rhs: Vec3f | number,
  ): Vec3f | typeof Operator.deferOperation {
    if (typeof lhs === 'number' && rhs instanceof Vec3f) {
      return new Vec3f(lhs * rhs.x, lhs * rhs.y, lhs * rhs.z);
    } else if (typeof rhs === 'number' && lhs instanceof Vec3f) {
      return new Vec3f(lhs.x * rhs, lhs.y * rhs, lhs.z * rhs);
    } else if (lhs instanceof Vec3f && rhs instanceof Vec3f) {
      return new Vec3f(lhs.x * rhs.x, lhs.y * rhs.y, lhs.z * rhs.z);
    }
    return Operator.deferOperation;
  }

  toString(): string {
    return `(${this.x}, ${this.y})`;
  }
}


test("bruh", () => {
  function main() {
    'use tsover';
    const a = new Vec3f(1, 2, 2);
    const b = new Vec3f(1, 2, 3);

    return a + b * 54;
  }

  attest(main).type.toString.snap("() => Vec3f");

  attest.instantiations([224, "instantiations"]);
});

test("bruh", () => {
  function double(a: Vec3f | Vec2f) {
    'use gpu';
    return a * 2;
  }

  attest(double).type.toString.snap("(a: Vec2f | Vec3f) => Vec2f | Vec3f");

  attest.instantiations([224, "instantiations"]);
});
