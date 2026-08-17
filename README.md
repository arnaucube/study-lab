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

The endpoint is configurable under **Advanced**, which is useful for an OpenAI-compatible Responses API. Compatibility depends on whether that provider implements the Responses API and browser CORS.

## How branching works

Each node stores its parent ID. Clicking a node makes it the active context and displays only the path from the root to that node. The next question becomes its child. Selecting text within an answer and choosing **Ask** creates a child of the answer's node, even if another branch was active.

The complete parent-path conversation is sent with each request. This makes every branch self-contained and avoids coupling local history to provider-side response IDs.

## Storage and security

The browser stores two local keys:

- `study-pal:v1` — conversation nodes
- `study-pal:settings:v1` — API key, model, endpoint, and system instructions

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
