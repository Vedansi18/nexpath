import { describe, it, expect } from 'vitest';
import {
  isPromptSubmitMsg,
  isResponseStopMsg,
  isShowAdvisoryMsg,
  isPanelEventMsg,
  isPromptCapturedMsg,
  isResponseStoppedMsg,
  isFetchPromptMsg,
  isAdvisoryFooterIntentMsg,
} from './ipc.js';

describe('IPC type guards', () => {
  describe('isFetchPromptMsg', () => {
    it('returns true for a valid FetchPromptMsg', () => {
      expect(isFetchPromptMsg({
        type: 'nexpath:fetch-prompt',
        promptText: 'build a nav',
        agent: 'bolt',
      })).toBe(true);
    });

    it('returns false for other message types, null, and non-objects', () => {
      expect(isFetchPromptMsg({ type: 'nexpath:prompt-captured' })).toBe(false);
      expect(isFetchPromptMsg(null)).toBe(false);
      expect(isFetchPromptMsg('nexpath:fetch-prompt')).toBe(false);
    });
  });

  describe('isPromptSubmitMsg', () => {
    it('returns true for valid PromptSubmitMsg', () => {
      expect(isPromptSubmitMsg({
        type: 'nexpath:prompt-submit',
        promptText: 'hello',
        projectRoot: '/proj',
        agent: 'replit',
        tabId: 1,
      })).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isPromptSubmitMsg({ type: 'nexpath:response-stop' })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isPromptSubmitMsg(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isPromptSubmitMsg('string')).toBe(false);
    });
  });

  describe('isResponseStopMsg', () => {
    it('returns true for valid ResponseStopMsg', () => {
      expect(isResponseStopMsg({
        type: 'nexpath:response-stop',
        projectRoot: '/proj',
        agent: 'bolt',
        tabId: 2,
      })).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isResponseStopMsg({ type: 'nexpath:prompt-submit' })).toBe(false);
    });
  });

  describe('isShowAdvisoryMsg', () => {
    it('returns true for valid ShowAdvisoryMsg', () => {
      expect(isShowAdvisoryMsg({
        type: 'nexpath:show-advisory',
        payload: {},
      })).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isShowAdvisoryMsg({ type: 'nexpath:prompt-submit' })).toBe(false);
    });
  });

  describe('isPanelEventMsg', () => {
    it('returns true for valid PanelEventMsg', () => {
      expect(isPanelEventMsg({
        type: 'nexpath:panel-event',
        event: { type: 'dismiss', advisoryId: 'abc' },
      })).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isPanelEventMsg({ type: 'nexpath:show-advisory' })).toBe(false);
    });
  });

  describe('isPromptCapturedMsg', () => {
    it('returns true for valid PromptCapturedMsg', () => {
      expect(isPromptCapturedMsg({
        type: 'nexpath:prompt-captured',
        promptText: 'hi',
        agent: 'replit',
      })).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isPromptCapturedMsg({ type: 'nexpath:response-stopped' })).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isPromptCapturedMsg(undefined)).toBe(false);
    });
  });

  describe('isResponseStoppedMsg', () => {
    it('returns true for valid ResponseStoppedMsg', () => {
      expect(isResponseStoppedMsg({
        type: 'nexpath:response-stopped',
        agent: 'lovable',
      })).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isResponseStoppedMsg({ type: 'nexpath:prompt-captured' })).toBe(false);
    });
  });

  describe('isAdvisoryFooterIntentMsg', () => {
    it('returns true for a valid disable-project intent', () => {
      expect(isAdvisoryFooterIntentMsg({
        type: 'nexpath:advisory-footer-intent',
        intent: 'disable-project',
        projectRoot: '/proj',
      })).toBe(true);
    });

    it('returns true for a valid open-settings intent', () => {
      expect(isAdvisoryFooterIntentMsg({
        type: 'nexpath:advisory-footer-intent',
        intent: 'open-settings',
        projectRoot: '/proj',
      })).toBe(true);
    });

    it('returns false for an unknown intent value', () => {
      expect(isAdvisoryFooterIntentMsg({
        type: 'nexpath:advisory-footer-intent',
        intent: 'nuke-everything',
        projectRoot: '/proj',
      })).toBe(false);
    });

    it('returns false when projectRoot is missing/non-string', () => {
      expect(isAdvisoryFooterIntentMsg({
        type: 'nexpath:advisory-footer-intent',
        intent: 'disable-project',
      })).toBe(false);
    });

    it('returns false for wrong type / null', () => {
      expect(isAdvisoryFooterIntentMsg({ type: 'nexpath:prompt-submit' })).toBe(false);
      expect(isAdvisoryFooterIntentMsg(null)).toBe(false);
    });
  });

  it('all guards return false for empty object', () => {
    const guards = [
      isPromptSubmitMsg, isResponseStopMsg, isShowAdvisoryMsg,
      isPanelEventMsg, isPromptCapturedMsg, isResponseStoppedMsg,
      isAdvisoryFooterIntentMsg,
    ];
    for (const guard of guards) {
      expect(guard({})).toBe(false);
    }
  });
});
