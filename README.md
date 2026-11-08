Turn on the backend:

cd server

.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

(or)

uv run --with-requirements requirements.txt uvicorn app.main:app --reload --port 8000

Turn on Frontend:

npm run dev

# SumGo

A Chrome extension that opens as a normal chat popup. It reads the URL of the tab you
currently have open, hands it to a LangChain agent running in a FastAPI backend, and lets
you chat about that page — or anything else, using the agent's web search tool.

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ Chrome extension (MV3)      │        │ FastAPI backend                  │
│                             │        │                                  │
│  popup (React + TypeScript) │        │  POST /chat                      │
│   • chat UI                 │  HTTP  │   • LangChain create_agent       │
│   • saved chat history      │        │     (Groq GPT-OSS 120B)           │
│   • chrome.tabs.query ──────┼───────►│   • conversation history (MongoDB)│
│     active tab URL          │        │   • tool: read_current_tab ──────┼──► fetches the
│                             │        │   • tool: web_search (Exa) ──────┼──► tab / web
└─────────────────────────────┘        └──────────────────────────────────┘
```

- **`extension/`** — Manifest V3 extension. The popup is a React app built with Vite.
  `chrome.tabs.query({ active: true, currentWindow: true })` reads the active tab, and the
  URL and title are attached to every `/chat` request.
- **`server/`** — FastAPI app with MongoDB conversation persistence. `read_current_tab` is built per request with the tab URL
  captured in its closure, so the agent reads exactly the page the user is on without
  having to guess the URL. `web_search` calls Exa over HTTP.

Because a Chrome extension renders in a browser context, the popup UI is React for the web
(`react-dom` + Vite). React Native cannot run inside an extension — there is no native host
to render it.

## Prerequisites

- Node.js 20+
- Python 3.11+
- A Groq API key — https://console.groq.com/keys
- An Exa API key — https://dashboard.exa.ai/api-keys (free tier: $20 on signup, then $10/month)
- A MongoDB Atlas cluster and database user — https://www.mongodb.com/atlas/database

## Setup

### 1. Backend

Create a MongoDB Atlas cluster, create a database user, and allow your computer's IP in
Atlas **Network Access**. Copy the cluster connection string from **Connect → Drivers**.

```bash
cd server
python -m venv .venv
source .venv/Scripts/activate     # Windows (Git Bash);  use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env              # then fill in your keys
```

Edit `server/.env`:

```
GROQ_API_KEY=your_groq_key
EXA_API_KEY=your_exa_key
MONGODB_URI=mongodb+srv://<db_user>:<db_password>@<cluster-host>/?retryWrites=true&w=majority
MONGODB_DATABASE=sumgo
```

Replace the URI placeholders with the Atlas values. URL-encode special characters in the
database password. Keep `server/.env` private; never commit or share the connection string.

Run it:

```bash
uvicorn app.main:app --reload --port 8000
```

Check it is up: `curl http://localhost:8000/health` — `missing_keys` should be empty and
`mongodb_configured` should be `true`.

### 2. Extension

```bash
cd extension
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/dist` folder
4. Open any web page and click the PageChat toolbar icon

## How a request flows

1. The popup calls `chrome.tabs.query` and reads the active tab's URL and title.
2. It POSTs the conversation ID, messages, and tab to `POST /chat` on the backend.
3. The backend saves the user message, builds an agent with Groq's GPT-OSS 120B model and two tools,
   then saves the reply and tool calls in MongoDB.
4. If the question is about the open page, the agent calls `read_current_tab`, which
   fetches that URL server-side and extracts the readable text.
5. If it needs outside facts, it calls `web_search`, which queries Exa.
6. The reply, plus the list of tools the agent used, comes back and renders in the popup.
   The popup shows each tool call as a small chip above the answer.

## API

| Method   | Route                   | Body                                                     | Returns                                                |
| -------- | ----------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `GET`    | `/health`               | —                                                        | Status, configured model, and missing configuration    |
| `GET`    | `/conversations`        | —                                                        | Saved conversation summaries, newest first             |
| `GET`    | `/conversations/{id}`   | —                                                        | Saved conversation and all messages                    |
| `DELETE` | `/conversations/{id}`   | —                                                        | Deletes one saved conversation                         |
| `POST`   | `/chat`                 | `{ conversation_id, messages: [{role, content}], tab }` | `{ conversation_id, reply, tool_calls, tab_url }`      |

## Configuration

| Variable           | Where            | Default                 | Purpose                                                |
| ------------------ | ---------------- | ----------------------- | ------------------------------------------------------ |
| `GROQ_API_KEY`     | `server/.env`    | —                       | Groq access (required)                                 |
| `EXA_API_KEY`      | `server/.env`    | —                       | Web search (required)                                  |
| `MODEL`            | `server/.env`    | `openai/gpt-oss-120b`   | Groq model ID                                          |
| `MONGODB_URI`      | `server/.env`    | —                       | MongoDB Atlas connection string (required for history) |
| `MONGODB_DATABASE` | `server/.env`    | `sumgo`                 | Database that holds conversations                     |
| `MAX_PAGE_CHARS`   | `server/.env`    | `12000`                 | How much page text is passed to the model              |
| `REQUEST_TIMEOUT`  | `server/.env`    | `20`                    | Timeout in seconds for model and page-fetch requests   |
| `CORS_ORIGINS`     | `server/.env`    | `*`                     | Allowed origins                                        |
| `VITE_API_BASE`    | `extension/.env` | `http://localhost:8000` | Backend base URL baked into the build                  |

If you change the backend port or host, update both `VITE_API_BASE` (then rebuild) and the
`host_permissions` entry in `extension/public/manifest.json`.

## Notes and limits

- Pages requiring a login, or that block server-side fetches, cannot be read by
  `read_current_tab`. The tool returns a readable explanation instead of failing, and the
  agent will tell you it could not read the page.
- Conversations and their messages are retained in MongoDB indefinitely until you delete
  them from the extension's History view. The most recently updated conversation opens when
  you reopen the popup.
- The backend has no authentication. It binds to localhost by default; do not expose it
  publicly without adding authentication, since the API can expose saved conversations and
  spend your API credits.
