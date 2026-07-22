// Re-export bridge — source of truth moved to src/core/classifier/PromptClassifier.ts.
// All existing callers of this path continue to work unchanged.
// Note: ClassifierOptions now also accepts `tidfClassifier` (optional).
// CLI (auto.ts) passes classifyWithTFIDF explicitly; tests and other callers omit it (opts = {}).
export * from '../core/classifier/PromptClassifier.js';
