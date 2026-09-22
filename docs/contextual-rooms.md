# Contextual replies and local room modes

This is a standalone prototype, not a deployed Teams/Graph service. Offline
tests use synthetic media and mocked providers; they do not prove live
source-recognition or generated-image quality.

## Contextual creation

The planner considers the current selected conversation and explicit intent
before choosing a fictional reference, a grounded non-fictional callback or an
ordinary reply. Original mode opts out of inherited references. An explicit
reference takes precedence. Recognizing a source does not imply that the
audience knows it; audience familiarity is reported, never inferred.

The response contract structurally separates reference evidence, observed frame
sources and appearance evidence. Invalid shapes, unavailable evidence, unknown
fields and over-limit captions are rejected before generation. Both generated
variants share the validated direction and retain the photographic/illustrated/
rendered medium when appropriate. Generation receives text direction, not a
copy of source pixels. The optional editable caption supports up to 500
characters and is displayed beside the image; it is not an instruction to
render text into the pixels. In-image lettering requires an explicit request.

## Build and start

Follow the repository README's fixture preparation and provider setup first.
Use an unused port and build root; do not rebuild a root serving another session.

| npm alias | `VISUAL_BUILD_ROOT` for the preceding build | Loopback port |
| --- | --- | --- |
| `chat:contextual-callback` | `dist-chat-film-context` | 4372 |
| `chat:live-sync` | `dist-chat-live-sync` | 4373 |
| `chat:shared-demo` | `dist-chat-shared-demo` | 4374 |

Example for the explicitly enabled shared demo:

```powershell
$env:VISUAL_BUILD_ROOT = "dist-chat-shared-demo"
npm run build
Remove-Item Env:VISUAL_BUILD_ROOT
npm run chat:shared-demo
```

Starting a configured server does not authorize any provider action. Explain,
search and creation remain explicit, potentially billable operations.

## Room behavior and boundaries

Normal local mode keeps the existing cookie-bound session. Visible tabs poll
that same session approximately every 1.5 seconds, pause while hidden or busy,
and back off after failures. Polling only observes state and never invokes AI.
Remote changes preserve unsent composer text while invalidating stale reviews
and generated previews. Polling does not renew the room lifetime.

The shared demo is opt-in through its launcher. Enter a Chat ID at `/chat` or
open `/chat?chatId=YOUR_ID`. Independent browser profiles using the same ID join
the same in-memory room; different IDs remain scoped per tab even in one browser.
Media URLs carry that room scope, and a different room cannot read their bytes.

**Anyone who knows or guesses a Chat ID can read and modify that room.** IDs
are not passwords, access control, invitations, or tenant membership. Use only
non-sensitive permitted demo content. A copied loopback link only works for
clients able to reach the same server; this feature does not create a public
deployment or tunnel.

Rooms expire 30 minutes after creation and disappear on process restart.
Leaving a shared room does not delete it for peers. Resetting a shared room
requires explicit confirmation and a current revision. Switching rooms warns
that the current tab's unsent drafts and previews will be discarded.

## Offline checks

After `npm run assets:prepare` and `npm run build`, focused checks can run without
provider credentials:

```powershell
npm run test:unit -- src/server/contextual-callback.test.ts src/server/contextual-reference-wire.test.ts src/server/express-plan-contract.test.ts src/client/local-chat-api.test.ts src/shared/demo-room.test.ts
$env:CI = "true"
npm exec playwright test tests/e2e/film-context.spec.ts tests/e2e/live-sync.spec.ts tests/e2e/shared-demo.spec.ts
Remove-Item Env:CI
```

The tests default to the standard `dist` build, or use `VISUAL_BUILD_ROOT` when
explicitly set. The included geometric fixtures are not authentic film media.
