import type { AdvisoryPayload } from '../../core/ports/ui.port.js';

/**
 * Minimal stub panel for B2.
 * Renders advisory payload as a Shadow-DOM card so it doesn't collide with host page styles.
 * B5b replaces this with the real UI (mountNexpathPanel from ui-contract.ts).
 */

export function mountStubPanel(
  root: HTMLElement,
  payload: AdvisoryPayload,
  onDismiss: () => void,
): void {
  const shadow = root.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      width: 340px; background: #1e1e2e; color: #cdd6f4;
      border: 1px solid #45475a; border-radius: 12px;
      padding: 16px; font: 14px/1.5 system-ui, sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .pinch { font-weight: 700; font-size: 16px; color: #cba6f7; }
    .stage { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; }
    .close { background: none; border: none; color: #6c7086; cursor: pointer; font-size: 18px; line-height: 1; padding: 0; }
    .close:hover { color: #cdd6f4; }
    .options { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
    .opt {
      background: #313244; border: 1px solid #45475a; border-radius: 8px;
      padding: 8px 12px; cursor: pointer; text-align: left; color: #cdd6f4;
      font: inherit;
    }
    .opt:hover { background: #45475a; }
    .opt-level { font-size: 10px; font-weight: 600; color: #89b4fa; text-transform: uppercase; margin-bottom: 2px; }
    .opt-title { font-size: 13px; font-weight: 600; }
    .opt-body { font-size: 12px; color: #a6adc8; margin-top: 2px; }
    .meta { margin-top: 8px; font-size: 11px; color: #585b70; text-align: right; }
  `;
  shadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = `
    <div class="header">
      <div>
        <div class="pinch">${escHtml(payload.pinchLabel)}</div>
        <div class="stage">${escHtml(payload.stage)}</div>
      </div>
      <button class="close" title="Dismiss">✕</button>
    </div>
    <div class="options">
      ${payload.options.map(opt => `
        <button class="opt">
          <div class="opt-level">${escHtml(opt.level)}</div>
          <div class="opt-title">${escHtml(opt.title)}</div>
          <div class="opt-body">${escHtml(opt.body)}</div>
        </button>
      `).join('')}
    </div>
    <div class="meta">nexpath · ${escHtml(payload.meta.agent)}</div>
  `;

  card.querySelector('.close')?.addEventListener('click', onDismiss);
  card.querySelectorAll('.opt').forEach((btn) => {
    btn.addEventListener('click', onDismiss);
  });

  shadow.appendChild(card);
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
