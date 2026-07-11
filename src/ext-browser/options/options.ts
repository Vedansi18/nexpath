import browser from 'webextension-polyfill';

const KEY_NAME = 'openai_api_key';
const MODELS_URL = 'https://api.openai.com/v1/models';
const FREQUENCY_KEY = 'advisory_frequency';
const ROLE_KEY = 'role';

const input    = document.getElementById('api-key')      as HTMLInputElement;
const saveBtn  = document.getElementById('save-key')     as HTMLButtonElement;
const testBtn  = document.getElementById('test-key')     as HTMLButtonElement;
const keyStatus = document.getElementById('key-status')  as HTMLParagraphElement;
const checkEl  = document.getElementById('self-check')   as HTMLDivElement;
const freqGroup = document.getElementById('frequency-group') as HTMLDivElement;
const roleGroup = document.getElementById('role-group')      as HTMLDivElement;

// ── Advisory frequency + role — same value sets, labels, and defaults as the CLI
// installer (src/cli/commands/install.ts's defaultFreqPrompt/ROLE_OPTIONS). The CLI's
// picker deliberately exposes only 3 of its 5 frequency levels (High/Medium/Low) —
// 'once_per_session' and 'off' stay valid via `nexpath config set` but are hidden
// from the interactive picker. Mirroring that same restraint here, not adding more.

const FREQUENCY_OPTIONS = [
  { value: 'optimum',     label: 'High' },
  { value: 'every_event', label: 'Medium' },
  { value: 'major_only',  label: 'Low' },
] as const;
const DEFAULT_FREQUENCY = 'every_event';

const ROLE_OPTIONS = [
  { value: 'founder',      label: 'founder / product creator' },
  { value: 'vibe_coder',   label: 'vibe coder' },
  { value: 'indie_hacker', label: 'indie hacker' },
  { value: 'pm',           label: 'product manager' },
] as const;
const DEFAULT_ROLE = 'founder';

function buildRadioGroup(
  container: HTMLDivElement,
  name: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  selected: string,
  onChange: (value: string) => void,
): void {
  container.innerHTML = '';
  for (const opt of options) {
    const id = `${name}-${opt.value}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'radio-option';
    wrapper.htmlFor = id;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.id = id;
    radio.value = opt.value;
    radio.checked = opt.value === selected;
    radio.addEventListener('change', () => {
      if (radio.checked) onChange(opt.value);
    });

    const labelSpan = document.createElement('span');
    labelSpan.className = 'radio-label';
    labelSpan.textContent = opt.label;

    wrapper.appendChild(radio);
    wrapper.appendChild(labelSpan);
    container.appendChild(wrapper);
  }
}

// ── Key persistence ───────────────────────────────────────────────────────────

async function loadKey(): Promise<void> {
  const result = await browser.storage.local.get(KEY_NAME);
  const saved = result[KEY_NAME];
  if (typeof saved === 'string' && saved.length > 0) {
    input.value = saved;
    setKeyStatus('Key saved — click Test to validate', '');
  }
  await loadFrequencyAndRole();
  await renderSelfCheck();
}

// ── Advisory frequency + role persistence ─────────────────────────────────────

async function loadFrequencyAndRole(): Promise<void> {
  const result = await browser.storage.local.get([FREQUENCY_KEY, ROLE_KEY]);
  const freq = typeof result[FREQUENCY_KEY] === 'string' ? result[FREQUENCY_KEY] as string : DEFAULT_FREQUENCY;
  const role = typeof result[ROLE_KEY] === 'string' ? result[ROLE_KEY] as string : DEFAULT_ROLE;

  buildRadioGroup(freqGroup, 'frequency', FREQUENCY_OPTIONS, freq, async (value) => {
    await browser.storage.local.set({ [FREQUENCY_KEY]: value });
    await renderSelfCheck();
  });
  buildRadioGroup(roleGroup, 'role', ROLE_OPTIONS, role, async (value) => {
    await browser.storage.local.set({ [ROLE_KEY]: value });
    await renderSelfCheck();
  });
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
  const result = await browser.storage.local.get([KEY_NAME, FREQUENCY_KEY, ROLE_KEY]);
  const hasKey = typeof result[KEY_NAME] === 'string' && (result[KEY_NAME] as string).length > 0;

  const freqValue = typeof result[FREQUENCY_KEY] === 'string' ? result[FREQUENCY_KEY] as string : DEFAULT_FREQUENCY;
  const roleValue = typeof result[ROLE_KEY] === 'string' ? result[ROLE_KEY] as string : DEFAULT_ROLE;
  const freqLabel = FREQUENCY_OPTIONS.find((o) => o.value === freqValue)?.label ?? freqValue;
  const roleLabel = ROLE_OPTIONS.find((o) => o.value === roleValue)?.label ?? roleValue;

  checkEl.innerHTML = `
    <div class="check-row">
      <span class="check-label">API key</span>
      <span class="check-val ${hasKey ? 'ok' : 'err'}">${hasKey ? 'Saved ✅' : 'Not set ❌'}</span>
    </div>
    <div class="check-row">
      <span class="check-label">Advisory frequency</span>
      <span class="check-val ok">${escHtml(freqLabel)}</span>
    </div>
    <div class="check-row">
      <span class="check-label">Project role</span>
      <span class="check-val ok">${escHtml(roleLabel)}</span>
    </div>
    <div class="check-row">
      <span class="check-label">Capture sites</span>
      <span class="check-val ok">Replit · Bolt · Lovable ✅</span>
    </div>
  `;
}

loadKey();

// Live-refresh: the popup's Alt+Shift+T chooser writes the SAME global keys this page
// shows — without this listener the page displayed stale values until a manual
// reload, which read as "the chooser and the settings are two different settings"
// (user report, 2026-07-10). storage.onChanged re-renders on any relevant write.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (FREQUENCY_KEY in changes || ROLE_KEY in changes || KEY_NAME in changes) {
    void loadFrequencyAndRole();
    void renderSelfCheck();
  }
});
