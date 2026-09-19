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

#### Claude Desktop

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop after saving.

#### Claude Code

```bash
claude mcp add recurpost --scope user \
  -e RECURPOST_EMAIL=your-email@example.com \
  -e RECURPOST_API_KEY=your-api-key \
  -- npx -y recurpost-mcp
```

The `-e` flags must come before `--`. Anything after `--` is passed to `npx`, so the server would start without credentials. `--scope user` makes the server available in every project; omit it to add it to the current project only.

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
