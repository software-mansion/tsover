import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import ts from 'tsover';

function generateWideUnionSource(unionMembers: number, operandCount: number): string {
  const classNames = Array.from({ length: unionMembers }, (_, index) => `Box${index}`);
  const classes = classNames
    .map(
      (name) => `
class ${name} {
  [Operator.plus](lhs: AnyBox, rhs: AnyBox): AnyBox {
    return lhs;
  }
}`,
    )
    .join('\n');
  const declarations = Array.from(
    { length: unionMembers },
    (_, index) => `declare const value${index}: AnyBox;`,
  ).join('\n');
  const operands = Array.from(
    { length: operandCount },
    (_, index) => `value${index % unionMembers}`,
  ).join(' + ');

  return `
'use tsover';
import { Operator } from 'tsover-runtime';

${classes}

type AnyBox = ${classNames.join(' | ')} | number;

${declarations}

export const result = ${operands};
`;
}

function generateBrandedNumberFallbackSource(
  unionMembers: number,
  expressionCount: number,
): string {
  const union = Array.from(
    { length: unionMembers },
    (_, index) => `(number & { readonly __brand${index}: unique symbol })`,
  ).join(' | ');
  const expressions = Array.from(
    { length: expressionCount },
    (_, index) =>
      `export const ${index === expressionCount - 1 ? 'result' : `result${index}`} = left + right;`,
  ).join('\n');

  return `
'use tsover';

type BrandedNumber = ${union};

declare const left: BrandedNumber;
declare const right: BrandedNumber;

${expressions}
`;
}

function compileStressSource(source: string): {
  diagnostics: readonly ts.Diagnostic[];
  plusExpressionCount: number;
  resultType: string;
} {
  const dir = fs.mkdtempSync(path.resolve(__dirname, '..', '.tmp-scale-'));
  const fileName = path.join(dir, 'stress.ts');
  fs.writeFileSync(fileName, source);

  try {
    const options: ts.CompilerOptions = {
      ignoreDeprecations: '6.0',
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
    };
    const program = ts.createProgram([fileName], options);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) {
      throw new Error(`Could not load source file: ${fileName}`);
    }

    let plusExpressionCount = 0;
    let resultInitializer: ts.Expression | undefined;
    function visit(node: ts.Node): void {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        plusExpressionCount++;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'result'
      ) {
        resultInitializer = node.initializer;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (!resultInitializer) {
      throw new Error('Could not find generated result initializer');
    }

    const resultType = checker.typeToString(checker.getTypeAtLocation(resultInitializer));
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return { diagnostics, plusExpressionCount, resultType };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('operator overload checker scaling', () => {
  it('resolves a wide union and long operator chain without runaway recursion', () => {
    const unionMembers = 18;
    const operandCount = 36;
    const source = generateWideUnionSource(unionMembers, operandCount);

    const start = performance.now();
    const summary = compileStressSource(source);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(10_000);
    expect(summary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
    expect({
      operandCount,
      plusExpressionCount: summary.plusExpressionCount,
      resultType: summary.resultType,
      unionMembers,
    }).toMatchInlineSnapshot(`
      {
        "operandCount": 36,
        "plusExpressionCount": 35,
        "resultType": "AnyBox",
        "unionMembers": 18,
      }
    `);
  });

  it('resolves repeated branded primitive-intersection fallback without hanging', () => {
    const expressionCount = 20;
    const unionMembers = 160;
    const source = generateBrandedNumberFallbackSource(unionMembers, expressionCount);

    const start = performance.now();
    const summary = compileStressSource(source);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(20_000);
    expect(summary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
    expect({
      expressionCount,
      plusExpressionCount: summary.plusExpressionCount,
      resultType: summary.resultType,
      unionMembers,
    }).toMatchInlineSnapshot(`
      {
        "expressionCount": 20,
        "plusExpressionCount": 20,
        "resultType": "number",
        "unionMembers": 160,
      }
    `);
  });
});
