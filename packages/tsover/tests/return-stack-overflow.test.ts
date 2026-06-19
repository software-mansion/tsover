import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'tsover';

function generateNestedOverloadedReturnSource(depth: number): string {
  let source = `
'use tsover';
import { Operator } from 'tsover-runtime';

class Vec {
  [Operator.plus](lhs: Vec, rhs: Vec): Vec {
    return lhs;
  }
}

declare const left: Vec;
declare const right: Vec;

export function deeplyNested() {
`;

  for (let index = 0; index < depth; index++) {
    source += 'if (true) {\n';
  }
  source += 'return left + right;\n';
  for (let index = 0; index < depth; index++) {
    source += '}\n';
  }

  return `${source}}\n`;
}

function getDeeplyNestedReturnType(source: string, callerDepth: number): string {
  const dir = fs.mkdtempSync(path.resolve(__dirname, '..', '.tmp-return-stack-'));
  const fileName = path.join(dir, 'return-stack.ts');
  fs.writeFileSync(fileName, source);

  try {
    const program = ts.createProgram([fileName], {
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
    });
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) {
      throw new Error(`Could not load source file: ${fileName}`);
    }
    const fn = sourceFile.statements.find(ts.isFunctionDeclaration);
    if (!fn) {
      throw new Error('Could not find generated function declaration');
    }

    const checker = program.getTypeChecker();
    if (fn.name) {
      checker.getSymbolAtLocation(fn.name);
    }

    const maybeSignature = checker.getSignatureFromDeclaration(fn);
    if (!maybeSignature) {
      throw new Error('Could not resolve generated function signature');
    }
    const signature: ts.Signature = maybeSignature;

    function fromDeeperStack(depth: number): string {
      return depth === 0
        ? checker.typeToString(checker.getReturnTypeOfSignature(signature))
        : fromDeeperStack(depth - 1);
    }

    return fromDeeperStack(callerDepth);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('return type inference stack depth', () => {
  it('reproduces the return-statement traversal stack overflow with an overloaded return expression', () => {
    const originalStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 80;
    let thrown: unknown;

    try {
      getDeeplyNestedReturnType(
        generateNestedOverloadedReturnSource(/*depth*/ 450),
        /*callerDepth*/ 6000,
      );
    } catch (error) {
      thrown = error;
    } finally {
      Error.stackTraceLimit = originalStackTraceLimit;
    }

    expect(thrown).toBeInstanceOf(RangeError);
    const stack = String((thrown as Error).stack);
    expect(stack).toContain('traverse');
    expect(stack).toContain('forEachChildInIfStatement');
  });
});
