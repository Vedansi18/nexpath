// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const fetchMock = vi.fn();

function setupDom(): void {
  document.body.innerHTML = `
    <input id="api-key" />
    <button id="test-key"></button>
    <button id="save-key"></button>
    <p id="key-status"></p>
    <div id="self-check"></div>
  `;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadOptionsModule(): Promise<void> {
  setupDom();
  vi.resetModules();
  vi.stubGlobal('chrome', { storage: { local: { get: mockGet, set: mockSet } } });
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
  };
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

  describe('test button', () => {
    beforeEach(async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();
    });

    it('shows an error and does not call fetch when the input is empty', async () => {
      const { testBtn, status } = els();
      testBtn.click();
      await flush();

      expect(status.textContent).toContain('Enter a key first');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls the OpenAI models endpoint with the Authorization header', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const { input, testBtn } = els();
      input.value = 'sk-valid';
      testBtn.click();
      await flush();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        { headers: { Authorization: 'Bearer sk-valid' } },
      );
    });

    it('saves the key and shows "Key valid" on a 200 response', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const { input, testBtn, status } = els();
      input.value = 'sk-valid';
      testBtn.click();
      await flush();

      expect(mockSet).toHaveBeenCalledWith({ openai_api_key: 'sk-valid' });
      expect(status.textContent).toContain('Key valid');
    });

    it('shows "Invalid key" on a 401 response without saving', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      const { input, testBtn, status } = els();
      input.value = 'sk-bad';
      testBtn.click();
      await flush();

      expect(status.textContent).toContain('Invalid key');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('shows the status code on other non-ok responses', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const { input, testBtn, status } = els();
      input.value = 'sk-whatever';
      testBtn.click();
      await flush();

      expect(status.textContent).toContain('500');
    });

    it('shows a network error status when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      const { input, testBtn, status } = els();
      input.value = 'sk-whatever';
      testBtn.click();
      await flush();

      expect(status.textContent).toContain('Network error');
    });

    it('re-enables the test button after validation completes', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const { input, testBtn } = els();
      input.value = 'sk-valid';
      testBtn.click();
      await flush();

      expect(testBtn.disabled).toBe(false);
    });
  });

  describe('self-check XSS safety', () => {
    it('HTML-escapes nexpath_last_capture before rendering', async () => {
      mockGet.mockResolvedValue({ nexpath_last_capture: '<img src=x onerror=alert(1)>' });
      await loadOptionsModule();

      const html = els().selfCheck.innerHTML;
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img');
    });

    it('shows the fallback text when nexpath_last_capture is not set', async () => {
      mockGet.mockResolvedValue({});
      await loadOptionsModule();

      expect(els().selfCheck.innerHTML).toContain('None yet');
    });
  });
});
