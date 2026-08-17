# Study Pal

Study Pal is a local-first, branching AI chat for exploring technical concepts. Every question becomes a node in a concept map. Select any earlier node to continue from that point, or select text inside an answer and ask a focused follow-up.

The app is intentionally frontend-only: there is no build step, package manager, backend, or database. Conversations and settings persist in the browser's `localStorage`, while responses stream directly from OpenAI's Responses API.

## Features

- Branching conversation tree with clickable question nodes
- Root-to-current-branch conversation view
- Ask about selected answer text with suggested or custom follow-ups
- Streaming responses
- Markdown, fenced code blocks, and LaTeX rendering through KaTeX
- Persistent sessions and API settings in `localStorage`
- Lightweight vanilla HTML, CSS, and JavaScript
- Responsive concept map for desktop and small screens
- Persistent light/dark theme with system-theme detection
- Monthly token tracking with per-model details and a local billing estimate
- Independent chat-history clearing and per-conversation deletion
- Multiple persistent maps with a browsable conversation sidebar
- Per-map PDF context for books and papers, uploaded once through the Files API
- Large-answer optimizations: throttled stream painting and `content-visibility`

## Run locally

You need a modern browser, an internet connection, and an OpenAI API key. A ChatGPT subscription/password is not an API key; create a project key in the [OpenAI dashboard](https://platform.openai.com/api-keys).

From this directory, start any static file server. Python is commonly preinstalled:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

Alternatively, with Node.js:

```bash
npx --yes serve .
```

Open the local URL printed by `serve`.

1. Choose **Settings**.
2. Paste an OpenAI API key.
3. Keep `gpt-5-mini`, or enter another model available to your API project.
4. Save and ask a question.

To ask about a book or paper, choose **+ PDF** beside the composer and select one or more PDFs. The files are attached to the current map and included with every new question in that map, including questions asked from older branches. Each file must be under 50 MB, and all attached files in a map must total under 50 MB.

The endpoint is configurable under **Advanced**, which is useful for an OpenAI-compatible Responses API. Compatibility depends on whether that provider implements the Responses API and browser CORS.

## How branching works

Each node stores its parent ID. Clicking a node makes it the active context and displays only the path from the root to that node. The next question becomes its child. Selecting text within an answer and choosing **Ask** creates a child of the answer's node, even if another branch was active.

The complete parent-path conversation is sent with each request. This makes every branch self-contained and avoids coupling local history to provider-side response IDs.

## Multiple maps

Choose **New map** in the header or conversation sidebar to open a blank map. The current map is retained automatically. Use the left **Conversations** sidebar to switch between saved maps; each entry shows its title, node count, and last activity date. Use ✎ to rename a map or × to delete its entire conversation. A custom title remains unchanged as new questions are added; submitting a blank title restores automatic naming. Existing sessions from the original single-map storage format are migrated automatically.

**Settings → Clear chat history** is the explicit destructive action that removes all saved maps. It does not remove the API key, other settings, or the separate API-usage ledger.

## PDF context

PDFs are uploaded directly from the browser to the Files endpoint derived from the configured Responses API URL. Only their file IDs, names, and sizes are stored in `localStorage`; the PDF bytes are not copied into browser storage. Page images use low visual detail to reduce token use, while extracted PDF text remains available to the model. Use a vision-capable model that supports PDF inputs.

PDF parsing adds extracted text and page images to the prompt, so large books can consume substantial input tokens on every question. The header usage tracker includes tokens reported for these requests. For very large collections or frequent querying, OpenAI recommends retrieval with File Search; this lightweight local app intentionally uses direct PDF input and does not create vector stores.

Removing a PDF chip or clearing local chat history detaches the file locally but does **not** delete the uploaded copy from OpenAI. Delete retained files separately through your OpenAI account if needed. Custom API providers must expose a compatible `/files` endpoint next to their configured `/responses` endpoint.

## Storage and security

The browser stores three local keys:

- `study-pal:v1` — multi-map conversation workspace, PDF file references, and active-map selection
- `study-pal:settings:v1` — API key, model, endpoint, and system instructions
- `study-pal:usage:v1` — token usage and estimated request costs recorded by this browser

The usage button in the header counts tokens reported by completed Responses API requests made from this browser. Its estimated USD amount uses a local pricing table and is not an invoice: it cannot see other browsers or applications, historical requests made before tracking was added, credits, taxes, or special pricing. Use the linked OpenAI usage dashboard as the source of truth for billing.

This design is convenient for a private tool on your own laptop, but browser storage is not a secure secret vault. Any JavaScript executing on the same origin can read it. Therefore:

- Run the app only from files you trust.
- Do not publish or host this version as a public multi-user site.
- Prefer a restricted OpenAI project key with appropriate spend limits.
- Use **Settings → Forget key** before sharing the browser profile or local origin.
- Using a different port creates a different browser origin and therefore a separate session.

For a public deployment, put API calls behind an authenticated backend and keep the key in a server environment variable.

## Performance notes

Only the active branch is added to the main document; sibling branches remain compact data in `localStorage`. Streaming UI updates are batched roughly every 70 ms instead of rerendering for every token. Off-screen messages use CSS `content-visibility`, and the concept map is built with a single document-fragment update.

Very large sessions are ultimately limited by the browser's `localStorage` quota (usually a few megabytes). Start a new map when the saved tree becomes unusually large.

## Browser support

Use a current version of Chrome, Edge, Firefox, or Safari. LaTeX loads from the jsDelivr CDN; if it cannot load, equations remain visible as plain source text. The OpenAI API must allow requests from your local browser origin. If a corporate browser policy or custom endpoint blocks CORS, a small local proxy backend would be required.

## API reference

The app uses `POST /v1/responses` with `stream: true` and reads Server-Sent Events. See the official [OpenAI streaming Responses documentation](https://developers.openai.com/api/docs/guides/streaming-responses).
