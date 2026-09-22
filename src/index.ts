#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { VERSION } from "./version.js";

// --- Credentials from environment (never exposed to tool callers) ---

const EMAIL = process.env.RECURPOST_EMAIL;
const API_KEY = process.env.RECURPOST_API_KEY;

if (!EMAIL || !API_KEY) {
  console.error(
    "Error: RECURPOST_EMAIL and RECURPOST_API_KEY environment variables are required."
  );
  process.exit(1);
}

const API_BASE = "https://social.recurpost.com";

// Node's fetch reports every network failure as a bare "TypeError: fetch failed"
// and buries the real reason (ENOTFOUND, ECONNREFUSED, a rejected certificate...)
// in `cause`. Walk the chain so the tool output says what actually went wrong.
function describeError(e: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const err = cur as { name?: string; message?: string; code?: string; cause?: unknown };
    const code = err.code ? ` [${err.code}]` : "";
    parts.push(`${err.name ?? "Error"}: ${err.message ?? ""}${code}`);
    cur = err.cause;
  }
  return parts.length ? parts.join(" <- ") : String(e);
}

// --- API helper ---

async function callAPI(
  endpoint: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const body: Record<string, unknown> = {
    emailid: EMAIL,
    pass_key: API_KEY,
    ...params,
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Could not reach ${API_BASE}`, { cause: e });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

function toolResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

// --- MCP Server ---

export const server = new McpServer({
  name: "recurpost",
  version: VERSION,
});

// Shared schema for tools that operate within a workspace.
const workspaceIdParam = z
  .string()
  .optional()
  .describe(
    "Workspace ID (ws_id from workspace_list). Omit to use your default workspace."
  );

// 1. Verify credentials
server.tool("user_login", "Verify RecurPost API credentials", {}, async () => {
  try {
    return toolResult(await callAPI("/api/user_login"));
  } catch (e) {
    return toolResult({ error: describeError(e) }, true);
  }
});

// 2. Get social account connection URLs
server.tool(
  "connect_social_account_urls",
  "Get URLs to connect new social media accounts to RecurPost",
  {},
  async () => {
    try {
      return toolResult(await callAPI("/api/connect_social_account_urls"));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 3. List connected social accounts
server.tool(
  "social_account_list",
  "List all connected social media accounts with their IDs",
  {
    workspace_id: workspaceIdParam,
  },
  async (params) => {
    try {
      return toolResult(await callAPI("/api/social_account_list", params));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 4. List content libraries
server.tool(
  "library_list",
  "List all content libraries with their IDs",
  {
    workspace_id: workspaceIdParam,
  },
  async (params) => {
    try {
      return toolResult(await callAPI("/api/library_list", params));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 5. List workspaces
server.tool(
  "workspace_list",
  "List all workspaces the user is a member of (own and shared), with their IDs. Pass a ws_id as workspace_id to other tools to work inside that workspace.",
  {},
  async () => {
    try {
      return toolResult(await callAPI("/api/workspace_list"));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 6. Get posting history
server.tool(
  "history_data",
  "Get posting history for a social account (max 100 posts per request)",
  {
    id: z.string().describe("Social account ID (from social_account_list)"),
    workspace_id: workspaceIdParam,
    start_date: z
      .string()
      .optional()
      .describe("Start date in YYYY-MM-DD HH:MM:SS format"),
    end_date: z
      .string()
      .optional()
      .describe("End date in YYYY-MM-DD HH:MM:SS format"),
    is_get_video_updates: z
      .boolean()
      .optional()
      .describe("Include video update metrics (default: true)"),
  },
  async (params) => {
    try {
      return toolResult(await callAPI("/api/history_data", params));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 7. Add content to a library
server.tool(
  "add_content_in_library",
  "Add a post to a content library for recurring/evergreen posting",
  {
    id: z.string().describe("Library ID (from library_list)"),
    workspace_id: workspaceIdParam,
    message: z.string().describe("Default post content text"),
    image_url: z
      .array(z.string().url())
      .optional()
      .describe("Array of image URLs to attach"),
    video_url: z
      .string()
      .url()
      .optional()
      .describe("Public video URL to attach"),
    url: z.string().url().optional().describe("Website link to include"),
    host_images_on_recurpost: z
      .boolean()
      .optional()
      .describe("Host images on RecurPost (default: true)"),
    fb_message: z
      .string()
      .optional()
      .describe("Facebook-specific message override"),
    tw_message: z
      .string()
      .optional()
      .describe("Twitter/X-specific message override"),
    ln_message: z
      .string()
      .optional()
      .describe("LinkedIn-specific message override"),
    in_message: z
      .string()
      .optional()
      .describe("Instagram-specific message override"),
    gmb_message: z
      .string()
      .optional()
      .describe("Google Business Profile-specific message override"),
    pi_message: z
      .string()
      .optional()
      .describe("Pinterest-specific message override"),
    yt_message: z
      .string()
      .optional()
      .describe("YouTube-specific message override"),
    tk_message: z
      .string()
      .optional()
      .describe("TikTok-specific message override"),
    th_message: z
      .string()
      .optional()
      .describe("Threads-specific message override"),
    bs_message: z
      .string()
      .optional()
      .describe("Bluesky-specific message override"),
    fb_post_type: z
      .enum(["feed", "story", "reel"])
      .optional()
      .describe("Facebook post type"),
    in_post_type: z
      .enum(["feed", "story", "reel"])
      .optional()
      .describe("Instagram post type"),
    in_reel_share_in_feed: z
      .enum(["yes", "no"])
      .optional()
      .describe("Share Instagram reel in feed"),
    first_comment: z.string().optional().describe("Default first comment"),
    fb_first_comment: z
      .string()
      .optional()
      .describe("Facebook first comment"),
    ln_first_comment: z
      .string()
      .optional()
      .describe("LinkedIn first comment"),
    in_first_comment: z
      .string()
      .optional()
      .describe("Instagram first comment"),
    ln_document: z
      .string()
      .url()
      .optional()
      .describe("LinkedIn document URL (PPT/PDF/DOCX)"),
    ln_document_title: z
      .string()
      .optional()
      .describe("LinkedIn document title"),
    pi_title: z.string().optional().describe("Pinterest pin title"),
    gbp_cta: z
      .enum([
        "None",
        "Learn more",
        "Sign up",
        "Buy",
        "Order online",
        "Book",
        "Call now",
        "Offer",
      ])
      .optional()
      .describe("Google Business Profile call to action"),
    gbp_cta_url: z
      .string()
      .url()
      .optional()
      .describe("Google Business Profile CTA URL"),
    gbp_offer_title: z.string().optional().describe("GBP offer title"),
    gbp_offer_start_date: z
      .string()
      .optional()
      .describe("GBP offer start date"),
    gbp_offer_end_date: z
      .string()
      .optional()
      .describe("GBP offer end date"),
    gbp_offer_coupon_code: z
      .string()
      .optional()
      .describe("GBP offer coupon code"),
    gbp_offer_terms: z
      .string()
      .optional()
      .describe("GBP offer terms and conditions"),
    gbp_redeem_offer_link: z
      .string()
      .url()
      .optional()
      .describe("GBP offer redemption URL"),
    yt_title: z.string().optional().describe("YouTube video title"),
    yt_category: z.string().optional().describe("YouTube video category"),
    yt_privacy_status: z
      .enum(["Public", "Private", "Unlisted"])
      .optional()
      .describe("YouTube privacy status"),
    yt_user_tags: z.string().optional().describe("YouTube tags"),
    yt_thumb: z
      .string()
      .url()
      .optional()
      .describe("YouTube custom thumbnail URL"),
    yt_video_made_for_kids: z
      .enum(["yes", "no"])
      .optional()
      .describe("Is the YouTube video made for kids"),
    tk_privacy_status: z
      .enum(["Public to Everyone", "Mutual Follow Friends", "Self Only"])
      .optional()
      .describe("TikTok privacy status"),
    tk_allow_comments: z
      .enum(["yes", "no"])
      .optional()
      .describe("Allow TikTok comments"),
    tk_allow_duet: z
      .enum(["yes", "no"])
      .optional()
      .describe("Allow TikTok duets"),
    tk_allow_stitches: z
      .enum(["yes", "no"])
      .optional()
      .describe("Allow TikTok stitches"),
    is_top_of_queue: z
      .enum(["0", "1"])
      .optional()
      .describe("Add to top of queue (1) or bottom (0)"),
    content_livedate: z
      .string()
      .optional()
      .describe("Content live date (YYYY-MM-DD)"),
    content_expiredate: z
      .string()
      .optional()
      .describe("Content expiry date (YYYY-MM-DD)"),
  },
  async (params) => {
    try {
      return toolResult(await callAPI("/api/add_content_in_library", params));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 8. Post or schedule content
server.tool(
  "post_content",
  "Post content immediately or schedule it for a future time on a social account",
  {
    id: z
      .string()
      .describe("Social account ID (from social_account_list)"),
    workspace_id: workspaceIdParam,
    message: z.string().describe("Post content text"),
    schedule_date_time: z
      .string()
      .optional()
      .describe(
        "Schedule time in YYYY-MM-DD HH:MM:SS format. Omit for immediate posting."
      ),
    image_url: z
      .array(z.string().url())
      .optional()
      .describe("Array of image URLs to attach"),
    video_url: z
      .string()
      .url()
      .optional()
      .describe("Public video URL to attach"),
    url: z.string().url().optional().describe("Website link to include"),
    host_images_on_recurpost: z
      .boolean()
      .optional()
      .describe("Host images on RecurPost (default: true)"),
    fb_message: z
      .string()
      .optional()
      .describe("Facebook-specific message override"),
    tw_message: z
      .string()
      .optional()
      .describe("Twitter/X-specific message override"),
    ln_message: z
      .string()
      .optional()
      .describe("LinkedIn-specific message override"),
    in_message: z
      .string()
      .optional()
      .describe("Instagram-specific message override"),
    gmb_message: z
      .string()
      .optional()
      .describe("Google Business Profile-specific message override"),
    pi_message: z
      .string()
      .optional()
      .describe("Pinterest-specific message override"),
    yt_message: z
      .string()
      .optional()
      .describe("YouTube-specific message override"),
    tk_message: z
      .string()
      .optional()
      .describe("TikTok-specific message override"),
    th_message: z
      .string()
      .optional()
      .describe("Threads-specific message override"),
    bs_message: z
      .string()
      .optional()
      .describe("Bluesky-specific message override"),
    fb_post_type: z
      .enum(["feed", "story", "reel"])
      .optional()
      .describe("Facebook post type"),
    in_post_type: z
      .enum(["feed", "story", "reel"])
      .optional()
      .describe("Instagram post type"),
    in_reel_share_in_feed: z
      .enum(["yes", "no"])
      .optional()
      .describe("Share Instagram reel in feed"),
    first_comment: z.string().optional().describe("Default first comment"),
    fb_first_comment: z
      .string()
      .optional()
      .describe("Facebook first comment"),
    ln_first_comment: z
      .string()
      .optional()
      .describe("LinkedIn first comment"),
    in_first_comment: z
      .string()
      .optional()
      .describe("Instagram first comment"),
    ln_document: z
      .string()
      .url()
      .optional()
      .describe("LinkedIn document URL (PPT/PDF/DOCX)"),
    ln_document_title: z
      .string()
      .optional()
      .describe("LinkedIn document title"),
    pi_title: z.string().optional().describe("Pinterest pin title"),
    gbp_cta: z
      .enum([
        "None",
        "Learn more",
        "Sign up",
        "Buy",
        "Order online",
        "Book",
        "Call now",
        "Offer",
      ])
      .optional()
      .describe("Google Business Profile call to action"),
    gbp_cta_url: z
      .string()
      .url()
      .optional()
      .describe("Google Business Profile CTA URL"),
    yt_title: z.string().optional().describe("YouTube video title"),
    yt_category: z.string().optional().describe("YouTube video category"),
    yt_privacy_status: z
      .enum(["Public", "Private", "Unlisted"])
      .optional()
      .describe("YouTube privacy status"),
    yt_user_tags: z.string().optional().describe("YouTube tags"),
    yt_thumb: z
      .string()
      .url()
      .optional()
      .describe("YouTube custom thumbnail URL"),
    yt_video_made_for_kids: z
      .enum(["yes", "no"])
      .optional()
      .describe("Is the YouTube video made for kids"),
    tk_privacy_status: z
      .enum(["Public to Everyone", "Mutual Follow Friends", "Self Only"])
      .optional()
      .describe("TikTok privacy status"),
    tk_allow_comments: z
      .enum(["yes", "no"])
      .optional()
      .describe("Allow TikTok comments"),
    tk_allow_duet: z
      .enum(["yes", "no"])
      .optional()
      .describe("Allow TikTok duets"),
    tk_allow_stitches: z
      .enum(["yes", "no"])
      .optional()
      .describe("Allow TikTok stitches"),
  },
  async (params) => {
    try {
      return toolResult(await callAPI("/api/post_content", params));
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 9. Generate content with AI
server.tool(
  "generate_content_with_ai",
  "Generate social media content text using RecurPost AI. Supports multi-turn conversations via ai_id.",
  {
    prompt_text: z
      .string()
      .describe("Topic or text to generate content about"),
    ai_id: z
      .string()
      .optional()
      .describe(
        "AI conversation ID from a previous response, for follow-up turns"
      ),
    chat_progress: z
      .string()
      .optional()
      .describe("Chat progress marker from a previous response"),
  },
  async (params) => {
    try {
      return toolResult(
        await callAPI("/api/generate_content_with_ai", params)
      );
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// 10. Generate image with AI
server.tool(
  "generate_image_with_ai",
  "Generate an image from a text description using RecurPost AI",
  {
    prompt_text: z
      .string()
      .describe("Detailed description of the image to generate"),
  },
  async (params) => {
    try {
      return toolResult(
        await callAPI("/api/generate_image_with_ai", params)
      );
    } catch (e) {
      return toolResult({ error: describeError(e) }, true);
    }
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RecurPost MCP Server running on stdio");
}

// Only take over stdio when executed as a CLI, not when imported (e.g. by tests).
// process.argv[1] is the path as invoked, which for `npx recurpost-mcp` is the
// node_modules/.bin symlink, while import.meta.url is always the realpath of this
// module. Resolve argv[1] through realpath so the two are comparable.
function isRunningAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isRunningAsCli()) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
