import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import ts from 'tsover';

const FIXTURES = path.resolve(__dirname, 'fixtures');

// Diagnostic codes are not stable across TypeScript versions, so resolve them
// from the patched compiler's own message table by matching on the message text.
const DIAGNOSTIC_MESSAGES = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../lib/diagnosticMessages.generated.json'), 'utf-8'),
) as Record<string, string>;

function resolveDiagnosticCode(messageSubstring: string): number {
  for (const [key, message] of Object.entries(DIAGNOSTIC_MESSAGES)) {
    if (message.includes(messageSubstring)) {
      const match = /_(\d+)$/.exec(key);
      if (match) return Number(match[1]);
    }
  }
  throw new Error(
    `Could not resolve diagnostic code for message containing: ${JSON.stringify(messageSubstring)}`,
  );
}

const WARNING_OUT_OF_SCOPE = resolveDiagnosticCode(
  "is disabled outside of a 'use tsover' or 'use gpu' scope",
);
const WARNING_EXPLICITLY_DISABLED = resolveDiagnosticCode(
  '"tsover-runtime/disable" has been imported in the program',
);

interface Compiled {
  program: ts.Program;
  checker: ts.TypeChecker;
  diagnostics: readonly ts.Diagnostic[];
  exprFile: ts.SourceFile;
  binaryExpr: ts.BinaryExpression;
}

function compileFixture(fixtureDir: string): Compiled {
  const configPath = path.join(fixtureDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, fixtureDir);
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'),
    );
  }

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const exprPath = path.join(fixtureDir, 'expr.ts');
  const exprFile = program.getSourceFile(exprPath);
  if (!exprFile) {
    throw new Error(`Could not load source file: ${exprPath}`);
  }

  let binaryExpr: ts.BinaryExpression | undefined;
  function visit(node: ts.Node): void {
    if (
      !binaryExpr &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      binaryExpr = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(exprFile);
  if (!binaryExpr) {
    throw new Error(`Could not find a + BinaryExpression in ${exprPath}`);
  }

  return { program, checker, diagnostics, exprFile, binaryExpr };
}

function diagnosticsForNode(compiled: Compiled, codes: number[]): ts.Diagnostic[] {
  const { diagnostics, exprFile, binaryExpr } = compiled;
  return diagnostics.filter(
    (d) =>
      codes.includes(d.code) &&
      d.file === exprFile &&
      d.start !== undefined &&
      d.start >= binaryExpr.pos &&
      d.start <= binaryExpr.end,
  );
}

describe('with tsover-runtime/disable active', () => {
  let compiled: Compiled;
  beforeAll(() => {
    compiled = compileFixture(path.join(FIXTURES, 'disable-active'));
  });

  it('emits Warning 95199 on the overloaded binary expression', () => {
    const hits = diagnosticsForNode(compiled, [WARNING_EXPLICITLY_DISABLED]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.category).toBe(ts.DiagnosticCategory.Warning);
  });

  it('does not emit Warning 95198 (the disable warning subsumes the out-of-scope one)', () => {
    expect(diagnosticsForNode(compiled, [WARNING_OUT_OF_SCOPE])).toHaveLength(0);
  });

  it('types Vec2f + Vec2f via the JS fallback rather than the overload', () => {
    const { checker, binaryExpr } = compiled;
    const exprType = checker.typeToString(checker.getTypeAtLocation(binaryExpr));
    expect(exprType).not.toBe('Vec2f');
  });

  it('emits a standard TS error since vanilla + cannot apply to Vec2f', () => {
    const { diagnostics, exprFile, binaryExpr } = compiled;
    const errors = diagnostics.filter(
      (d) =>
        d.category === ts.DiagnosticCategory.Error &&
        d.file === exprFile &&
        d.start !== undefined &&
        d.start >= binaryExpr.pos &&
        d.start <= binaryExpr.end,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('without tsover-runtime/disable', () => {
  let compiled: Compiled;
  beforeAll(() => {
    compiled = compileFixture(path.join(FIXTURES, 'disable-inactive'));
  });

  it('emits neither 95198 nor 95199', () => {
    expect(
      diagnosticsForNode(compiled, [WARNING_OUT_OF_SCOPE, WARNING_EXPLICITLY_DISABLED]),
    ).toHaveLength(0);
  });

  it('types Vec2f + Vec2f as Vec2f via the overload', () => {
    const { checker, binaryExpr } = compiled;
    expect(checker.typeToString(checker.getTypeAtLocation(binaryExpr))).toBe('Vec2f');
  });

  it('produces no errors in the expression file', () => {
    const { diagnostics, exprFile } = compiled;
    const errors = diagnostics.filter(
      (d) => d.category === ts.DiagnosticCategory.Error && d.file === exprFile,
    );
    expect(errors).toHaveLength(0);
  });
});

describe('without a use tsover directive', () => {
  let compiled: Compiled;
  beforeAll(() => {
    compiled = compileFixture(path.join(FIXTURES, 'no-directive'));
  });

  it('emits Warning 95198 on the binary expression', () => {
    const hits = diagnosticsForNode(compiled, [WARNING_OUT_OF_SCOPE]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.category).toBe(ts.DiagnosticCategory.Warning);
  });

  it('does not emit Warning 95199', () => {
    expect(diagnosticsForNode(compiled, [WARNING_EXPLICITLY_DISABLED])).toHaveLength(0);
  });
});
