# RecurPost MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants access to the [RecurPost](https://recurpost.com) social media management API (API v2).

## What can it do?

- Post content immediately or schedule it on one or more social accounts, and check where each post stands
- See and change the queue: what is going out when, reschedule, edit or remove items
- Save, schedule and delete drafts
- Manage content libraries, their evergreen posts and their publishing time slots
- Review posting history, failed posts and analytics reports
- Work with labels, approvals and the workflow board
- Generate post text, hashtags and images with AI
- Work inside any workspace you are a member of
- Reach every other RecurPost API endpoint (301 in all: inbox, feeds, groups, team roles, custom reports, account settings and more) through `find_endpoints` and `call_endpoint`

## Upgrading from 1.x

Version 2.0.0 moves the server to RecurPost API v2. The tool names of 1.x
(`user_login`, `workspace_list`, `social_account_list`, `library_list`,
`connect_social_account_urls`, `history_data`, `post_content`,
`add_content_in_library`, `generate_content_with_ai`, `generate_image_with_ai`)
are kept, but:

- The server now logs in with your API key and uses a short-lived access token
  for every call. Your `RECURPOST_EMAIL` and `RECURPOST_API_KEY` settings stay
  the same.
- Every id (workspaces, social accounts, libraries, posts) is an encrypted
  string. Numeric ids saved from 1.x no longer work; list the items again to
  get their new ids.
- Errors now come back with their real HTTP status, an `error` message and a
  `code`.
- A few parameters follow the v2 API: `post_content` takes one or several
  account ids in `id`, `yt_privacy_status` is `public`, `private` or
  `unlisted`, and a `generate_content_with_ai` follow-up sends `chat_history`
  along with `ai_id` and `chat_progress`.

## Setup

### 1. Get your API key

1. Log in to [RecurPost](https://recurpost.com)
2. Go to **Account Settings > API key**
3. Generate or copy your **API key** (this is not your login password)

Regenerating the key in RecurPost signs out every client that used the old one;
update the key in your MCP settings afterwards.

### 2. Install

#### Claude Desktop (recommended): one-click extension

Works on macOS and Windows. Nothing else to install: Claude Desktop runs the
extension with its own built-in Node.js.

1. Download [recurpost.mcpb](https://github.com/dinwal/recurpost-mcp/releases/latest/download/recurpost.mcpb).
2. Double-click the file (or drag it onto **Settings > Extensions** in
   Claude Desktop) and click **Install**.
3. Enter your RecurPost email and API key when asked. The key is stored in
   your operating system's keychain, not in a plain text file. Leave the
   optional **API URL** field as it is.

The RecurPost tools are available in a new chat straight away. To update,
download the latest file and install it again.

#### Manual setup

The manual routes below need Node.js 18.20 or newer. Download the LTS installer
from https://nodejs.org if `node -v` in a terminal does not print a version.

#### Claude Desktop on macOS

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "recurpost": {
      "command": "npx",
      "args": ["-y", "recurpost-mcp"],
      "env": {
        "RECURPOST_EMAIL": "your-email@example.com",
        "RECURPOST_API_KEY": "your-api-key"
      }
    }
  }
}
```

Quit Claude Desktop completely (Cmd+Q, not just the window) and reopen it.

#### Claude Desktop on Windows

Do **not** use `npx` on Windows. Windows has no `npx` executable (only
`npx.cmd`, which Claude Desktop cannot launch), and even through `cmd /c`
the first-run package download routinely takes longer than the 60-second
handshake limit, so the server shows as "running" while every call fails.

Install the package once, then point Claude Desktop straight at it:

1. Open Command Prompt and run:

   ```
   npm install -g recurpost-mcp
   ```

2. Find where it landed. This prints the global folder:

   ```
   npm root -g
   ```

   It is normally `C:\Users\YOUR-USERNAME\AppData\Roaming\npm\node_modules`.

3. **Quit Claude Desktop fully first.** Closing the window is not enough:
   right-click the Claude icon in the system tray and choose Quit, or end
   every `Claude.exe` in Task Manager. The app rewrites its config file on
   exit and will discard edits made while it is running.

4. Open `%APPDATA%\Claude\claude_desktop_config.json` and add, using the
   folder from step 2 and double backslashes exactly as shown:

   ```json
   {
     "mcpServers": {
       "recurpost": {
         "command": "C:\\Program Files\\nodejs\\node.exe",
         "args": [
           "C:\\Users\\YOUR-USERNAME\\AppData\\Roaming\\npm\\node_modules\\recurpost-mcp\\build\\index.js"
         ],
         "env": {
           "RECURPOST_EMAIL": "your-email@example.com",
           "RECURPOST_API_KEY": "your-api-key"
         }
       }
     }
   }
   ```

   If you save with Notepad, set **Save as type** to *All Files* (or it
   silently adds `.txt`) and **Encoding** to *UTF-8*, not *UTF-8 with BOM*.

5. Start Claude Desktop. The tools appear within a couple of seconds.

#### Claude Code on macOS / Linux

```bash
claude mcp add recurpost --scope user \
  -e RECURPOST_EMAIL=your-email@example.com \
  -e RECURPOST_API_KEY=your-api-key \
  -- npx -y recurpost-mcp
```

#### Claude Code on Windows

One line (the backslash line breaks above are bash-only). After
`npm install -g recurpost-mcp`:

```
claude mcp add recurpost --scope user -e RECURPOST_EMAIL=your-email@example.com -e RECURPOST_API_KEY=your-api-key -- "C:\Program Files\nodejs\node.exe" "C:\Users\YOUR-USERNAME\AppData\Roaming\npm\node_modules\recurpost-mcp\build\index.js"
```

On every platform the `-e` flags must come before `--`. Anything after `--`
is passed to the server command, so the server would start without
credentials. `--scope user` makes the server available in every project;
omit it to add it to the current project only.

#### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `RECURPOST_EMAIL` | yes | The email you log in to RecurPost with |
| `RECURPOST_API_KEY` | yes | Your API key from Account Settings > API key |
| `RECURPOST_API_URL` | no | API host, default `https://social.recurpost.com`. Only change it when RecurPost support gives you another address. |

### 3. Verify

Ask: *"Verify my RecurPost connection"* (runs `user_login`), then
*"Show me all my connected social accounts"*.

## Troubleshooting

Claude Desktop writes a log per server:

- macOS: `~/Library/Logs/Claude/mcp-server-recurpost.log`
- Windows: `%APPDATA%\Claude\logs\mcp-server-recurpost.log`

| What you see | Cause | Fix |
|---|---|---|
| Server not listed under Settings > Developer at all, no log file | Config never read: saved as `.json.txt`, saved with a BOM, or the app overwrote it on exit | Re-save as *All Files* / *UTF-8*; quit Claude fully before editing |
| Log says `spawn npx ENOENT` | Windows cannot launch `npx` | Use the Windows config above (`node.exe` + full path) |
| Server shows as running, log says `Request timed out` about 60 s after `initialize`, every call fails | `npx` took longer than the handshake limit | Same fix: global install, launch with `node.exe` directly |
| Tool result says `Could not reach https://social.recurpost.com ... [ENOTFOUND]` or `[ECONNREFUSED]` | The spawned process has no working network | Check VPN/proxy/antivirus; if `node -e "fetch('https://social.recurpost.com')"` works in a terminal but not from Claude, the app is sandboxing its child processes |
| `Error: RECURPOST_EMAIL and RECURPOST_API_KEY environment variables are required.` | Credentials not in `env` (or placed after `--` in Claude Code) | Move them into the `env` block / before `--` |
| Tool result has `"code": "invalid_credentials"` | Wrong email or API key, or the key was regenerated | Copy the current key from Account Settings > API key |
| Tool result has `"code": "rate_limited"` and `retry_after_seconds` | Too many calls in one minute for your plan | Wait that many seconds |
| Tool result has `"code": "not_found"` or `"invalid_id"` for an id that used to work | Ids are encrypted strings in v2; numeric ids from 1.x are gone | List the items again and use the new ids |
| Tool result has `"code": "owner_paused"` | The workspace owner paused their subscription | Ask the owner to resume it |

## Available Tools

Every tool works in your default workspace unless you pass `workspace_id`
(a `ws_id` from `workspace_list`). Ids are encrypted strings; the assistant
takes them from the list tools and passes them back unchanged.

### Everyday tools

| Area | Tools |
|------|-------|
| Account and workspaces | `user_login`, `workspace_list`, `workspace_details`, `workspace_members` |
| Social accounts | `social_account_list`, `social_account_details`, `connect_social_account_urls` |
| Posting | `post_content`, `post_status`, `post_details` |
| Queue | `queue_list`, `queue_post`, `queue_post_update`, `queue_post_delete`, `calendar` |
| Drafts | `draft_list`, `draft_save`, `draft_schedule`, `draft_delete` |
| Libraries | `library_list`, `library_details`, `library_create`, `library_content_list`, `library_content`, `add_content_in_library`, `library_content_update`, `library_content_search`, `library_content_delete` |
| Schedules (library time slots) | `schedule_list`, `schedule_create`, `schedule_delete` |
| History | `history_list`, `history_data` |
| Media | `media_list` |
| Labels | `label_list`, `label_create`, `label_assign_add` |
| Approvals and workflow | `approval_list`, `approval_approve`, `approval_reject`, `workflow_board`, `workflow_card` |
| Reports | `report_account`, `report_posts` |
| AI | `generate_content_with_ai`, `generate_image_with_ai`, `ai_hashtags`, `ai_credits` |

Each tool is named after the API endpoint it calls.

### Every other endpoint: `find_endpoints` and `call_endpoint`

The server ships a compact catalog of all 301 RecurPost API v2 endpoints.

- `find_endpoints` searches it by words (and optionally a module such as
  `inbox`, `feeds` or `workflow_board`) and returns matching endpoint ids
  with summaries, plus the full parameter list of the best matches.
- `call_endpoint` calls any endpoint in the catalog by id with a params
  object. It refuses unknown ids and reports missing required parameters
  before anything is sent, and uses the same login and error handling as the
  other tools.

You do not call these yourself: ask for what you want ("reply to the latest
comment on my Facebook page", "pause the Tips library") and the assistant
looks up the endpoint and calls it.

### Safety

- `post_content` without a schedule time publishes immediately.
- Endpoints that delete something need `confirm: true`; the assistant is told
  to ask you first.
- AI generation spends your AI credits (`ai_credits` shows what is left).

## Example prompts

- "Show me all my connected social accounts"
- "Schedule a post about our summer sale on my Facebook page for tomorrow at 9am"
- "Generate a LinkedIn post about remote work productivity tips"
- "What posts went out on my Twitter account this week?"
- "Add 5 evergreen tips about social media marketing to my Tips library"
- "List my workspaces, then show the social accounts in the Client A workspace"
- "What is scheduled for next week, and move Tuesday's LinkedIn post to Wednesday 10am"
- "Which posts failed this month and why?"
- "Show last month's report for my Instagram account"
- "Approve everything waiting for my review in the Tips library"

## Security

- Your credentials are stored in your local config and **never leave your machine** except to authenticate directly with the RecurPost API
- The server runs locally as a subprocess; no external servers are involved
- API key and email are passed via environment variables and never exposed to the AI model; the access token stays inside the server
- Every request identifies itself to RecurPost as coming from the MCP server (`X-RecurPost-Client: mcp`), so it shows up as such on your API key page

## Development

```bash
npm ci
npm run build      # compile to build/
npm test           # unit tests (fetch is mocked, no network)
npm run mcpb       # build the Claude Desktop extension
```

The endpoint catalog in `src/catalog.json` is generated from the RecurPost
API docs repository. After a docs change, regenerate it:

```bash
npm run sync-catalog -- ../recurpost-apis
```

## License

MIT
