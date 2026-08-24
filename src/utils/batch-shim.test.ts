/** ⭐ RC57 — a .cmd/.bat NEXPATH_BIN must never be spawned raw (Node EINVAL, CVE-2024-27980). */
import { describe, it, expect } from 'vitest';
import { isWindowsBatchShim } from './batch-shim.js';

describe('⭐ RC57 — isWindowsBatchShim', () => {
  it('⭐ the live failing shim is detected', () => {
    expect(isWindowsBatchShim('C:\\Users\\Admin\\.nexpath\\bin\\nexpath.cmd', 'win32')).toBe(true);
  });
  it('.bat and case variants detected; trailing space tolerated', () => {
    expect(isWindowsBatchShim('C:\\x\\run.BAT', 'win32')).toBe(true);
    expect(isWindowsBatchShim('C:\\x\\Nexpath.CMD ', 'win32')).toBe(true);
  });
  it('real executables pass through', () => {
    expect(isWindowsBatchShim('C:\\Program Files\\nodejs\\node.exe', 'win32')).toBe(false);
  });
  it('⭐ POSIX never matches — Linux/mac behaviour byte-identical', () => {
    expect(isWindowsBatchShim('/usr/local/bin/nexpath.cmd', 'linux')).toBe(false);
    expect(isWindowsBatchShim('/usr/local/bin/nexpath', 'darwin')).toBe(false);
  });
  it('undefined/empty ⇒ false', () => {
    expect(isWindowsBatchShim(undefined, 'win32')).toBe(false);
    expect(isWindowsBatchShim('', 'win32')).toBe(false);
  });
});
