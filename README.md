# Study Lab

Study Lab is a local-first, branching AI chat for exploring technical concepts. Every question becomes a node in a concept map. Select any earlier node to continue from that point, or select text inside an answer and ask a focused follow-up.

The app is intentionally frontend-only: there is no build step, package manager, backend, or database. Conversations and settings persist in the browser's `localStorage`, while responses stream directly from either OpenAI or OpenRouter's Responses API.

## Features

- can branch off any previous answer
- select a chunk of text from an answer and ask about it
- vim-like shortcuts
- plain js + html + css
- provider API keys and history stay local in your browser; questions go directly to the selected provider
- the composer shows the active model and provider at a glance
- each generated answer records and displays the model and provider that produced it
- you see token usage and cost estimations

other:
- branching conversation tree with clickable question nodes
- root-to-current-branch conversation view
- ask about selected answer text with suggested or custom follow-ups
- streaming responses
- markdown, fenced code blocks, and LaTeX rendering through KaTeX
- persistent sessions and API settings in `localStorage`
- lightweight vanilla HTML, CSS, and JavaScript
- responsive concept map for desktop and small screens
- persistent light/dark theme with system-theme detection
- monthly token tracking with per-model details and a local billing estimate
- independent chat-history clearing and per-conversation deletion
- multiple persistent maps with a browsable conversation sidebar
- per-map PDF and Markdown context, uploaded once through the Files API
- debounced search across map titles, questions, answers, and attachment names
- collapsible, zoomable concept trees with active-path highlighting
- vim-style keyboard navigation for nodes, maps, search, and the composer
- large-answer optimizations through throttled stream painting

![Study Lab main view showing a branching conversation](screenshots/main%20view.png)

## Run locally

You need a modern browser, an internet connection, and either an [OpenAI API key](https://platform.openai.com/api-keys) or an [OpenRouter API key](https://openrouter.ai/settings/keys). A ChatGPT subscription/password is not an OpenAI API key.

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
2. Paste the API key for each provider you plan to use.
3. Add model cards, choose OpenAI or OpenRouter on each card, and enter any model ID available to that account. OpenRouter model IDs use the `provider/model` form, such as `openai/gpt-5-mini`.
4. Select the radio button on the model card that should be used by default.
5. Save and ask a question.

Settings stores the OpenAI and OpenRouter API keys once at the top. Model cards below can independently choose a provider, model ID, and endpoint; one card is selected as the default connection. A fresh installation starts with one OpenAI model card, and **+ Add model** creates more.

To add reference material, choose **+ PDF / MD** beside the composer and select one or more PDF or Markdown (`.md`) files. The files are attached to the current map and included with questions sent through the same provider, including questions asked from older branches. Each file must be under 50 MB, and files attached through one provider in a map must total under 50 MB.

The endpoint on each model card is configurable under **Endpoint**. OpenAI defaults to `https://api.openai.com/v1/responses`; OpenRouter defaults to `https://openrouter.ai/api/v1/responses`.

## How branching works

Each node stores its parent ID. Clicking a node makes it the active context and displays only the path from the root to that node. The next question becomes its child. Selecting text within an answer and choosing **Ask** creates a child of the answer's node, even if another branch was active.

The complete parent-path conversation is sent with each request. This makes every branch self-contained and avoids coupling local history to provider-side response IDs.

![Using Go deeper to ask a focused follow-up about selected text](screenshots/go%20deeper.png)

## Multiple maps

Choose **New map** in the header or conversation sidebar to open a blank map. The current map is retained automatically. Use the left **Conversations** sidebar to switch between saved maps; each entry shows its title, node count, and last activity date. Use ✎ to rename a map or × to delete its entire conversation. A custom title remains unchanged as new questions are added; submitting a blank title restores automatic naming. Existing sessions from the original single-map storage format are migrated automatically.

**Settings → Clear chat history** is the explicit destructive action that removes all saved maps. It does not remove the API key, other settings, or the separate API-usage ledger.

## Search and navigation

Use the search field in the conversation sidebar—or press `/` outside an input—to search all saved map titles, questions, answers, and attachment names. Results link directly to the matching map or question node. Search is debounced and capped at 60 displayed results to keep large workspaces responsive.

The concept-map toolbar can expand or collapse all branches and zoom the tree from 80% to 140%. Individual branches have disclosure arrows, and their collapsed state persists with the map. The current root-to-node path remains highlighted.

![Study Lab tree and conversation navigation](screenshots/tree%20navbar.png)

Vim-style shortcuts work whenever a text field or dialog control is not focused:

- `j` / `k` — next / previous visible concept node
- `h` / `l` — parent / first child; `l` expands a collapsed active node first
- `gg` / `G` — first / last visible node
- `J` / `K` — next / previous conversation
- `Space` — collapse or expand the active node
- `/` — focus cross-conversation search
- `i` — focus the question composer
- `Esc` — leave input or search mode
- `?` — open the in-app shortcut reference

![In-app reference for Vim-style keyboard shortcuts](screenshots/vim%20shortcuts.png)

## File context

PDF and Markdown files are uploaded directly from the browser to the selected provider's Files endpoint, derived from its configured Responses API URL. Only their file IDs, types, providers, names, and sizes are stored in `localStorage`; the file contents are not copied into browser storage. PDF page images use low visual detail to reduce token use, while extracted PDF text and Markdown text remain available to the model. Use a model that supports the selected file type.

File IDs belong to the provider that received the upload. If you switch providers, files uploaded to the other provider remain visible but are dimmed and are not sent. Upload the file again while the new provider is selected to use it there.

PDF parsing adds extracted text and page images to the prompt, so large books can consume substantial input tokens on every question. The header usage tracker includes tokens reported for these requests. For very large collections or frequent querying, OpenAI recommends retrieval with File Search; this lightweight local app intentionally uses direct PDF input and does not create vector stores.

Removing a file chip or clearing local chat history detaches the file locally but does **not** delete the uploaded copy from the provider. Delete retained files separately through your provider account if needed. Custom API providers must expose a compatible `/files` endpoint next to their configured `/responses` endpoint.

## Storage and security

The browser stores these local keys:

- `study-lab:v1` — multi-map conversation workspace, attachment references, collapsed branches, and active-map selection
- `study-lab:settings:v1` — provider API keys, model cards, the default model, endpoints, and system instructions
- `study-lab:usage:v1` — token usage and estimated request costs recorded by this browser
- `study-lab:openrouter-prices:v1` — a bounded cache of recently used OpenRouter model rates
- `study-lab:theme` — light/dark theme preference
- `study-lab:tree-zoom` — concept-map zoom preference

Data saved by releases before the rename is copied into the new storage namespace automatically on first load.

The usage button in the header counts tokens reported by completed Responses API requests made from this browser. OpenAI requests use a local pricing table. For OpenRouter requests, Study Lab looks up the model returned by the response through OpenRouter's single-model API and caches its prompt, completion, cache-read, and request rates for 24 hours. Each usage record retains the exact rate snapshot used for its USD estimate.

These values are estimates, not invoices. OpenRouter's model endpoint reports its current model price structure, which can differ from the final routed-provider charge or charges for non-token features. The tracker also cannot see other browsers or applications, older untracked requests, credits, taxes, or special pricing. Use the linked dashboard for the selected provider as the source of truth for billing.

![API usage details with token and cost estimates](screenshots/api%20usage.png)

This design is convenient for a private tool on your own laptop, but browser storage is not a secure secret vault. Any JavaScript executing on the same origin can read it. Therefore:

- Run the app only from files you trust.
- Do not publish or host this version as a public multi-user site.
- Prefer restricted provider keys with appropriate spend limits.
- Use **Settings → Forget key** before sharing the browser profile or local origin.
- Using a different port creates a different browser origin and therefore a separate session.

For a public deployment, put API calls behind an authenticated backend and keep the key in a server environment variable.

## Performance notes

Only the active branch is added to the main document; sibling branches remain compact data in `localStorage`. Streaming UI updates are batched roughly every 70 ms instead of rerendering for every token, and the concept map is built with a single document-fragment update.

Very large sessions are ultimately limited by the browser's `localStorage` quota (usually a few megabytes). Start a new map when the saved tree becomes unusually large.

## Browser support

Use a current version of Chrome, Edge, Firefox, or Safari. LaTeX loads from the jsDelivr CDN; if it cannot load, equations remain visible as plain source text. The OpenAI API must allow requests from your local browser origin. If a corporate browser policy or custom endpoint blocks CORS, a small local proxy backend would be required.

## API reference

The app uses the selected provider's Responses endpoint with `stream: true` and reads Server-Sent Events. See the official [OpenAI streaming Responses documentation](https://developers.openai.com/api/docs/guides/streaming-responses) and [OpenRouter Responses documentation](https://openrouter.ai/docs/api_reference/responses/overview).
