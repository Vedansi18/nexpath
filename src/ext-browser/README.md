# Nexpath — Browser Extension. Code Fast. Skip Nothing.

**Stop. Think. Prompt better.**

Nexpath is an AI developer tool that works as a behaviour-guidance layer for vibe coders — it
surfaces a quick **decision session** *between* your prompts so you stay aligned with specs, tests,
and architecture decisions, without breaking your flow.

**Built for:** Replit · Lovable · Bolt — fully supported & end-to-end tested.

---

## What Is Nexpath?

Nexpath is an **AI coding-productivity** extension for developers using in-browser AI coding agents
like **Replit**, **Lovable**, and **Bolt**. Think of it as an **AI pair programmer** focused on
*process*, not code — it watches your session and surfaces a lightweight advisory at key transition
points in your **coding workflow**.

Instead of generating code, Nexpath guides it:

> *"You just shipped a feature. Want to confirm the review before moving on?"*

One nudge. You decide. No enforcement, no interruption — just the right question at the right moment.

---

## Why Nexpath?

Vibe coding with AI agents lets you ship features in minutes — but that speed often means skipped
spec reviews, forgotten regression checks, and missing tests. Not because you're careless, but
because momentum takes over. Nexpath is the **developer-productivity** layer that complements your AI
workflow without slowing it down.

---

## Supported Agents

| AI Coding Agent | Status |
|---|---|
| **Replit** | ✅ Fully supported · end-to-end tested |
| **Bolt** | ✅ Fully supported · end-to-end tested |
| **Lovable** | ✅ Fully supported · end-to-end tested |

---

## Features

- **Between-prompt advisory** — a lightweight decision session at key transition points. Non-intrusive, never enforcing.
- **3-level easier options** — can't take the full recommendation? Nexpath offers progressively simpler alternatives before logging the skip.
- **Send it straight to your agent** — accept a suggestion and Nexpath drops it into the chat for you, or copies it to your clipboard.
- **Adapts to your style** — calibrates its tone and depth to how you prompt.

---

## Getting Started

1. **Install** — from the **Chrome Web Store** (Chrome / Edge) or **Firefox Add-ons**.
2. Open Nexpath's **options** page and paste your **OpenAI API key** (`sk-…`) → **Test** → **Save**.
3. Pick your **advisory frequency** and **role**, then start prompting in Replit, Lovable, or Bolt —
   Nexpath surfaces sessions when they help, right after your agent finishes responding.

---

## Requirements

- **Chrome** (or Edge/Chromium) or **Firefox 112+**.
- An **OpenAI API key** — <https://platform.openai.com/api-keys>. Without a valid key, prompts are
  tracked but no decision session is generated.

---

## Privacy

- Your **API key** and settings are stored **locally in your browser** — never bundled or logged.
- To generate a decision session, Nexpath sends **recent prompt context to OpenAI** using **your**
  key — that is the only place your prompt text is sent, and only when a session fires.
- **No tracking and no remote code.** There is no analytics script, no ad or tracking network, and
  no code is ever downloaded and run.
- **Usage signals stay on your machine until you choose to send them.** Nexpath keeps a local,
  content-free record of *which* popup buttons you press and *when* — a fixed list of action names
  (for example `pe_shorter`, `mps_send`) and timestamps. It never records prompt text, the text of
  an option, which site you are on, or your project path.
- **The only thing that sends is the rating prompt, and only when you answer it.** Occasionally
  Nexpath asks how it is working out for you. Choosing a rating is what sends — and it sends only
  a random installation ID (not tied to you or your machine), your 1–4 rating, and the timestamps
  above. Dismissing the prompt sends nothing and clears nothing.
- **Your prompt text is never part of that.** The only place prompt text goes is OpenAI, with your
  own key, as described above.

---

## License

[Apache-2.0](https://github.com/hi0001234d/nexpath/blob/main/LICENSE)

---

<p align="center">
  Built by <a href="https://parseos.io">ParseOS</a> · AI developer tools for the vibe-coding era
</p>
