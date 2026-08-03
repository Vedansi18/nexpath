# Nexpath CLI — Build Fast. Skip Nothing. 

> **A behaviour guidance layer for builders working with AI coding agents — vibe coders, indie hackers, founders, and product managers.**

Nexpath gives developers meaningful direction while they work with AI coding agents and AI code tools — helpful suggestions at the right moment that protect developer productivity, without slowing you down.


## Prompt Enhancement — A Practical Twist

Within Nexpath's broader behaviour-guidance vision, Prompt Enhancement is the first feature we're introducing as a practical twist: it saves vibe coders from writing every prompt detail by hand while preserving their original intent. When a task needs more rigour, it can suggest missing development practices, verification, or confirmation steps — encouraging users to give a mature development flow the time it needs to finish.


---

## What Is Nexpath CLI?

- A behaviour guidance system and developer productivity layer for builders using AI coding agents and AI code tools.
- Monitors your development sessions and understands where you are in your project lifecycle.
- Adds a **Prompt Quality Layer** at useful review moments, helping turn the prompt you already wrote into a stronger, editable version without changing its intent.
- Brings relevant advisory and absence-signal guidance into the prompt as practical sections — not as disconnected tips or a separate option list.
- Adds verification, confirmation, safety, or workflow structure only when the task and available signals call for it.
- Keeps you in control: review and edit the full prompt, use it, or return to your original request before anything is sent.


---

## Why AI Coding Assistant for Builders

- AI coding agents and coding AI tools can generate entire features from a single sentence.
- But speed of generation often outpaces the discipline of process.
- Developers skip reviews, forget regression checks, ship without acceptance tests — out of momentum, not laziness.
- Nexpath uses workflow and absence signals to bring the right missing practices into the prompt itself, closing the gap between fast AI generation and disciplined development.

Built during AI Hackfest 2026 by MLH.

---

## The Prompt Quality Layer — How It Works

1. **Understand** — Nexpath reviews the prompt, the current development stage, and relevant workflow signals while preserving the complete original request.
2. **Structure** — It builds one editable prompt with the sections the task needs, such as scope, constraints, acceptance expectations, verification, or missing-practice guidance.
3. **Safeguard** — Higher-risk work can receive confirmation, safety, rollback, or evidence requirements. Complex work can also receive a sequence-aware breakdown when multiple prompts would be more effective.
4. **Review** — You inspect and edit the result before sending it, or return to the original prompt. Nexpath provides the quality layer; you keep the final decision.

---

![Nexpath CLI demo](assets/nexpath_new.gif)

---

## Nexpath CLI Features & Capabilities

### One Editable Quality Review

The core interaction keeps your request and the added workflow guidance together:

- Preserves your complete original request inside the quality-reviewed prompt.
- Adds a clearer task structure without inventing requirements or expanding the scope without evidence.
- Lets you directly edit any part of the prompt before choosing the reviewed version or the original.
- Keeps the interface focused on one useful prompt body instead of several competing prompt options.

### Signal-Based Guidance Sections

- Relevant advisory signals become contextual sections inside the reviewed prompt rather than a separate advisory popup.
- Absence signals can add practices that are missing from the current workflow, such as tests, acceptance criteria, regression checks, or project grounding.

### Verification, Confirmation, and Safety

- Verification and test expectations are added for debugging, maintenance, planning, review, and other tasks that need proof of completion.
- Sensitive or high-risk actions can receive explicit confirmation, rollback, backup, or safety requirements.

### Sequence-Aware Multi-Prompt Support

- Complex work can be decomposed into a clear current task plus a compact, ordered sequence plan.
- Each step remains user-reviewed; the quality layer does not silently auto-send prompts or treat an agent response as proof of completion.
- Full continuation across prompts remains behind runtime and host-safety gates while the current version focuses on a safe, editable first prompt and sequence-ready handoff.

### Absence Detection

- Tracks which development signals are present or missing in your session.
- When a relevant practice is missing, it can contribute a grounded section to the quality-reviewed prompt.
- Weak or unrelated signals are not used as filler; guidance must match the current task.

### Supported AI Coding Agents & Developer Tools

Nexpath CLI is built for prompt capture across AI coding agents.

| Agent | Status in v0.1.2 |
|-------|-----------------|
| **Claude Code** | Fully supported — end-to-end tested |
| **Cursor** | Not yet supported — end-to-end testing planned for v0.1.3 |
| **Windsurf** | Not yet supported — end-to-end testing planned for v0.1.3 |
| **Cline** | Not yet supported — end-to-end testing planned for v0.1.3 |
| **Roo Code** | Not yet supported — end-to-end testing planned for v0.1.3 |
| **KiloCode** | Not yet supported — end-to-end testing planned for v0.1.3 |
| **OpenCode** | Not yet supported — end-to-end testing planned for v0.1.3 |

---

## Claude Code Setup & Installation

```bash
# Clone and build from source
git clone https://github.com/hi0001234d/nexpath.git
cd nexpath
npm install
npm run build
npm link

# Register with your coding agent and verify
nexpath install
nexpath install --yes      # or accept defaults without prompts

# Verify
nexpath --version
```

Setup notes:
- You'll choose how often advisories appear (advisory frequency) and what kind of work you do (project role).
- Both can be changed later — when an advisory popup appears, press Ctrl+T (Cmd+T on macOS) to change them.

### Uninstalling

```bash
# Remove the Nexpath CLI
nexpath uninstall
npm uninstall -g nexpath
npm unlink -g nexpath

# Verify it's gone
npm list -g nexpath
which nexpath

# Clear local data and caches
rm -rf ~/.nexpath
rm -rf ~/.config/nexpath
rm -rf ~/.local/share/nexpath
rm -rf ~/.cache/nexpath

# Clear the npm cache
npm cache clean --force
```

`nexpath uninstall` disconnects Nexpath from all detected agents and offers to clear the stored
API key. The remaining steps remove the global package, any leftover binary, and all local
data and caches.

---

## Configuration and Privacy

### Privacy Controls

All data is stored **locally only** at `~/.nexpath/`. Only targeted LLM calls used to classify or
prepare relevant guidance leave your machine.

- **Automatic secret redaction** — API keys (`sk-*`, `ghp_*`, `ghu_*`), bearer tokens, and
  PEM blocks are automatically stripped from prompts before storage.
- **Install-time consent** — During `nexpath install`, telemetry is a separate consent step
  (defaults to enabled). Local prompt capture and remote telemetry are independent — disable
  either anytime via `nexpath store disable`(if you do this, nothing will work) or
  `nexpath config set telemetry.enabled false`.

### Deleting Stored Prompts

```bash
# Delete prompts for a specific project you no longer want to keep
nexpath store delete --project <path>

# Delete all stored prompts permanently
nexpath store delete -y
```

---

## Troubleshooting

### Where Is My API Key Stored?

| Platform | Default location | Inspect with |
|---|---|---|
| macOS | Keychain | Keychain Access.app → search "nexpath" |
| Linux | Secret Service (libsecret) | `secret-tool lookup service nexpath account openai_api_key` |
| Windows | Credential Manager | Control Panel → Credential Manager → Web Credentials |
| Fallback (any OS) | `~/.nexpath/config.json` (mode 0600) | `cat ~/.nexpath/config.json` |

Use `nexpath config show-key-source` to confirm which layer is currently active.

---

## Contributing

Contribution guide coming once the initial implementation is stable.

---

## License

[Apache License 2.0](LICENSE)

---

## Acknowledgements

- **Major League Hacking (MLH)** — For organizing AI Hackfest 2026
- **Anthropic** — For Claude Code, our primary development environment
- **OpenAI** — For models used in targeted classification and prompt-quality tasks
- **Google** — For Gemini AI, planned as an alternative LLM provider alongside OpenAI

Built with insights from the vibe coding community and developers building real projects with AI coding agents, coding AI tools, and AI developer tools.
