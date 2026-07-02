import browser from 'webextension-polyfill';

const KEY_NAME = 'openai_api_key';
const MODELS_URL = 'https://api.openai.com/v1/models';

const input    = document.getElementById('api-key')      as HTMLInputElement;
const saveBtn  = document.getElementById('save-key')     as HTMLButtonElement;
const testBtn  = document.getElementById('test-key')     as HTMLButtonElement;
const keyStatus = document.getElementById('key-status')  as HTMLParagraphElement;
const checkEl  = document.getElementById('self-check')   as HTMLDivElement;

// ── Key persistence ───────────────────────────────────────────────────────────

async function loadKey(): Promise<void> {
  const result = await browser.storage.local.get(KEY_NAME);
  const saved = result[KEY_NAME];
  if (typeof saved === 'string' && saved.length > 0) {
    input.value = saved;
    setKeyStatus('Key saved — click Test to validate', '');
  }
  await renderSelfCheck();
}

function setKeyStatus(msg: string, kind: 'ok' | 'err' | ''): void {
  keyStatus.textContent = msg;
  keyStatus.className = `status ${kind}`;
}

saveBtn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) { setKeyStatus('Please enter a key', 'err'); return; }
  if (!key.startsWith('sk-')) { setKeyStatus('Key must start with sk-', 'err'); return; }
  try {
    await browser.storage.local.set({ [KEY_NAME]: key });
    setKeyStatus('Saved — click Test to validate', '');
    await renderSelfCheck();
  } catch (err) {
    setKeyStatus(`Save failed: ${String(err)}`, 'err');
  }
});

// ── Key validation (real OpenAI call via GET /v1/models) ─────────────────────

testBtn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) { setKeyStatus('Enter a key first', 'err'); return; }

  setKeyStatus('Validating…', '');
  testBtn.disabled = true;

  try {
    const resp = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (resp.ok) {
      await browser.storage.local.set({ [KEY_NAME]: key });
      setKeyStatus('Key valid ✅', 'ok');
    } else if (resp.status === 401) {
      setKeyStatus('Invalid key ❌ — check and re-enter', 'err');
    } else {
      setKeyStatus(`OpenAI returned ${resp.status} — try again`, 'err');
    }
  } catch {
    setKeyStatus('Network error — check connection', 'err');
  } finally {
    testBtn.disabled = false;
    await renderSelfCheck();
  }
});

// ── Self-check panel ──────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderSelfCheck(): Promise<void> {
  const result = await browser.storage.local.get([KEY_NAME, 'nexpath_last_capture']);
  const hasKey = typeof result[KEY_NAME] === 'string' && (result[KEY_NAME] as string).length > 0;
  const lastCapture = result['nexpath_last_capture'] as string | undefined;

  checkEl.innerHTML = `
    <div class="check-row">
      <span class="check-label">API key</span>
      <span class="check-val ${hasKey ? 'ok' : 'err'}">${hasKey ? 'Saved ✅' : 'Not set ❌'}</span>
    </div>
    <div class="check-row">
      <span class="check-label">Last capture</span>
      <span class="check-val">${lastCapture ? escHtml(lastCapture) : 'None yet — use Replit, Bolt, or Lovable'}</span>
    </div>
    <div class="check-row">
      <span class="check-label">Capture sites</span>
      <span class="check-val ok">Replit · Bolt · Lovable ✅</span>
    </div>
  `;
}

loadKey();
