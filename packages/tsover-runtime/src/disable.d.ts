/**
 * Side-effect-free type-only module that disables tsover-aware type
 * annotations by flipping `TsoverEnabled` to `false`.
 *
 * Add to a tsconfig's `types` array to disable program-wide:
 *
 *   { "compilerOptions": { "types": ["tsover-runtime/disable"] } }
 *
 * No-op under vanilla TypeScript, where `TsoverEnabled` is already `false`.
 */

declare global {
  var __tsover__disabled: true;
}

export { };
