import { $ } from 'bun';
import * as jsonc from 'comment-json';
import { existsSync } from 'fs';
import { rm, mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

const tag = process.argv[2];

const SWM_LICENSE = `\
/*
 * Copyright 2026 Software Mansion S.A.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
`;

const SWM_CHANGE_NOTICE = `\
/*! Modified by Software Mansion S.A. on [data] to implement operator overloading. */
`;

if (!tag) {
  console.log('No tag specified. Fetching available tags from GitHub...\n');

  const allTags: string[] = [];
  let url: string | null = 'https://api.github.com/repos/microsoft/TypeScript/tags?per_page=100';

  while (url) {
    const response: Response = await fetch(url);
    if (!response.ok) {
      console.error('Failed to fetch tags from GitHub');
      process.exit(1);
    }

    const tags = (await response.json()) as Array<{ name: string }>;
    allTags.push(...tags.map((t) => t.name));

    // Parse Link header for pagination
    const linkHeader = response.headers.get('link');
    url = null;

    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }

  console.log('Available tags:');
  for (const t of allTags) {
    console.log(`  - ${t}`);
  }
  console.log(`\nTotal: ${allTags.length} tags`);
  console.log('\nUsage: bun scripts/patch.ts <tag>');
  process.exit(1);
}

const typescriptTargetDir = resolve(import.meta.dir, '..', 'typescript');
const versionFilePath = resolve(typescriptTargetDir, '.tsover-version');

console.log(`Patching TypeScript ${tag} ...`);

// Check if we already have the correct version
let shouldClone = true;
if (existsSync(versionFilePath)) {
  const currentVersion = await readFile(versionFilePath, 'utf-8');
  if (currentVersion.trim() === tag) {
    console.log(`TypeScript ${tag} already downloaded. Resetting and reapplying patches...`);
    shouldClone = false;
  } else {
    console.log(
      `Mismatched version: ${currentVersion.trim()} != ${tag}. Resetting and reapplying patches...`,
    );
  }
}

function injectBefore(source: string, toInject: string, postludePattern: RegExp): string {
  const result = postludePattern.exec(source);
  if (!result || result.length < 1) {
    throw new Error('Could not find pattern to inject after');
  }

  return source.slice(0, result.index) + toInject + source.slice(result.index);
}

function injectAfter(source: string, preludePattern: RegExp, toInject: string): string {
  const result = preludePattern.exec(source);
  if (!result || result.length < 1) {
    throw new Error('Could not find pattern to inject after');
  }

  const injectPoint = result.index + result[0].length;
  return source.slice(0, injectPoint) + toInject + source.slice(injectPoint);
}

if (shouldClone) {
  // Remove existing directory if it exists
  if (existsSync(typescriptTargetDir)) {
    console.log(`Removing existing directory: ${typescriptTargetDir}`);
    await rm(typescriptTargetDir, { recursive: true, force: true });
  }

  // Create directory
  await mkdir(typescriptTargetDir, { recursive: true });

  // Clone the TypeScript repository (shallow clone, single branch, single commit)
  console.log(`Cloning microsoft/TypeScript@${tag} ...`);
  await $`git clone --depth 1 --branch ${tag} --single-branch https://github.com/microsoft/TypeScript.git ${typescriptTargetDir}`;

  // Write version file
  await writeFile(versionFilePath, tag);
} else {
  // Reset local unstaged changes
  process.chdir(typescriptTargetDir);
  await $`git checkout -- .`;
  await $`git clean -fd`;
  // Write version file
  await writeFile(versionFilePath, tag);
}

// Store original directory and ensure we're in the target directory
const originalCwd = process.cwd();
process.chdir(typescriptTargetDir);

try {
  // Install dependencies
  console.log('Installing dependencies ...');
  await $`npm install`;

  // Apply patches
  console.log('Applying tsover patches...');

  // Patch types.ts
  const typesPath = resolve(typescriptTargetDir, 'src', 'compiler', 'types.ts');
  let typesContent = await readFile(typesPath, 'utf-8');

  const patchErrors: unknown[] = [];

  try {
    typesContent = SWM_CHANGE_NOTICE + typesContent;

    typesContent = injectAfter(
      typesContent,
      /export interface NodeLinks \{[\S\s]*nonExistentPropCheckCache\?: Set<string>;/,
      `
      useTsoverScope?: boolean;    // True if node is within a 'use tsover' directive scope,
      useGpuScope?: boolean;       // True if node is within a 'use gpu' directive scope
      tsoverOverloadReturnTypes?: Map<string, Type | false>; // Cached overloaded operator result types
      tsoverOverloadReturnTypesResolving?: Set<string>; // In-progress overloaded operator result lookups
      `,
    );

    typesContent = injectAfter(
      typesContent,
      /export interface TypeChecker \{/,
      `
      __tsover__isInUseTsoverScope(node: Node): boolean;
      __tsover__isInUseGpuScope(node: Node): boolean;
      __tsover__couldHaveOverloadedOperators(
        left: Expression,
        operator: BinaryOperator,
        right: Expression,
        leftType: Type,
        rightType: Type,
      ): boolean;
      `,
    );

    await writeFile(typesPath, typesContent);

    console.log('  ✓ Patched types.ts');
  } catch (error) {
    patchErrors.push('  ✗ Could not find pattern in types.ts');
    patchErrors.push(error);
  }

  // Patch checker.ts
  const checkerPath = resolve(typescriptTargetDir, 'src', 'compiler', 'checker.ts');
  let checkerContent = await readFile(checkerPath, 'utf-8');

  try {
    checkerContent = SWM_CHANGE_NOTICE + checkerContent;

    if (!checkerContent.includes('isPrologueDirective')) {
      // Only import isPrologueDirective if it's not already imported
      checkerContent = injectBefore(
        checkerContent,
        `isPrologueDirective,`,
        /} from "\.\/_namespaces\/ts\.js";/,
      );
    }

    checkerContent = injectAfter(
      checkerContent,
      /export function createTypeChecker\(host: TypeCheckerHost\): TypeChecker \{/,
      `
    const __tsover__overloaded = {
        [SyntaxKind.PlusToken]: 'operatorPlus',
        [SyntaxKind.MinusToken]: 'operatorMinus',
        [SyntaxKind.AsteriskToken]: 'operatorStar',
        [SyntaxKind.SlashToken]: 'operatorSlash',
        [SyntaxKind.AsteriskAsteriskToken]: 'operatorStarStar',
        [SyntaxKind.PercentToken]: 'operatorPercent',
    };

    const __tsover__compoundOperators = {
        [SyntaxKind.PlusEqualsToken]: SyntaxKind.PlusToken,
        [SyntaxKind.MinusEqualsToken]: SyntaxKind.MinusToken,
        [SyntaxKind.AsteriskEqualsToken]: SyntaxKind.AsteriskToken,
        [SyntaxKind.SlashEqualsToken]: SyntaxKind.SlashToken,
        [SyntaxKind.AsteriskAsteriskEqualsToken]: SyntaxKind.AsteriskAsteriskToken,
        [SyntaxKind.PercentEqualsToken]: SyntaxKind.PercentToken,
    } as Record<SyntaxKind, BinaryOperator | undefined>;

    function __tsover__findBinarySignature(signatures: readonly Signature[], lhs: Type, rhs: Type): Type | undefined {
        // Find a signature where the first parameter accepts lhs and second accepts rhs
        for (const signature of signatures) {
            const paramType1 = getTypeAtPosition(signature, 0);
            const paramType2 = getTypeAtPosition(signature, 1);
            if (isTypeAssignableTo(lhs, paramType1) && isTypeAssignableTo(rhs, paramType2)) {
                return isResolvingReturnTypeOfSignature(signature) ? anyType : getReturnTypeOfSignature(signature);
            }
        }
        return undefined;
    }

    function __tsover__getDeferOperationSymbolType(): Type | undefined {
        const ctorType = getGlobalESSymbolConstructorSymbol(/*reportErrors*/ false);
        return ctorType && getTypeOfPropertyOfType(getTypeOfSymbol(ctorType), 'deferOperation' as __String);
    }

    function __tsover__findDirective(statements: readonly Statement[], directive: string): Statement | undefined {
        for (const statement of statements) {
            if (isPrologueDirective(statement)) {
                if (isStringLiteral(statement.expression) && statement.expression.text === directive) {
                    return statement;
                }
            }
            else {
                break;
            }
        }
        return undefined;
    }

    function __tsover__isInUseTsoverScope(node: Node): boolean {
        const links = getNodeLinks(node);
        if (links.useTsoverScope !== undefined) {
            return links.useTsoverScope;
        }
        return links.useTsoverScope = __tsover__computeIsInDirectiveScope(node, 'use tsover');
    }

    function __tsover__isInUseGpuScope(node: Node): boolean {
        const links = getNodeLinks(node);
        if (links.useGpuScope !== undefined) {
            return links.useGpuScope;
        }
        return links.useGpuScope = __tsover__computeIsInDirectiveScope(node, 'use gpu');
    }

    let __tsover__explicitlyDisabledCache: boolean | undefined;
    function __tsover__isExplicitlyDisabled(): boolean {
        if (__tsover__explicitlyDisabledCache !== undefined) {
            return __tsover__explicitlyDisabledCache;
        }

        const isDisabled = !!globalThisSymbol.exports?.has(escapeLeadingUnderscores("__tsover__disabled"));
        return __tsover__explicitlyDisabledCache = isDisabled;
    }

    function __tsover__computeIsInDirectiveScope(node: Node, directive: string): boolean {
        // Check source file level first
        const sourceFile = getSourceFileOfNode(node);
        if (__tsover__findDirective(sourceFile.statements, directive)) {
            return true;
        }

        // Walk up through containing functions (transitive lexical scope)
        let current: Node | undefined = node;
        while (current) {
            if (isFunctionLikeDeclaration(current) && current.body && isBlock(current.body)) {
                if (__tsover__findDirective(current.body.statements, directive)) {
                    return true;
                }
            }
            current = current.parent;
        }
        return false;
    }

    function __tsover__getOverloadOperandType(reference: Expression, type: Type): Type {
        // For naked type parameters, overload lookup should follow the current
        // control-flow branch instead of immediately widening back to the full constraint.
        if (type.flags & TypeFlags.TypeVariable) {
            const constraint = getBaseConstraintOfType(type as TypeVariable);
            if (constraint) {
                const target = getReferenceCandidate(skipParentheses(reference, /*excludeJSDocTypeAssertions*/ true));
                return getFlowTypeOfReference(target, constraint, constraint);
            }
        }
        return type;
    }

    function __tsover__getPrimitiveStrippedIntersectionTypes(type: Type): Type[] | undefined {
        if (!(type.flags & TypeFlags.Intersection)) {
            return undefined;
        }

        // When a narrowed type looks like T & number, keep the branded/object side
        // for overload lookup so we do not reintroduce the primitive branch too early.
        const types = (type as IntersectionType).types;
        const stripped: Type[] = [];
        for (const candidate of types) {
            if (!__tsover__isPrimitiveLike(getBaseConstraintOrType(candidate))) {
                stripped.push(candidate);
            }
        }
        return stripped.length > 0 && stripped.length < types.length ? stripped : undefined;
    }

    function __tsover__collectOverloadCandidateTypes(type: Type, expandTypeVariables = true, seen?: Set<string>): Type[] {
        seen ??= new Set();
        const seenKey = \`\${expandTypeVariables ? 1 : 0}:\${getTypeId(type)}\`;
        if (seen.has(seenKey)) {
            return [];
        }
        seen.add(seenKey);

        if (type.flags & TypeFlags.Union) {
            // Unions are checked member-by-member so overload detection can mirror
            // the same pair expansion used during result-type resolution.
            const result: Type[] = [];
            for (const member of (type as UnionType).types) {
                result.push(...__tsover__collectOverloadCandidateTypes(member, expandTypeVariables, seen));
            }
            return result;
        }

        const strippedIntersectionTypes = __tsover__getPrimitiveStrippedIntersectionTypes(type);
        if (strippedIntersectionTypes) {
            const result: Type[] = [];
            for (const member of strippedIntersectionTypes) {
                result.push(
                    ...__tsover__collectOverloadCandidateTypes(member, /*expandTypeVariables*/ false, seen),
                );
            }
            return result;
        }

        if (type.flags & TypeFlags.Intersection) {
            const result: Type[] = [];
            for (const member of (type as IntersectionType).types) {
                result.push(...__tsover__collectOverloadCandidateTypes(member, expandTypeVariables, seen));
            }
            return result;
        }

        if (expandTypeVariables && type.flags & TypeFlags.TypeVariable) {
            // Outside of flow-narrowed branches we still want plain type parameters
            // to contribute their constraint members as overload candidates.
            const constraint = getBaseConstraintOfType(type as TypeVariable);
            if (constraint && constraint !== type) {
                return __tsover__collectOverloadCandidateTypes(constraint, expandTypeVariables, seen);
            }
        }

        const baseType = expandTypeVariables ? getBaseConstraintOrType(type) : type;
        if (baseType !== type) {
            return __tsover__collectOverloadCandidateTypes(baseType, expandTypeVariables, seen);
        }

        return [type];
    }

    function __tsover__hasOverloadProperty(
      left: Expression,
      right: Expression,
      _leftType: Type,
      _rightType: Type,
      knownSymbolName: string,
    ): boolean {
        // The transform plugin uses this as a quick "is there any overload here?"
        // check, so it should share the same operand normalization as the checker.
        const leftType = __tsover__getOverloadOperandType(left, _leftType);
        const rightType = __tsover__getOverloadOperandType(right, _rightType);
        const typesToCheck = [
            ...__tsover__collectOverloadCandidateTypes(leftType),
            ...__tsover__collectOverloadCandidateTypes(rightType),
        ];

        const propertyName = getPropertyNameForKnownSymbolName(knownSymbolName);
        return typesToCheck.some((aType) => !!getTypeOfPropertyOfType(aType, propertyName));
    }

    function __tsover__isInOverloadingScope(node: Node): boolean {
        return __tsover__isInUseTsoverScope(node) || __tsover__isInUseGpuScope(node);
    }

    function __tsover__isPrimitiveLike(type: Type): boolean {
        return isTypeAssignableToKind(type, TypeFlags.StringLike, /*strict*/ true) ||
            isTypeAssignableToKind(type, TypeFlags.NumberLike, /*strict*/ true) ||
            isTypeAssignableToKind(type, TypeFlags.BigIntLike, /*strict*/ true) ||
            isTypeAssignableToKind(type, TypeFlags.BooleanLike, /*strict*/ true) ||
            isTypeAssignableToKind(type, TypeFlags.ESSymbolLike, /*strict*/ true) ||
            isTypeAssignableToKind(type, TypeFlags.Null, /*strict*/ true) ||
            isTypeAssignableToKind(type, TypeFlags.Undefined, /*strict*/ true);
    }

    function __tsover__isPrimitiveIntersection(type: Type): boolean {
        return !!(type.flags & TypeFlags.Intersection) && some((type as IntersectionType).types, t => {
            const baseType = getBaseConstraintOrType(t);
            return !!(baseType.flags & TypeFlags.Primitive);
        });
    }

    function __tsover__builtinSupportsPrimitiveOperator(
      operator: BinaryOperator,
      leftType: Type,
      rightType: Type,
    ): boolean {
        // This mirrors the small subset of builtin binary behavior that we need
        // when one union member should stay on the normal primitive operator path.
        switch (__tsover__compoundOperators[operator] ?? operator) {
            case SyntaxKind.PlusToken:
                return !!(isTypeAssignableToKind(leftType, TypeFlags.NumberLike, /*strict*/ true) &&
                    isTypeAssignableToKind(rightType, TypeFlags.NumberLike, /*strict*/ true) ||
                    isTypeAssignableToKind(leftType, TypeFlags.BigIntLike, /*strict*/ true) &&
                    isTypeAssignableToKind(rightType, TypeFlags.BigIntLike, /*strict*/ true) ||
                    isTypeAssignableToKind(leftType, TypeFlags.StringLike, /*strict*/ true) ||
                    isTypeAssignableToKind(rightType, TypeFlags.StringLike, /*strict*/ true) ||
                    isTypeAny(leftType) ||
                    isTypeAny(rightType));
            case SyntaxKind.MinusToken:
            case SyntaxKind.AsteriskToken:
            case SyntaxKind.SlashToken:
            case SyntaxKind.AsteriskAsteriskToken:
            case SyntaxKind.PercentToken:
                return !!(isTypeAssignableToKind(leftType, TypeFlags.NumberLike, /*strict*/ true) &&
                    isTypeAssignableToKind(rightType, TypeFlags.NumberLike, /*strict*/ true) ||
                    isTypeAssignableToKind(leftType, TypeFlags.BigIntLike, /*strict*/ true) &&
                    isTypeAssignableToKind(rightType, TypeFlags.BigIntLike, /*strict*/ true) ||
                    isTypeAny(leftType) ||
                    isTypeAny(rightType));
        }

        return false;
    }

    function __tsover__shouldSuppressDisabledWarning(
      operator: BinaryOperator,
      leftType: Type,
      rightType: Type,
    ): boolean {
        return (__tsover__isPrimitiveLike(leftType) || __tsover__isPrimitiveIntersection(leftType)) &&
            (__tsover__isPrimitiveLike(rightType) || __tsover__isPrimitiveIntersection(rightType)) &&
            __tsover__builtinSupportsPrimitiveOperator(operator, leftType, rightType);
    }

    function __tsover__couldHaveOverloadedOperators(
      left: Expression,
      operator: BinaryOperator,
      right: Expression,
      _leftType: Type,
      _rightType: Type,
    ): boolean {
        const baseOp = __tsover__compoundOperators[operator] ?? operator;
        const knownSymbolName = __tsover__overloaded[baseOp as keyof typeof __tsover__overloaded];
        if (!knownSymbolName) {
            return false;
        }
        if (__tsover__isExplicitlyDisabled()) {
            return false;
        }
        if (!__tsover__isInOverloadingScope(left)) {
            return false;
        }
        return __tsover__hasOverloadProperty(left, right, _leftType, _rightType, knownSymbolName);
    }

    /**
     * Resolve the type of an overloaded binary operator.
     *
     * The search order is:
     * 1. Narrow generic operands using the current control-flow branch.
     * 2. Expand unions into the operand pairs that could actually occur.
     * 3. Try the left operand's overload signatures.
     * 4. If the left side has no match, or it returns deferOperation, try the right side.
     * 5. If a union branch still has no overload, ask normal TypeScript whether that
     *    specific branch should use the builtin primitive operator instead.
     *
     * We keep the overloaded result only when every tested pair succeeds. That
     * makes broad expressions like left + right stay conservative when one side
     * is still wider than the branch-local narrowing on the other side.
     */
    function __tsover__getOverloadReturnType(
      node: BinaryExpression,
      left: Expression,
      operator: BinaryOperator,
      right: Expression,
      _leftType: Type,
      _rightType: Type,
      checkDeeper: (lt: Type, rt: Type) => Type | undefined,
    ): Type | undefined {
        const baseOp = __tsover__compoundOperators[operator] ?? operator;
        const knownSymbolName = __tsover__overloaded[baseOp as keyof typeof __tsover__overloaded];
        if (!knownSymbolName || __tsover__isExplicitlyDisabled() || !__tsover__isInOverloadingScope(left)) {
            return undefined;
        }

        const leftType = __tsover__getOverloadOperandType(left, _leftType);
        const rightType = __tsover__getOverloadOperandType(right, _rightType);
        const cacheKey = \`\${operator}:\${getTypeId(leftType)}:\${getTypeId(rightType)}\`;
        const links = getNodeLinks(node);
        const cached = links.tsoverOverloadReturnTypes?.get(cacheKey);
        if (cached !== undefined) {
            return cached || undefined;
        }
        if (links.tsoverOverloadReturnTypesResolving?.has(cacheKey)) {
            return undefined;
        }
        (links.tsoverOverloadReturnTypesResolving ||= new Set()).add(cacheKey);

        try {
            let combinations: [Type, Type][] = [];

            // _leftType is a constrained type (a generic), and _rightType is of the same type.
            // If they're unions, we only need to consider the combinations where lhs and rhs match.
            if (_leftType === _rightType && _leftType !== leftType) {
                if (leftType.flags & TypeFlags.Union) {
                    combinations = (leftType as UnionType).types.map(t => [t, t]);
                } else {
                    combinations = [[leftType, leftType]];
                }
            } else if (leftType.flags & TypeFlags.Union && rightType.flags & TypeFlags.Union) {
                for (const leftMember of (leftType as UnionType).types) {
                    for (const rightMember of (rightType as UnionType).types) {
                        combinations.push([leftMember, rightMember]);
                    }
                }
            } else if (leftType.flags & TypeFlags.Union) {
                for (const leftMember of (leftType as UnionType).types) {
                    combinations.push([leftMember, rightType]);
                }
            } else if (rightType.flags & TypeFlags.Union) {
                for (const rightMember of (rightType as UnionType).types) {
                    combinations.push([leftType, rightMember]);
                }
            } else {
              combinations.push([leftType, rightType]);
            }

            const deferOperationType = __tsover__getDeferOperationSymbolType();
            const propertyName = getPropertyNameForKnownSymbolName(knownSymbolName);
            let resultMembers: Type[] = [];
            for (const [leftType, rightType] of combinations) {
                const lhsOverload = getTypeOfPropertyOfType(leftType, propertyName);
                const rhsOverload = getTypeOfPropertyOfType(rightType, propertyName);
                const lhsSignatures = lhsOverload ? getSignaturesOfType(lhsOverload, SignatureKind.Call) : [];
                let resultType = __tsover__findBinarySignature(lhsSignatures, leftType, rightType);

                if (lhsSignatures.length === 0 || (resultType && deferOperationType && isTypeIdenticalTo(resultType, deferOperationType))) {
                    // Try rhs overloads if lhs has no overloads or if result has deferOperation symbol
                    const rhsSignatures = rhsOverload ? getSignaturesOfType(rhsOverload, SignatureKind.Call) : [];
                    resultType = __tsover__findBinarySignature(rhsSignatures, leftType, rightType);
                }
                if (resultType && deferOperationType && isTypeIdenticalTo(resultType, deferOperationType)) {
                    resultType = undefined;
                }

                // Might be a valid primitive that can be part of this operation. If the number
                // of combinations is 1, then we can just fallback to standard behavior, but if not,
                // we need to check deeper and append the result to the union.
                if (resultType === undefined && combinations.length > 1) {
                    resultType = checkDeeper(leftType, rightType);
                }

                // Both operands either have no overloads, or both have deferred.
                if (resultType === undefined) {
                    // All union members must be valid operations
                    resultMembers = [];
                    break;
                }
                resultMembers.push(resultType);
            }

            const result = resultMembers.length === 0 ? undefined : getUnionType(resultMembers);
            (links.tsoverOverloadReturnTypes ||= new Map()).set(cacheKey, result || false);
            return result;
        }
        finally {
            links.tsoverOverloadReturnTypesResolving?.delete(cacheKey);
        }
    }
  `,
    );

    // Making some functions public for use outside of the type checker (by the plugin)
    checkerContent = injectAfter(
      checkerContent,
      /const checker: TypeChecker = {/,
      `
      __tsover__isInUseTsoverScope,
      __tsover__isInUseGpuScope,
      __tsover__couldHaveOverloadedOperators,
      `,
    );

    checkerContent = injectAfter(
      checkerContent,
      /function checkBinaryLikeExpressionWorker\([\S\s]*const operator = operatorToken\.kind;/,
      `
      const overloadedType = __tsover__getOverloadReturnType(
        operatorToken.parent as BinaryExpression,
        left,
        operator,
        right,
        leftType,
        rightType,
        (lt, rt) => checkBinaryLikeExpressionWorker(left, operatorToken, right, lt, rt, checkMode, errorNode),
      );
      if (overloadedType) {
          if (operator in __tsover__compoundOperators) {
            checkAssignmentOperator(overloadedType);
          }
          return overloadedType;
      }
      {
          // Operator overloading is gated off but the operands carry an overload — surface a warning
          // pointing at the disabling condition so the user can opt in.
          const __tsover__baseOp = __tsover__compoundOperators[operator] ?? operator;
          const __tsover__knownSymbolName = __tsover__overloaded[__tsover__baseOp as keyof typeof __tsover__overloaded];
          if (
              __tsover__knownSymbolName &&
              !__tsover__shouldSuppressDisabledWarning(operator, leftType, rightType) &&
              __tsover__hasOverloadProperty(left, right, leftType, rightType, __tsover__knownSymbolName)
          ) {
              if (__tsover__isExplicitlyDisabled()) {
                  errorOrSuggestion(/*isError*/ true, operatorToken, Diagnostics.Operator_overloading_for_0_is_disabled_because_tsover_runtime_Slashdisable_has_been_imported_in_the_program, tokenToString(operator));
              }
              else if (!__tsover__isInOverloadingScope(left)) {
                  errorOrSuggestion(/*isError*/ true, operatorToken, Diagnostics.Operator_overloading_for_0_is_disabled_outside_of_a_use_tsover_or_use_gpu_scope, tokenToString(operator));
              }
          }
      }
      `,
    );

    await writeFile(checkerPath, checkerContent);

    console.log('  ✓ Patched checker.ts');
  } catch (error) {
    patchErrors.push('  ✗ Could not find pattern in checker.ts');
    patchErrors.push(error);
  }

  // Patch commandLineParser.ts - add tsover lib entry
  const cmdParserPath = resolve(typescriptTargetDir, 'src', 'compiler', 'commandLineParser.ts');
  let cmdParserContent = await readFile(cmdParserPath, 'utf-8');

  // Look for the esnext.sharedmemory entry and insert tsover after it
  const cmdParserPattern = /(\["esnext\.sharedmemory", "lib\.esnext\.sharedmemory\.d\.ts"\],)/;
  if (cmdParserPattern.test(cmdParserContent)) {
    cmdParserContent = SWM_CHANGE_NOTICE + cmdParserContent;
    cmdParserContent = cmdParserContent.replace(
      cmdParserPattern,
      `$1\n    ["tsover", "lib.tsover.d.ts"],`,
    );
    await writeFile(cmdParserPath, cmdParserContent);
    console.log('  ✓ Patched commandLineParser.ts');
  } else {
    patchErrors.push('  ✗ Could not find pattern in commandLineParser.ts');
  }

  // Patch libs.json - add tsover to end of libs array
  try {
    const libsJsonPath = resolve(typescriptTargetDir, 'src', 'lib', 'libs.json');
    const libsJsonContent = jsonc.parse(
      await readFile(libsJsonPath, 'utf-8'),
    ) as jsonc.CommentObject;

    (libsJsonContent!.libs as jsonc.CommentArray<string>)!.push('tsover');
    await writeFile(libsJsonPath, jsonc.stringify(libsJsonContent, undefined, 4));
    console.log('  ✓ Patched libs.json');
  } catch (error) {
    patchErrors.push('  ✗ Could not find libs array end in libs.json');
    patchErrors.push(error);
  }

  // Patch diagnosticMessages.json
  try {
    const diagnosticsJsonPath = resolve(
      typescriptTargetDir,
      'src',
      'compiler',
      'diagnosticMessages.json',
    );
    const diagnosticsJsonContent = jsonc.parse(
      await readFile(diagnosticsJsonPath, 'utf-8'),
    ) as jsonc.CommentObject;

    const diagnosticCodes = (Object.values(diagnosticsJsonContent) as jsonc.CommentObject[])
      .map((d) => d.code as number)
      .toSorted((a, b) => a - b);
    // Choosing the last diagnostic code and incrementing it by 1
    const baseCode = diagnosticCodes[diagnosticCodes.length - 1] + 1;
    jsonc.assign(diagnosticsJsonContent, {
      "Operator overloading for '{0}' is disabled outside of a 'use tsover' or 'use gpu' scope.": {
        category: 'Warning',
        code: baseCode,
      },
      'Operator overloading for \'{0}\' is disabled because "tsover-runtime/disable" has been imported in the program.':
        {
          category: 'Warning',
          code: baseCode + 1,
        },
    });
    await writeFile(diagnosticsJsonPath, jsonc.stringify(diagnosticsJsonContent, undefined, 4));
    console.log('  ✓ Patched diagnosticMessages.json');
  } catch (error) {
    patchErrors.push('  ✗ Could not patch diagnosticMessages.json');
    patchErrors.push(error);
  }

  // Patch program.ts - auto-load lib.tsover.d.ts so the fork is enabled by default.
  const programPath = resolve(typescriptTargetDir, 'src', 'compiler', 'program.ts');
  let programContent = await readFile(programPath, 'utf-8');

  try {
    programContent = SWM_CHANGE_NOTICE + programContent;

    let injected = `
                // tsover: always include lib.tsover.d.ts so the fork's TsoverEnabled
                // defaults to true. Disable program-wide via "types": ["tsover-runtime/disable"].`;
    // Some versions of program.ts require an additional parameter to `processRootFile`
    if (programContent.includes('/*ignoreNoDefaultLib*/')) {
      injected += `
                processRootFile(pathForLibFile("lib.tsover.d.ts"), /*isDefaultLib*/ true, /*ignoreNoDefaultLib*/ false, { kind: FileIncludeKind.LibFile });`;
    } else {
      injected += `
                processRootFile(pathForLibFile("lib.tsover.d.ts"), /*isDefaultLib*/ true, { kind: FileIncludeKind.LibFile });`;
    }

    programContent = injectAfter(
      programContent,
      /forEach\(options\.lib, \(libFileName, index\) => \{[\s\S]*?\}\);\s*\}\s*\);/,
      injected,
    );

    await writeFile(programPath, programContent);
    console.log('  ✓ Patched program.ts');
  } catch (error) {
    patchErrors.push('  ✗ Could not find pattern in program.ts');
    patchErrors.push(error);
  }

  // Create tsover.d.ts. Only the enabled marker lives here; SymbolConstructor
  // augmentations and the TsoverEnabled type are owned by tsover-runtime.
  const tsoverDtsPath = resolve(typescriptTargetDir, 'src', 'lib', 'tsover.d.ts');
  const tsoverDtsContent = `${SWM_LICENSE}
declare var __tsover__enabled: true;
`;
  await writeFile(tsoverDtsPath, tsoverDtsContent);
  console.log('  ✓ Created tsover.d.ts');

  // Rebuild after patching
  console.log('Rebuilding TypeScript with patches...');
  await $`npx --yes hereby@latest`;

  console.log(`✓ Successfully patched TypeScript ${tag}`);

  // Show diff
  console.log('\nChanges applied:');
  console.log('================');
  await $`git diff -w`.cwd(typescriptTargetDir);

  // Show errors
  if (patchErrors.length > 0) {
    console.error('\nErrors:');
    console.error('========');
    console.error(patchErrors.join('\n'));
  }
} finally {
  // Restore original working directory
  process.chdir(originalCwd);
}
