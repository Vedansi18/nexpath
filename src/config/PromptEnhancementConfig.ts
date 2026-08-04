import type { Database } from 'sql.js';
import { setConfig } from '../store/config.js';
import type { Store } from '../store/db.js';
import { ConfigValidationError } from './prompt-enhancement-errors.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_DEFAULT,
  PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY,
} from './prompt-enhancement-keys.js';

export {
  PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_DEFAULT,
  PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY,
} from './prompt-enhancement-keys.js';

export const PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_VALUES = ['on', 'off'] as const;
export type PromptEnhancementSequenceEnabled = typeof PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_VALUES[number];

export type PromptEnhancementValidatedEffectiveConfigStateV1 =
  | 'no_config_needed'
  | 'config_not_defined_yet'
  | 'validated_default'
  | 'validated_project_override'
  | 'validated_global_override'
  | 'invalid_or_unknown_key'
  | 'disabled_by_config';

export interface PromptEnhancementSequenceConfigSnapshotV1 {
  configKey: typeof PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY;
  sequenceEnabled: PromptEnhancementSequenceEnabled;
  validatedEffectiveConfigState: PromptEnhancementValidatedEffectiveConfigStateV1;
  sourceScope: 'default' | 'global' | 'project';
  arbitraryConfigRowsAreAuthority: false;
  oldDecisionSessionConfigIsAuthority: false;
}

export function isPromptEnhancementSequenceConfigKey(key: string): boolean {
  return key === PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY
    || (key.startsWith(PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY + ":")
      && key.length > PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY.length + 1);
}

export function promptEnhancementSequenceProjectKey(projectRoot: string): string {
  if (projectRoot.trim().length === 0) throw new ConfigValidationError('Project root is required for a scoped PE config key.');
  return `${PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY}:${projectRoot}`;
}

export function validatePromptEnhancementSequenceEnabled(value: string): PromptEnhancementSequenceEnabled {
  if (!(PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_VALUES as readonly string[]).includes(value)) {
    throw new ConfigValidationError(
      `Invalid ${PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY} "${value}". Valid values: on, off`,
    );
  }
  return value as PromptEnhancementSequenceEnabled;
}

export function setPromptEnhancementSequenceEnabled(store: Store, key: string, value: string): void {
  if (!isPromptEnhancementSequenceConfigKey(key)) {
    throw new ConfigValidationError(`Invalid PE config key "${key}".`);
  }
  setConfig(store, key, validatePromptEnhancementSequenceEnabled(value));
}

function explicitConfigValue(db: Database, key: string): string | undefined {
  const result = db.exec('SELECT value FROM config WHERE key = ?', [key]);
  return result[0]?.values[0]?.[0] as string | undefined;
}

function snapshot(
  value: PromptEnhancementSequenceEnabled,
  state: PromptEnhancementValidatedEffectiveConfigStateV1,
  sourceScope: PromptEnhancementSequenceConfigSnapshotV1['sourceScope'],
): PromptEnhancementSequenceConfigSnapshotV1 {
  return {
    configKey: PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY,
    sequenceEnabled: value,
    validatedEffectiveConfigState: state,
    sourceScope,
    arbitraryConfigRowsAreAuthority: false,
    oldDecisionSessionConfigIsAuthority: false,
  };
}

export function resolvePromptEnhancementSequenceConfig(
  db: Database,
  projectRoot?: string,
): PromptEnhancementSequenceConfigSnapshotV1 {
  if (projectRoot !== undefined && projectRoot.trim().length > 0) {
    const projectValue = explicitConfigValue(db, promptEnhancementSequenceProjectKey(projectRoot));
    if (projectValue !== undefined) {
      if (!(PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_VALUES as readonly string[]).includes(projectValue)) {
        return snapshot('off', 'invalid_or_unknown_key', 'project');
      }
      return snapshot(
        projectValue as PromptEnhancementSequenceEnabled,
        projectValue === 'off' ? 'disabled_by_config' : 'validated_project_override',
        'project',
      );
    }
  }

  const globalValue = explicitConfigValue(db, PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY);
  if (globalValue !== undefined) {
    if (!(PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_VALUES as readonly string[]).includes(globalValue)) {
      return snapshot('off', 'invalid_or_unknown_key', 'global');
    }
    return snapshot(
      globalValue as PromptEnhancementSequenceEnabled,
      globalValue === 'off' ? 'disabled_by_config' : 'validated_global_override',
      'global',
    );
  }

  return snapshot(PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_DEFAULT, 'validated_default', 'default');
}

