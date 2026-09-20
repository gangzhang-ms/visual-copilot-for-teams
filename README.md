# Visual Copilot for Teams

A standalone, local-first prototype for understanding visual messages and
composing visual replies in a Teams-style conversation. It supports images,
GIFs, custom emoji and Unicode emoji, with English and Simplified Chinese UI.

**Status:** the local prototype works; a production Teams/Graph integration
is not complete. Teams authentication, selected-message handling, packaging
and sharing code are included as gated integration work, not a deployable
production service. Model and search providers require your own configuration,
credentials, approval and billing.

## What it does

- **Understand:** choose a message and up to ten context messages. Enlarge a
  visual locally, then explicitly click **Explain with AI**. Enlarging alone
  never requests an explanation.
- **Read at your own pace:** the compact result shows the possible meaning
  and an identified source when available. **Details** reveals the complete
  background, observations, interpretations, uncertainty and references from
  the **same original result**, without a second AI call.
- **Express:** choose Unicode emoji or visual replies, review a preview, and
  manually insert the selection into the composer. Nothing sends automatically.
- **Keep the reply coherent:** **Match reply context** aims to preserve the
  selected visual's photographic, illustrated or rendered medium unless an
  explicit new style is requested. This behavior has offline unit/browser
  coverage; it has not received new live image-quality acceptance.

AI explanations are uncertain interpretations, not verified facts about a
person's intentions or a visual's origin. An AI-generated interpretation is
not an authentic film frame. Search results can be unavailable, blocked or
incorrect; not all retrieval/provider paths have been demonstrated to work.
Source attribution alone does not grant permission to reuse media.

## Repository and publication scope

The publication checkout contains application source, offline tests, setup
templates and locally authored vector fixture sources. It deliberately omits
API keys, actual environment files, protected credentials, local rooms and
chat records, captures, user-supplied movie stills, generated image/GIF
outputs, video/PowerPoint assets, build roots, dependencies and local
operational history.

Private resource identifiers are replaced with placeholders in the
publication checkout. The original working folder may retain its operator's
local configuration; do not copy that configuration or old runtime artifacts
into a commit. The publication checkout is prepared separately so existing
local sessions can continue running.

## Prerequisites

- Node.js **22 LTS** and npm.
- Windows with PowerShell 7 for the existing DPAPI-based credential helpers.
  The offline frontend/backend build uses Node.js; Windows is the currently
  checked platform for the complete fixture test suite.
- Your own approved Azure OpenAI resources for live explanations/image
  generation, and optionally your own search-provider credentials.

No credentials are required to install dependencies or run the offline
checks. Installing dependencies downloads packages from the npm registry.

## Build and inspect without provider calls

Run these commands **in a fresh publication checkout**, not in a directory
whose build output is currently serving another session:

```powershell
npm ci
npm run assets:prepare
npm run typecheck
npm run test:unit
npm run build
npm run scan:privacy
```

`assets:prepare` is a publication-only command. It renders the included vector
sources locally and creates conspicuously synthetic, geometric test fixtures
instead of distributing private demo media. These outputs stay ignored.
They are for offline contract tests, **not film/source-recognition evidence**.
The historical film-demo captions are not descriptions of those test pixels.
For a real demonstration, use your own permitted media and manually compose a
conversation instead of presenting the historical built-in demo as genuine.

To inspect the UI shell without any provider configuration:

```powershell
npm run dev -- --host 127.0.0.1
```

Open the Vite URL printed in the terminal. This is not a connected local chat
backend. Explain, search, generation and Teams operations do not become
available merely because the frontend builds.

Optional offline browser tests use the project's Playwright configuration:

```powershell
npm exec playwright install chromium
$env:CI = "true"
npm run test:e2e
Remove-Item Env:CI
```

Use an otherwise free test port. Tests create isolated fixture servers; do
not point runtime verification scripts at existing conversations. Scripts
named `model:synthetic`, `image:canary`, and several `verify-*` provider
probes are **not** offline tests and can incur charges.

## Configure a live local prototype

Live setup is intentionally not preconfigured for someone else's account.
Review the resource, model/API version, quota, media limits and billing terms
for your own environment before enabling it.

1. Replace the non-secret resource placeholders in
   `config\visual-model.development.json`. Match the identity checks in
   `scripts\local-model.ps1` to **that same intended resource**; do not remove
   the identity checks. The checked profile must be current and appropriate
   for your deployment, not a claim that the template is production-verified.
2. For image generation, review and configure the matching destination in
   `src\server\personal-image.ts` and the destination checks in
   `src\server\local-generation-config.ts`. The template
   `config\visual-generation.development.json` remains disabled by default.
   Historical authorization/canary records are not transferable approvals.
3. On Windows, authenticate the Azure CLI to your own intended tenant, then
   use `npm run model:setup`. The helper checks the configured resource and
   saves a CurrentUser-DPAPI protected key beneath `.local\visual-context`.
   Do not put a key into source, JSON, a command line, a screenshot or a chat.
   `npm run model:readiness` requires a build and checks the local profile;
   it is not an end-to-end model-quality test.
4. Build the current local-chat variant and run it on an unused loopback port:

   ```powershell
   $env:VISUAL_BUILD_ROOT = "dist-chat-style-continuity"
   npm run build
   Remove-Item Env:VISUAL_BUILD_ROOT
   npm run chat:style-continuity
   ```

   The launcher prints its URL. Do not rebuild an output root while another
   process is serving it. Stop your own instance before rebuilding that root.
5. Optional `npm run serpapi:setup` and `npm run web-search:setup` prompt for
   search keys using the same local protected-storage boundary. The current
   variant uses SerpApi when configured; other historical variants use
   different providers. Search availability is provider-dependent.

Each explicit live AI/search/create action may send the selected text and
media to configured services and may be billed. The personal local mode has
no application-level daily/count allowance; provider limits, backoff and
bounded media processing still apply. Use non-sensitive, permitted test
content only. This does not authorize company-data processing.

Server-only environment names include `MODEL_API_KEY`, `SERPAPI_API_KEY`,
`BRAVE_SEARCH_API_KEY` and the separate Teams/Entra configuration variables.
Provide values through protected local helpers or a server-side secret
injection mechanism. Do not expose them as `VITE_*` variables. Never commit
an actual `.env` file.

## Source map

| Location | Purpose |
| --- | --- |
| `src\client` | React UI, context review, Explain/Express and composer |
| `src\server` | Local chat, media handling, model/search adapters and gated Teams integration |
| `src\shared`, `src\catalog`, `src\recommender` | Contracts, emoji metadata and recommendation logic |
| `tests` and colocated `*.test.*` | Offline unit and browser fixtures |
| `scripts` | Builds, local setup, packaging and explicitly selected verification |
| `config` | Non-secret development templates; not tenant approvals |
| `teams` | Manifest template; packaging still needs your application identity |

`npm run validate:teams` uses synthetic package values only. A successful ZIP
validation does not establish Entra consent, Graph access, real recipient
rendering, an approved production catalog or Teams deployment readiness.
The production visual catalog remains empty until rights and delivery
requirements are satisfied.

## Privacy and sharing

- Keep `.local`, `.env*`, logs, outputs, captures, room data, build directories
  and all credentials out of version control. Ignore rules are a guardrail,
  not a substitute for an explicit staged-file review.
- Before the first commit or any push, review the exact staged blobs for
  tokens, connection strings, private endpoints, embedded media and user data.
  A heuristic scan cannot prove that a repository contains no secrets.
- If a key was previously shared in a chat or another untrusted location,
  rotate it at the provider; excluding it from Git does not revoke it.
- Original vector test sources are included for development. Pending artwork
  inventory is not a public-hosting or redistribution approval, and this
  repository does not grant rights to third-party media.

No public deployment, automatic Teams sending or production-readiness claim
is made by this prototype.
