const KEY_NAME = 'openai_api_key';

const input  = document.getElementById('api-key')     as HTMLInputElement;
const saveBtn = document.getElementById('save-key')   as HTMLButtonElement;
const status  = document.getElementById('key-status') as HTMLParagraphElement;

async function loadKey(): Promise<void> {
  const result = await chrome.storage.local.get(KEY_NAME);
  if (typeof result[KEY_NAME] === 'string' && (result[KEY_NAME] as string).length > 0) {
    input.value = result[KEY_NAME] as string;
    setStatus('Key saved', 'ok');
  }
}

function setStatus(msg: string, kind: 'ok' | 'err' | ''): void {
  status.textContent = msg;
  status.className = `status ${kind}`;
}

saveBtn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) {
    setStatus('Please enter a key', 'err');
    return;
  }
  if (!key.startsWith('sk-')) {
    setStatus('Key must start with sk-', 'err');
    return;
  }
  try {
    await chrome.storage.local.set({ [KEY_NAME]: key });
    setStatus('Saved!', 'ok');
  } catch (err) {
    setStatus(`Error: ${String(err)}`, 'err');
  }
});

loadKey();
