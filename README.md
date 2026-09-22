# RecurPost MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants access to the [RecurPost](https://recurpost.com) social media management API.

## What can it do?

- List connected social accounts and content libraries
- List workspaces and work inside any workspace you're a member of
- Post content immediately or schedule it for later
- Add content to libraries for recurring/evergreen posting
- View posting history with engagement metrics
- Generate social media content and images with AI
- Get URLs to connect new social media accounts

## Setup

### 1. Get your API key

1. Log in to [RecurPost](https://recurpost.com)
2. Go to **Account Settings**
3. Generate an **API Password Key** (this is not your login password)

### 2. Install

The server needs Node.js 18 or newer. Download the LTS installer from
https://nodejs.org if `node -v` in a terminal does not print a version.

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

## Available Tools

| Tool | Description |
|------|-------------|
| `user_login` | Verify your API credentials |
| `workspace_list` | List all workspaces you're a member of (own and shared) |
| `social_account_list` | List all connected social media accounts |
| `library_list` | List all content libraries |
| `connect_social_account_urls` | Get URLs to connect new social accounts |
| `history_data` | Get posting history for a social account |
| `post_content` | Post or schedule content to a social account |
| `add_content_in_library` | Add content to a library for recurring posting |
| `generate_content_with_ai` | Generate social media post text with AI |
| `generate_image_with_ai` | Generate images from text descriptions |

### Workspaces

`social_account_list`, `library_list`, `history_data`, `post_content`, and `add_content_in_library` accept an optional `workspace_id` (a `ws_id` from `workspace_list`). When omitted, your default workspace is used. When provided, results and actions are scoped to that workspace — social accounts and libraries must belong to it.

## Example prompts

- "Show me all my connected social accounts"
- "Schedule a post about our summer sale on my Facebook page for tomorrow at 9am"
- "Generate a LinkedIn post about remote work productivity tips"
- "What posts went out on my Twitter account this week?"
- "Add 5 evergreen tips about social media marketing to my Tips library"
- "List my workspaces, then show the social accounts in the Client A workspace"

## Security

- Your credentials are stored in your local config and **never leave your machine** except to authenticate directly with the RecurPost API
- The server runs locally as a subprocess — no external servers involved
- API key and email are passed via environment variables, never exposed to the AI model

## License

MIT
