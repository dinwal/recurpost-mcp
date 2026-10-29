# RecurPost MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants access to the whole [RecurPost](https://recurpost.com) public API: 297 operations across 27 modules, generated from the [API documentation](https://developers.recurpost.com/).

## What can it do?

- Post content now or schedule it, on one or many social accounts
- Manage the queue: move, reschedule, retry, publish now, delete
- Save and schedule drafts, and run the approval flow
- Create libraries and add, search or delete evergreen content
- Read posting history, account analytics and the workflow board
- Manage workspaces, members, social accounts, schedules, RSS feeds, labels, the inbox and more
- Generate post text and images with AI

The 40 most used operations are **direct tools** the assistant sees straight away. Every other operation is one call away through three catalog tools:

| Tool | Purpose |
|------|---------|
| `list_operations` | Modules with counts, or the operations of one module or matching a search |
| `describe_operation` | Full description and parameter list of one operation |
| `call_operation` | Run any operation by name; parameters are validated against the docs first |

So "pause the RSS feed in my Tips library" works even though no `feed_pause` tool is listed: the assistant finds it with `list_operations`, then runs it with `call_operation`.

## Setup

### 1. Get your API key

1. Log in to [RecurPost](https://recurpost.com)
2. Go to **Account Settings**
3. Generate an **API Password Key** (this is not your login password)

### 2. Install

#### Claude Desktop (recommended): one-click extension

Works on macOS and Windows. Nothing else to install: Claude Desktop runs the
extension with its own built-in Node.js.

1. Download [recurpost.mcpb](https://github.com/dinwal/recurpost-mcp/releases/latest/download/recurpost.mcpb).
2. Double-click the file (or drag it onto **Settings > Extensions** in
   Claude Desktop) and click **Install**.
3. Enter your RecurPost email and API Password Key when asked. The key is
   stored in your operating system's keychain, not in a plain text file.

The RecurPost tools are available in a new chat straight away. To update,
download the latest file and install it again.

#### Manual setup

The manual routes below need Node.js 18 or newer. Download the LTS installer
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

### 3. Verify

Ask: *"Verify my RecurPost connection"* (runs `user_login`), then
*"Show me all my connected social accounts"*.

## Configuration

| Environment variable | Required | Meaning |
|---|---|---|
| `RECURPOST_EMAIL` | yes | The email you log in to RecurPost with |
| `RECURPOST_API_KEY` | yes | Your API Password Key |
| `RECURPOST_API_URL` | no | API base URL. Default `https://social.recurpost.com` |
| `RECURPOST_MODULES` | no | Comma-separated modules whose operations should all become direct tools (for example `inbox,feeds`), or `all` for every operation. Everything stays reachable through `call_operation` either way |

Each direct tool costs context in every conversation, which is why the default set is 40 and the rest sit behind the catalog tools. Promote a module when you use it constantly; use `all` only with clients that load tool definitions on demand.

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
| Tool result has `"status": 401` | The API key was regenerated or is wrong | Put the current key from Account Settings in the config |
| Tool result has `"status": 429` and `retry_after_seconds` | Your plan's API call limit for the minute or day is used up | Waits of a minute or less are absorbed automatically; longer ones are reported so the assistant can tell you |

## Direct tools

| Tool | Module | Description |
|------|--------|-------------|
| `user_login` | auth | Verify your API key. Reports the account and the token expiry; the token itself never reaches the model. |
| `workspace_list` | workspaces | List the workspaces you own or that are shared with you. |
| `workspace_details` | workspaces | Read one workspace: libraries, accounts, members, pending invites and account manager. |
| `workspace_members` | workspaces | Members of a workspace with role and status, and the approvers you can send content to. |
| `account_details` | accounts | Who the API key belongs to: name, email, timezone, plan, default workspace and queue state. |
| `connect_social_account_urls` | accounts | Get the links that connect a new social account to a workspace. |
| `social_account_list` | accounts | List the social accounts of a workspace with their connection state. |
| `library_list` | libraries | Get every content library in a workspace with its id and name. |
| `library_details` | libraries | Read one library: name, colour, state, one-time-use flag, seasonal window and post counts. |
| `library_create` | libraries | Create a content library in the workspace. |
| `library_content_list` | libraries | Page through the active posts of one library. |
| `library_content_search` | libraries | Find active library posts whose text, link title, variation or network version contains a phrase. |
| `library_content_delete` | libraries | Delete one or more posts from a library. |
| `add_content_in_library` | posts | Add a recurring post to a content library. |
| `post_content` | posts | Publish a post now, or schedule it, on one or more social accounts. |
| `post_status` | posts | Where a post stands on every account it was sent to. |
| `media_upload_url` | media | Get a signed URL to upload an image or video directly to RecurPost storage. |
| `queue_list` | queue | Queued items of the workspace in a date window, one per account and time. |
| `queue_post` | queue | One queued item by its id. |
| `queue_post_update` | queue | Move a queued item to a new time, replace its content, or both. |
| `queue_post_delete` | queue | Remove one or several queued items. |
| `queue_reschedule` | queue | Move queued items to another day, keeping each item's time of day. |
| `queue_post_now` | queue | Publish queued items of one post right away. |
| `post_retry` | queue | Retry a failed queue item now or at a new time. |
| `draft_list` | drafts | List the drafts of a workspace with the accounts each one targets. |
| `draft_save` | drafts | Save a new draft, or replace the content and accounts of an existing one. |
| `draft_schedule` | drafts | Turn a draft into a scheduled post at the given time, keeping its id. |
| `draft_delete` | drafts | Delete a draft and every account row it holds. |
| `approval_list` | approvals | List library posts in the approval flow: waiting on you, sent by you, or rejected. |
| `approval_approve` | approvals | Approve a waiting library post into its library. |
| `approval_reject` | approvals | Reject a waiting library post with a message for the author. |
| `approval_comment` | approvals | Add a comment to the thread of a rejected post. |
| `history_data` | history | Posting history of one social account, built for polling. |
| `history_list` | history | Published and failed posts across every account of the workspace, newest first. |
| `history_to_library` | history | Copy a published post into one or more libraries as evergreen content. |
| `schedule_list` | schedules | List every time slot of the workspace, optionally for one library or account. |
| `report_account` | reports | Analytics for one social account, or the overview of every account in the workspace. |
| `workflow_board` | workflow_board | Columns and cards of the board, for one workspace or for every workspace of the owner you belong to. |
| `generate_content_with_ai` | ai | Generate post text from a prompt, with multi-turn follow-ups to refine it. |
| `generate_image_with_ai` | ai | Generate one image from a text description and get its URL. |

### Every module

All of these are reachable through `list_operations`, `describe_operation` and `call_operation`, and any of them can be promoted to direct tools with `RECURPOST_MODULES`.

| Module | Title | Operations |
|--------|-------|-----------:|
| `accounts` | Social Accounts | 36 |
| `ai` | AI | 15 |
| `approvals` | Approvals | 7 |
| `auth` | Authentication | 1 |
| `content_tools` | Content Tools | 23 |
| `custom_reports` | Custom Reports | 7 |
| `dm_automations` | DM Automations | 9 |
| `drafts` | Drafts | 4 |
| `feeds` | RSS Feeds | 12 |
| `groups` | Account Groups | 5 |
| `history` | History | 4 |
| `import` | Import | 5 |
| `inbox` | Inbox | 28 |
| `libraries` | Libraries | 20 |
| `library_tools` | Library Tools | 23 |
| `media` | Media | 1 |
| `post_labels` | Post Labels | 7 |
| `posts` | Posts | 7 |
| `queue` | Queue | 9 |
| `reports` | Reports | 9 |
| `schedules` | Schedules | 8 |
| `shared_calendars` | Shared Calendars | 11 |
| `team_roles` | Team Roles | 7 |
| `workflow_board` | Workflow Board | 14 |
| `workflow_settings` | Workflow Settings | 6 |
| `workspaces` | Workspaces | 19 |

### How operations map to the API

- One tool per endpoint, named after the endpoint (`queue_list` calls `/api/queue_list`).
- Endpoints that bundle several `action` values become one tool per action (`approval_decide` becomes `approval_approve` and `approval_reject`); the action is sent for you.
- Operations the API protects with `confirm=true` (deleting a workspace, disconnecting an account) send it automatically. Choosing the operation is the confirmation, so the assistant should check with you before running one.
- Every operation that works inside a workspace takes an optional `workspace_id` (a `ws_id` from `workspace_list`). When omitted, your default workspace is used.

## Example prompts

- "Show me all my connected social accounts"
- "Schedule a post about our summer sale on my Facebook page for tomorrow at 9am"
- "What is in my queue for next week, and move Thursday's posts to Friday"
- "Generate a LinkedIn post about remote work productivity tips and save it as a draft"
- "What posts went out on my Twitter account this week?"
- "Add 5 evergreen tips about social media marketing to my Tips library"
- "List my workspaces, then show the social accounts in the Client A workspace"
- "Approve everything waiting for me in the approval queue"
- "Pause the RSS feed in my Tips library" (found through the catalog tools)

## Security

- Your email and API key stay in your local config and are sent only to the RecurPost API, once, to obtain a one-hour access token. Every other call carries the token, which is renewed automatically and never shown to the AI model.
- The server runs locally as a subprocess. No other servers are involved.
- Credentials are read from environment variables; no tool has a parameter for them.

## Development

```bash
npm install
npm run gen        # regenerate src/generated from ../recurpost-apis/data/endpoints
npm run gen:check  # fail if the generated files are out of date
npm test           # compiles, then runs the suite
npm run build      # build/ for npm
npm run mcpb       # Claude Desktop extension (.mcpb)
```

The tool definitions come from the RecurPost API docs repository (`data/endpoints/*.json`). `scripts/tools.config.json` holds what the docs cannot say: the first-class list, nicer names for split actions, and the read-only / destructive hints.

## License

MIT
