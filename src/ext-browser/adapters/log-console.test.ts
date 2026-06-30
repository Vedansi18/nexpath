import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogAdapter } from './log-console.js';

describe('ConsoleLogAdapter', () => {
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const infoSpy  = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    debugSpy.mockClear();
    infoSpy.mockClear();
    warnSpy.mockClear();
  });

  it('calls console.debug with prefix and key', () => {
    const log = new ConsoleLogAdapter('[test]');
    log.debug('my_event');
    expect(debugSpy).toHaveBeenCalledWith('[test]', 'my_event', '');
  });

  it('calls console.debug with data when provided', () => {
    const log = new ConsoleLogAdapter('[test]');
    log.debug('my_event', { foo: 1 });
    expect(debugSpy).toHaveBeenCalledWith('[test]', 'my_event', { foo: 1 });
  });

  it('calls console.info', () => {
    const log = new ConsoleLogAdapter('[test]');
    log.info('info_event', { bar: 'baz' });
    expect(infoSpy).toHaveBeenCalledWith('[test]', 'info_event', { bar: 'baz' });
  });

  it('calls console.warn', () => {
    const log = new ConsoleLogAdapter('[test]');
    log.warn('warn_event');
    expect(warnSpy).toHaveBeenCalledWith('[test]', 'warn_event', '');
  });

  it('uses default prefix [nexpath] when none given', () => {
    const log = new ConsoleLogAdapter();
    log.debug('x');
    expect(debugSpy).toHaveBeenCalledWith('[nexpath]', 'x', '');
  });
});
