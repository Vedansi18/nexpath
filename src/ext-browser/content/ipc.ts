import type { AdvisoryPayload, PanelEvent } from '../../core/ports/ui.port.js';

/**
 * IPC message envelope types for all message channels:
 *   MAIN-world injector → content script (window.postMessage)
 *   content script → service worker (chrome.runtime.sendMessage)
 *   service worker → content script (chrome.tabs.sendMessage)
 *   content script → panel adapter (local function call)
 */

// ── Injector → Content ────────────────────────────────────────────────────────

export interface PromptCapturedMsg {
  type: 'nexpath:prompt-captured';
  promptText: string;
  agent: string;
}

export interface ResponseStoppedMsg {
  type: 'nexpath:response-stopped';
  agent: string;
}

export type InjectorToContentMsg = PromptCapturedMsg | ResponseStoppedMsg;

// ── Content → Service Worker ──────────────────────────────────────────────────

export interface PromptSubmitMsg {
  type: 'nexpath:prompt-submit';
  promptText: string;
  projectRoot: string;
  agent: string;
  tabId: number;
}

export interface ResponseStopMsg {
  type: 'nexpath:response-stop';
  projectRoot: string;
  agent: string;
  tabId: number;
}

export type ContentToSwMsg = PromptSubmitMsg | ResponseStopMsg;

// ── Service Worker → Content ──────────────────────────────────────────────────

export interface ShowAdvisoryMsg {
  type: 'nexpath:show-advisory';
  payload: AdvisoryPayload;
}

export type SwToContentMsg = ShowAdvisoryMsg;

// ── Content → Service Worker (panel event) ────────────────────────────────────

export interface PanelEventMsg {
  type: 'nexpath:panel-event';
  event: PanelEvent;
}

// ── Union type for all chrome.runtime messages ────────────────────────────────

export type ExtensionMsg =
  | PromptSubmitMsg
  | ResponseStopMsg
  | ShowAdvisoryMsg
  | PanelEventMsg;

// ── Type guards ───────────────────────────────────────────────────────────────

export function isPromptSubmitMsg(msg: unknown): msg is PromptSubmitMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'nexpath:prompt-submit';
}

export function isResponseStopMsg(msg: unknown): msg is ResponseStopMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'nexpath:response-stop';
}

export function isShowAdvisoryMsg(msg: unknown): msg is ShowAdvisoryMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'nexpath:show-advisory';
}

export function isPanelEventMsg(msg: unknown): msg is PanelEventMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'nexpath:panel-event';
}

export function isPromptCapturedMsg(msg: unknown): msg is PromptCapturedMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'nexpath:prompt-captured';
}

export function isResponseStoppedMsg(msg: unknown): msg is ResponseStoppedMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'nexpath:response-stopped';
}
