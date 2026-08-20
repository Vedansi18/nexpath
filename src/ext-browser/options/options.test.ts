// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const fetchMock = vi.fn();

const mockOnChanged = vi.fn();
vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: mockGet, set: mockSet }, onChanged: { addListener: mockOnChanged } } },
}));

function setupDom(): void {
  document.body.innerHTML = `
    <input id="api-key" />
    <button id="test-key"></button>
    <button id="save-key"></button>
    <p id="key-status"></p>
    <div id="frequency-group"></div>
    <div id="role-group"></div>
    <div id="self-check"></div>
  `;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadOptionsModule(): Promise<void> {
  setupDom();
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  await import('./options.js');
  await flush();
}

function els() {
  return {
    input: document.getElementById('api-key') as HTMLInputElement,
    testBtn: document.getElementById('test-key') as HTMLButtonElement,
    saveBtn: document.getElementById('save-key') as HTMLButtonElement,
    status: document.getElementById('key-status') as HTMLParagraphElement,
    selfCheck: document.getElementById('self-check') as HTMLDivElement,
    freqGroup: document.getElementById('frequency-group') as HTMLDivElement,
    roleGroup: document.getElementById('role-group') as HTMLDivElement,
  };
}

function radioFor(group: HTMLDivElement, value: string): HTMLInputElement {
  return group.querySelector(`input[value="${value}"]`) as HTMLInputElement;
}

describe('options.ts', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    fetchMock.mockReset();
    mockSet.mockResolvedValue(undefined);
  });

  describe('loadKey', () => {
    it('populates the input and shows "Key saved" when a key is already stored', async () => {
      mockGet.mockResolvedValue({ openai_api_key: 'sk-existing' });
      await loadOptionsModule();

      const { input, status } = els();
      expect(input.value).toBe('sk-existing');
      expect(status.textContent).toContain('Key saved');
    });

    it('leaves the input empty when no key is stored', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      const { input, status } = els();
      expect(input.value).toBe('');
      expect(status.textContent).toBe('');
    });

    it('renders self-check "Not set" when no key is stored', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      expect(els().selfCheck.innerHTML).toContain('Not set');
    });

    it('renders self-check "Saved" when a key is stored', async () => {
      mockGet.mockResolvedValue({ openai_api_key: 'sk-existing' });
      await loadOptionsModule();

      expect(els().selfCheck.innerHTML).toContain('Saved');
    });

    it('surfaces an error status when the initial load fails (no silent unhandled rejection)', async () => {
      // e.g. an invalidated extension context — storage.get rejects. The fire-and-forget
      // init must report this to the user, not drop it as an unhandled rejection.
      mockGet.mockRejectedValue(new Error('Extension context invalidated'));
      await loadOptionsModule();

      expect(els().status.textContent).toContain("Couldn't load saved settings");
    });
  });

  describe('advisory frequency + role selectors — same value sets/labels/defaults as the CLI installer', () => {
    it('renders the 3 High/Medium/Low frequency options and 4 role options, matching the CLI picker exactly', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      const { freqGroup, roleGroup } = els();
      expect(freqGroup.querySelectorAll('input[type="radio"]').length).toBe(3);
      expect(radioFor(freqGroup, 'optimum')).not.toBeNull();
      expect(radioFor(freqGroup, 'every_event')).not.toBeNull();
      expect(radioFor(freqGroup, 'major_only')).not.toBeNull();

      expect(roleGroup.querySelectorAll('input[type="radio"]').length).toBe(4);
      expect(radioFor(roleGroup, 'founder')).not.toBeNull();
      expect(radioFor(roleGroup, 'vibe_coder')).not.toBeNull();
      expect(radioFor(roleGroup, 'indie_hacker')).not.toBeNull();
      expect(radioFor(roleGroup, 'pm')).not.toBeNull();
    });

    it('defaults to every_event / founder when nothing is stored — matches the CLI installer\'s DEFAULT_FREQUENCY/DEFAULT_ROLE', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      const { freqGroup, roleGroup } = els();
      expect(radioFor(freqGroup, 'every_event').checked).toBe(true);
      expect(radioFor(freqGroup, 'optimum').checked).toBe(false);
      expect(radioFor(roleGroup, 'founder').checked).toBe(true);
    });

    it('pre-selects the stored frequency and role values', async () => {
      mockGet.mockResolvedValue({ advisory_frequency: 'optimum', role: 'indie_hacker' });
      await loadOptionsModule();

      const { freqGroup, roleGroup } = els();
      expect(radioFor(freqGroup, 'optimum').checked).toBe(true);
      expect(radioFor(freqGroup, 'every_event').checked).toBe(false);
      expect(radioFor(roleGroup, 'indie_hacker').checked).toBe(true);
    });

    it('persists the chosen frequency to storage on change', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      const { freqGroup } = els();
      radioFor(freqGroup, 'major_only').click();
      await flush();

      expect(mockSet).toHaveBeenCalledWith({ advisory_frequency: 'major_only' });
    });

    it('persists the chosen role to storage on change', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      const { roleGroup } = els();
      radioFor(roleGroup, 'pm').click();
      await flush();

      expect(mockSet).toHaveBeenCalledWith({ role: 'pm' });
    });

    it('reflects the current frequency and role in the self-check panel', async () => {
      mockGet.mockResolvedValue({ advisory_frequency: 'optimum', role: 'vibe_coder' });
      await loadOptionsModule();

      const html = els().selfCheck.innerHTML;
      expect(html).toContain('High');
      expect(html).toContain('vibe coder');
    });
  });

  describe('save button', () => {
    beforeEach(async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();
    });

    it('shows an error and does not save when the input is empty', async () => {
      const { saveBtn, status } = els();
      saveBtn.click();
      await flush();

      expect(status.textContent).toContain('Please enter a key');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('shows an error and does not save when the key does not start with sk-', async () => {
      const { input, saveBtn, status } = els();
      input.value = 'bad-key';
      saveBtn.click();
      await flush();

      expect(status.textContent).toContain('must start with sk-');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('saves a valid key and updates status', async () => {
      const { input, saveBtn, status } = els();
      input.value = 'sk-valid';
      saveBtn.click();
      await flush();

      expect(mockSet).toHaveBeenCalledWith({ openai_api_key: 'sk-valid' });
      expect(status.textContent).toContain('Saved');
    });

    it('shows an error status when chrome.storage.local.set throws', async () => {
      mockSet.mockRejectedValueOnce(new Error('quota exceeded'));
      const { input, saveBtn, status } = els();
      input.value = 'sk-valid';
      saveBtn.click();
      await flush();

      expect(status.textContent).toContain('Save failed');
    });
  });


  describe('live refresh (storage.onChanged)', () => {
    it('re-renders the radio groups when the chooser writes the global keys', async () => {
      mockGet.mockResolvedValue({}); // arrange the initial-load read BEFORE importing the module
      await loadOptionsModule();
      const listener = mockOnChanged.mock.calls.at(-1)?.[0] as (c: Record<string, unknown>, a: string) => void;
      expect(listener).toBeTypeOf('function');
      mockGet.mockResolvedValue({ advisory_frequency: 'major_only' });
      listener({ advisory_frequency: { newValue: 'major_only' } }, 'local');
      await flush();
      const checked = document.querySelector('#frequency-group input[checked], #frequency-group input:checked') as HTMLInputElement | null;
      expect(checked?.value).toBe('major_only');
    });

    it('surfaces an error status when a live-refresh read fails (no silent unhandled rejection)', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();
      const listener = mockOnChanged.mock.calls.at(-1)?.[0] as (c: Record<string, unknown>, a: string) => void;

      mockGet.mockRejectedValue(new Error('read failed'));
      listener({ role: { newValue: 'pm' } }, 'local');
      await flush();

      expect(els().status.textContent).toContain("Couldn't refresh settings");
    });
  });
});
