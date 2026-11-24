// The curated tools: one per everyday endpoint, with a hand-written
// description for the assistant. Each tool's input schema is built from the
// endpoint's params in the bundled catalog, so names, types, enums and
// required flags follow the API docs. Everything else stays reachable through
// find_endpoints and call_endpoint.

import { z, type ZodTypeAny } from "zod";
import { getEndpoint, getParam, type CatalogParam } from "./catalog.js";

export interface CuratedTool {
  name: string;
  endpoint: string;
  description: string;
  // Catalog params exposed by the tool, in order.
  params: string[];
  // Also expose the shared post fields the endpoint takes: "full" adds
  // COMPOSE_PARAMS, "core" only COMPOSE_CORE_PARAMS (text, media, dates).
  compose?: "full" | "core";
  // Composer params to leave out for this tool.
  exclude?: string[];
  // Per-param description or required-flag overrides. multiple also takes a
  // list of the param's values (the API reads a single value or an array).
  overrides?: Record<string, { description?: string; required?: boolean; multiple?: boolean }>;
  readOnly?: boolean;
  destructive?: boolean;
}

// Post fields shared by post_content, draft_save, queue_post_update,
// add_content_in_library and library_content_update. Only the ones an
// endpoint actually takes are exposed on its tool. post_content and
// add_content_in_library get the full set (as in v1); the edit and draft
// tools get the core set to keep the tool list small.
export const COMPOSE_PARAMS = [
  "message",
  "schedule_date_time",
  "url",
  "image_url",
  "video_url",
  "alt_text",
  "host_images_on_recurpost",
  "first_comment",
  "fb_message",
  "tw_message",
  "ln_message",
  "in_message",
  "gmb_message",
  "pi_message",
  "yt_message",
  "tk_message",
  "th_message",
  "bs_message",
  "fb_post_type",
  "in_post_type",
  "in_reel_share_in_feed",
  "fb_first_comment",
  "ln_first_comment",
  "in_first_comment",
  "ln_document",
  "ln_document_title",
  "pi_title",
  "gbp_cta",
  "gbp_cta_url",
  "gbp_offer_title",
  "gbp_offer_start_date",
  "gbp_offer_end_date",
  "gbp_offer_coupon_code",
  "gbp_offer_terms",
  "gbp_redeem_offer_link",
  "yt_title",
  "yt_category",
  "yt_privacy_status",
  "yt_user_tags",
  "yt_thumb",
  "yt_video_made_for_kids",
  "tk_privacy_status",
  "tk_allow_comments",
  "tk_allow_duet",
  "tk_allow_stitches",
  "is_top_of_queue",
  "content_livedate",
  "content_expiredate",
];

export const COMPOSE_CORE_PARAMS = [
  "message",
  "schedule_date_time",
  "url",
  "image_url",
  "video_url",
  "alt_text",
  "first_comment",
  "fb_message",
  "tw_message",
  "ln_message",
  "in_message",
  "gmb_message",
  "pi_message",
  "yt_message",
  "tk_message",
  "th_message",
  "bs_message",
  "content_livedate",
  "content_expiredate",
];

const MORE_POST_FIELDS =
  "The per-network options post_content takes (post types, first comments per network, YouTube, TikTok, Google Business and Pinterest fields and more) work here too through call_endpoint on the same endpoint.";

const WORKSPACE_DESCRIPTION =
  "Workspace to act in (ws_id from workspace_list). Omit to use your default workspace.";

const CONFIRM_DESCRIPTION =
  "Must be true. Set it only after the user has explicitly confirmed this deletion.";

const RARE_POST_OPTIONS =
  "Rarely used options (Instagram location, people, product and reel tags, audio, collaborators, X threads, AI labels, YouTube playlists, per-network media and covers) are reachable with call_endpoint on the same endpoint; find_endpoints shows them.";

export const CURATED_TOOLS: CuratedTool[] = [
  // --- Account and workspaces ---
  {
    name: "user_login",
    endpoint: "user_login",
    description:
      "Check that the RecurPost email and API key this server is configured with are valid, and show whose account they belong to (user_info) and when the current access token expires. The server logs in by itself before other calls, so use this only to verify the setup or to explain an authentication error. The token itself is never shown.",
    params: [],
    readOnly: true,
  },
  {
    name: "workspace_list",
    endpoint: "workspace_list",
    description:
      "List the workspaces the user owns or is a member of: ws_id, ws_name, ownership (own or shared), is_default and owner_paused. Every other tool takes an optional workspace_id; leave it out to work in the user's default workspace, or pass a ws_id from here to work in a client, brand or team workspace. Start here when the user names a client or workspace.",
    params: [],
    readOnly: true,
  },
  {
    name: "workspace_details",
    endpoint: "workspace_details",
    description:
      "Read one workspace in full: its libraries, social accounts, members with their roles, pending invites, workspace manager and timezone. A quick overview of a client workspace in one call.",
    params: ["workspace_id"],
    readOnly: true,
  },
  {
    name: "workspace_members",
    endpoint: "workspace_members",
    description:
      "List the members of a workspace with role and status, pending invites, and the approvers content can be sent to. Read only: inviting or changing members goes through find_endpoints and call_endpoint (workspace_invite, workspace_member_update).",
    params: ["workspace_id"],
    readOnly: true,
  },

  // --- Social accounts ---
  {
    name: "social_account_list",
    endpoint: "social_account_list",
    description:
      "List the connected social accounts (profiles, pages, channels) of a workspace: smpa_id, smpa_name, status and a reconnect_url when the connection needs repair. smpa_id is the account id the other tools take (post_content id, history_data id, report_account account_id, queue and calendar filters). Ids are opaque strings; pass them back unchanged.",
    params: ["workspace_id"],
    readOnly: true,
  },
  {
    name: "social_account_details",
    endpoint: "social_account_details",
    description:
      "Read one social account (id = smpa_id from social_account_list): network, connection state, timezone, settings, groups, the workspaces it belongs to and, for Meta accounts, the granted permissions. Use it to tell which network an id is or why an account fails to post.",
    params: ["id", "workspace_id"],
    readOnly: true,
  },
  {
    name: "connect_social_account_urls",
    endpoint: "connect_social_account_urls",
    description:
      "Get the links that connect a new social account (Facebook, Instagram, X, LinkedIn, Pinterest, Google Business, TikTok, YouTube, Threads, Bluesky) to a workspace. Give the user the link for the network they want; they open it in a browser to authorize. The new account lands in the given workspace.",
    params: ["workspace_id"],
    readOnly: true,
  },

  // --- Posting and post status ---
  {
    name: "post_content",
    endpoint: "post_content",
    description:
      "Publish a post now, or schedule it, on one or more social accounts. id takes one or more smpa_id values from social_account_list. Without schedule_date_time the post goes out IMMEDIATELY, so confirm with the user before calling without it. schedule_date_time is YYYY-MM-DD HH:MM:SS in each account's own timezone, or ISO 8601 with an offset for one exact moment. message is required; a per-network text (fb_message, in_message and so on) replaces it on that network. Media: image_url (list of public image URLs) or video_url. The answer's post_data.id is the post id for post_status and post_details. " +
      RARE_POST_OPTIONS,
    params: ["id", "workspace_id"],
    compose: "full",
    overrides: {
      id: {
        description:
          "Social account id(s) (smpa_id from social_account_list): one id or a list, at most 50. The same post goes to all of them.",
      },
      fb_post_type: {
        multiple: true,
        description:
          'Facebook post type: feed, reel or story, or a list to post several types at once: ["feed", "story"], ["feed", "reel"], ["story", "reel"] or ["feed", "story", "reel"]. Each type becomes its own queue item on every Facebook page. A reel needs a video. Default: feed.',
      },
      in_post_type: {
        multiple: true,
        description:
          'Instagram post type: feed, story or reel, or the list ["feed", "story"] or ["story", "reel"] to post both (the second goes out a minute after the first). Instagram does not take feed and reel together. A reel needs a video. Default: feed.',
      },
    },
  },
  {
    name: "post_status",
    endpoint: "post_status",
    description:
      "Show where a post stands on every account it was sent to: status, publish time, live post link or fail_reason per account, and each account's queue_item_id. id is the post id (post_data.id from post_content, post_id from queue_list, id from history_list). Use it after post_content to confirm publishing or explain a failure.",
    params: ["id", "workspace_id"],
    readOnly: true,
  },
  {
    name: "post_details",
    endpoint: "post_details",
    description:
      "Read the full content of a post by its post id, in the same fields post_content takes, with its accounts. Use it before editing a scheduled post with queue_post_update, or to reuse a post.",
    params: ["post_id", "workspace_id"],
    readOnly: true,
  },

  // --- Queue ---
  {
    name: "queue_list",
    endpoint: "queue_list",
    description:
      "List what is scheduled: queue items in a date window (default today to 30 days ahead), one item per account and time, with id (the queue item id), post_id, account, library, message and post_date. Filter by account_id (smpa_id) or library_id (cd_id). Paged with page and per_page (at most 50); check total.",
    params: ["workspace_id", "account_id", "library_id", "from", "to", "page", "per_page"],
    readOnly: true,
  },
  {
    name: "queue_post",
    endpoint: "queue_post",
    description:
      "Read one queued item by its queue item id (items[].id of queue_list, or accounts[].queue_item_id of post_status).",
    params: ["id", "workspace_id"],
    readOnly: true,
  },
  {
    name: "queue_post_update",
    endpoint: "queue_post_update",
    description:
      "Change one queued item: move it to a new time with schedule_date_time, change its content (message, media, per-network texts), or both. id is the queue item id from queue_list (not the post_id). Fields left out keep their values. " +
      MORE_POST_FIELDS,
    params: ["id", "workspace_id"],
    compose: "core",
  },
  {
    name: "queue_post_delete",
    endpoint: "queue_post_delete",
    description:
      "Remove one or more items from the queue so they are not published. id takes queue item ids (items[].id of queue_list), at most 50; other accounts of the same post keep their items. This cannot be undone: confirm with the user before calling.",
    params: ["id", "workspace_id"],
    destructive: true,
  },
  {
    name: "calendar",
    endpoint: "calendar",
    description:
      "The queue laid out day by day for a date range (default this week, at most 42 days), every day present even when empty. Use it for 'what is going out this week' or to find empty days. Filter by account_ids or library_ids.",
    params: ["start_date", "end_date", "account_ids", "library_ids", "workspace_id"],
    readOnly: true,
  },

  // --- Drafts ---
  {
    name: "draft_list",
    endpoint: "draft_list",
    description:
      "List saved drafts with their text, media, planned time and the accounts each one targets. A draft's id is what draft_save (to edit), draft_schedule and draft_delete take. Paged.",
    params: ["workspace_id", "account_ids", "page", "per_page"],
    readOnly: true,
  },
  {
    name: "draft_save",
    endpoint: "draft_save",
    description:
      "Save a post as a draft without scheduling it, or replace an existing draft when draft_id is given. id takes the smpa_id values of the accounts it is for. Same content fields as post_content; schedule_date_time is only recorded as the planned time. Schedule it later with draft_schedule. " +
      MORE_POST_FIELDS,
    params: ["id", "draft_id", "workspace_id"],
    compose: "core",
  },
  {
    name: "draft_schedule",
    endpoint: "draft_schedule",
    description:
      "Schedule a draft at schedule_date_time (YYYY-MM-DD HH:MM:SS in each account's timezone, or ISO 8601 with an offset). The draft keeps its id, which then serves as the post id.",
    params: ["draft_id", "schedule_date_time", "workspace_id"],
  },
  {
    name: "draft_delete",
    endpoint: "draft_delete",
    description:
      "Delete a draft for all of its accounts (draft_id from draft_list or draft_save). This cannot be undone: confirm with the user before calling.",
    params: ["draft_id", "workspace_id"],
    destructive: true,
  },

  // --- Libraries and library posts ---
  {
    name: "library_list",
    endpoint: "library_list",
    description:
      "List the content libraries of a workspace: cd_id and cd_name. Libraries hold evergreen posts that RecurPost republishes on the library's schedule. cd_id is the library id for add_content_in_library, library_content_list, schedule_create and the queue filters.",
    params: ["workspace_id"],
    readOnly: true,
  },
  {
    name: "library_details",
    endpoint: "library_details",
    description:
      "Read one library (id = cd_id): name, colour, active or paused, one-time-use flag, seasonal window and post counts.",
    params: ["id", "workspace_id"],
    readOnly: true,
  },
  {
    name: "library_create",
    endpoint: "library_create",
    description:
      "Create a content library. Optional: color (#rrggbb), one_time_use (each post leaves the library once published) and a seasonal window (seasonal_from and seasonal_to as MM/DD). Then add posts with add_content_in_library and time slots with schedule_create.",
    params: ["name", "color", "one_time_use", "seasonal_from", "seasonal_to", "workspace_id"],
  },
  {
    name: "library_content_list",
    endpoint: "library_content_list",
    description:
      "Page through the active posts of one library (id = cd_id from library_list): post id, message, media, live and expiry dates, variations. At most 50 per page; check total.",
    params: ["id", "page", "per_page", "workspace_id"],
    readOnly: true,
  },
  {
    name: "library_content",
    endpoint: "library_content",
    description:
      "Read one library post in full (id from library_content_list or library_content_search), with its version for every network, in the field names add_content_in_library and library_content_update take.",
    params: ["id", "workspace_id"],
    readOnly: true,
  },
  {
    name: "add_content_in_library",
    endpoint: "add_content_in_library",
    description:
      "Add an evergreen post to a content library; RecurPost republishes it on the library's schedule, nothing is published right away. id is the library id (cd_id from library_list). message is required; per-network texts and media work as in post_content. is_top_of_queue 1 makes it go out next; content_livedate and content_expiredate (YYYY-MM-DD) limit when it may go out. " +
      RARE_POST_OPTIONS,
    params: ["id", "workspace_id"],
    compose: "full",
    overrides: {
      id: { description: "Library id (cd_id from library_list). Exactly one." },
    },
  },
  {
    name: "library_content_update",
    endpoint: "library_content_update",
    description:
      "Change some fields of a library post; fields left out keep their values. library_id is the cd_id, id the post id from library_content_list or library_content_search. A blank content_livedate or content_expiredate clears that date. " +
      MORE_POST_FIELDS,
    params: ["library_id", "id", "workspace_id"],
    compose: "core",
  },
  {
    name: "library_content_search",
    endpoint: "library_content_search",
    description:
      "Find library posts whose text, link title, variation or network version contains a phrase, in one library or across every library of the workspace. Returns post ids for library_content, library_content_update and library_content_delete.",
    params: ["search_text", "library_id", "page", "per_page", "workspace_id"],
    readOnly: true,
  },
  {
    name: "library_content_delete",
    endpoint: "library_content_delete",
    description:
      "Delete one or more posts from a library for good. Needs library_id, the post ids (at most 50) and confirm: true, which you set only after the user has confirmed.",
    params: ["library_id", "id", "confirm", "workspace_id"],
    destructive: true,
  },

  // --- Schedules (library time slots) ---
  {
    name: "schedule_list",
    endpoint: "schedule_list",
    description:
      "List the time slots that publish library posts: slot id, library, account, frequency (daily, weekly, monthly), day, time or best_time. Filter by library_id or account_id.",
    params: ["workspace_id", "library_id", "account_id"],
    readOnly: true,
  },
  {
    name: "schedule_create",
    endpoint: "schedule_create",
    description:
      'Add publishing time slots for a library (library_id = cd_id) on one or more accounts (account_id = smpa_id, one or a comma-separated list). slots is a list of objects such as {"frequency": "weekly", "day": 3, "time": "09:30"}: frequency daily, weekly or monthly; day 1 (Monday) to 7 for weekly or 1 to 31 for monthly, not used for daily; time as 24-hour HH:MM in the account\'s timezone, or "best_time": true.',
    params: ["library_id", "account_id", "slots", "workspace_id"],
  },
  {
    name: "schedule_delete",
    endpoint: "schedule_delete",
    description:
      "Delete schedule slots: one slot by id, every slot of a library (library_id) or every slot of an account (account_id); send exactly one of the three. Needs confirm: true, which you set only after the user has confirmed.",
    params: ["id", "library_id", "account_id", "confirm", "workspace_id"],
    destructive: true,
  },

  // --- History ---
  {
    name: "history_list",
    endpoint: "history_list",
    description:
      "Published and failed posts across every account of the workspace, newest first: message, account, post_date, status, live post_link and fail_reason. Filter by a date window (start_date and end_date together, at most 90 days), account_ids, library_id, or failed_only to troubleshoot failures. Paged.",
    params: [
      "workspace_id",
      "start_date",
      "end_date",
      "account_ids",
      "library_id",
      "failed_only",
      "page",
      "per_page",
    ],
    readOnly: true,
  },
  {
    name: "history_data",
    endpoint: "history_data",
    description:
      "Posting history of one social account (id = smpa_id) with live post links and fail reasons. Send start_date and end_date together (YYYY-MM-DD HH:MM:SS in the account's timezone) to get up to 100 posts of that window; without dates only the last 60 minutes come back. For every account at once use history_list.",
    params: ["id", "start_date", "end_date", "is_get_video_updates", "workspace_id"],
    readOnly: true,
  },

  // --- Media ---
  {
    name: "media_list",
    endpoint: "media_list",
    description:
      "List images, GIFs and videos already used in the workspace owner's posts, with URLs you can reuse in image_url or video_url of post_content and add_content_in_library. Filter by types and search; paged.",
    params: ["page", "per_page", "types", "search", "workspace_id"],
    readOnly: true,
  },

  // --- Labels ---
  {
    name: "label_list",
    endpoint: "label_list",
    description:
      "List post labels (id, name, colour, description, post count) and the colour choices. Label ids go to label_assign_add and to report_labels (through call_endpoint).",
    params: ["workspace_id"],
    readOnly: true,
  },
  {
    name: "label_create",
    endpoint: "label_create",
    description: "Create a post label with a name, an optional description and a colour swatch.",
    params: ["name", "description", "color", "workspace_id"],
  },
  {
    name: "label_assign_add",
    endpoint: "label_assign_add",
    description:
      "Add labels to one scheduled post (post_id from post_content, the queue or history) or one library post (content_id); send exactly one of the two. label_ids come from label_list.",
    params: ["post_id", "content_id", "label_ids", "workspace_id"],
  },

  // --- Approvals and workflow board ---
  {
    name: "approval_list",
    endpoint: "approval_list",
    description:
      "List library posts in the approval flow. scope: to_review (waiting on the user, the default), submitted (the user's own, waiting on others), rejected (the user's own, turned down, with comments) or rejected_by_you. items[].id goes to approval_approve and approval_reject.",
    params: ["scope", "library_id", "page", "per_page", "workspace_id"],
    readOnly: true,
  },
  {
    name: "approval_approve",
    endpoint: "approval_approve",
    description:
      "Approve a library post that waits for the user's review; it moves into its library. id from approval_list with scope to_review.",
    params: ["id", "workspace_id"],
  },
  {
    name: "approval_reject",
    endpoint: "approval_reject",
    description:
      "Reject a library post that waits for review, with a message telling the author what to change. id from approval_list with scope to_review.",
    params: ["id", "message", "workspace_id"],
  },
  {
    name: "workflow_board",
    endpoint: "workflow_board",
    description:
      "Read the workflow (Kanban) board: its columns (Ideas, work stages, client approval, scheduled) and their cards with title, platforms, accounts, target date, assignee and labels. Card ids go to workflow_card. Creating, moving, editing and commenting on cards go through find_endpoints and call_endpoint (module workflow_board).",
    params: ["workspace_id", "workspace_ids"],
    readOnly: true,
  },
  {
    name: "workflow_card",
    endpoint: "workflow_card",
    description:
      "Read one workflow card (id from workflow_board) with its schedule, activity history, the actions the user may take and the stages it can move to.",
    params: ["id", "workspace_id"],
    readOnly: true,
  },

  // --- Reports ---
  {
    name: "report_account",
    endpoint: "report_account",
    description:
      "Analytics for one social account (account_id = smpa_id), or the overview of every account in the workspace when account_id is left out: audience, reach, engagement and the most popular post, each with the previous period for comparison. period: today, yesterday, last_week (default) or last_month; or start_date and end_date (YYYY-MM-DD) together.",
    params: ["account_id", "period", "start_date", "end_date", "workspace_id"],
    readOnly: true,
  },
  {
    name: "report_posts",
    endpoint: "report_posts",
    description:
      "Metrics per published post of one account (account_id = smpa_id) over a period, to find the best and worst performing posts. Same period options as report_account.",
    params: ["account_id", "period", "start_date", "end_date", "workspace_id"],
    readOnly: true,
  },

  // --- AI ---
  {
    name: "generate_content_with_ai",
    endpoint: "generate_content_with_ai",
    description:
      "Write social media post text with RecurPost AI from a prompt. Spends one of the workspace owner's AI post credits (see ai_credits). To refine the last answer, send the new instruction as prompt_text together with ai_id, chat_progress and chat_history exactly as the previous answer returned them.",
    params: ["prompt_text", "ai_id", "chat_progress", "chat_history", "workspace_id"],
  },
  {
    name: "generate_image_with_ai",
    endpoint: "generate_image_with_ai",
    description:
      "Generate one image from a text description with RecurPost AI and get its URL, which can go into image_url of post_content or add_content_in_library. Spends an AI image credit (see ai_credits).",
    params: ["prompt_text", "workspace_id"],
  },
  {
    name: "ai_hashtags",
    endpoint: "ai_hashtags",
    description:
      "Suggest up to ten relevant hashtags for a post text. Tags may come back without the # sign; add it yourself. Spends no AI credit.",
    params: ["text", "workspace_id"],
    readOnly: true,
  },
  {
    name: "ai_credits",
    endpoint: "ai_credits",
    description:
      "Show the workspace owner's AI post and AI image credits: total, used, remaining, add-ons and when they reset. Check it before generating content or images.",
    params: ["workspace_id"],
    readOnly: true,
  },
];

// --- Schema building ---

// Shortens a catalog description to its first sentences, for param schemas.
export function brief(text: string, max = 220): string {
  const first = text.split("\n")[0].trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  if (end > 40) return `${cut.slice(0, end)}.`;
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : max)}...`;
}

function isObjectArray(p: CatalogParam): boolean {
  const ex = p.example;
  return Array.isArray(ex) && ex.length > 0 && typeof ex[0] === "object" && ex[0] !== null;
}

export function zodForParam(p: CatalogParam): ZodTypeAny {
  const values = p.enum ?? [];
  switch (p.type) {
    case "integer":
      return z.coerce.number().int();
    case "boolean":
      return z.boolean();
    case "array":
      return isObjectArray(p)
        ? z.array(z.record(z.string(), z.unknown()))
        : z.union([z.array(z.string()), z.string()]);
    case "object":
      return z.record(z.string(), z.unknown());
    default:
      if (values.length > 0 && values.every((v) => typeof v === "string")) {
        return z.enum(values as [string, ...string[]]);
      }
      return z.string();
  }
}

const NETWORK_NAMES: Record<string, string> = {
  fb: "Facebook",
  tw: "Twitter/X",
  ln: "LinkedIn",
  in: "Instagram",
  gmb: "Google Business",
  pi: "Pinterest",
  yt: "YouTube (the video description)",
  tk: "TikTok",
  th: "Threads",
  bs: "Bluesky",
};

function paramDescription(p: CatalogParam, override?: string): string {
  if (override) return override;
  if (p.name === "workspace_id") return WORKSPACE_DESCRIPTION;
  if (p.name === "confirm") return CONFIRM_DESCRIPTION;
  const network = /^([a-z]+)_message$/.exec(p.name)?.[1];
  if (network && NETWORK_NAMES[network]) {
    return `Text for ${NETWORK_NAMES[network]} accounts when it should differ from message.`;
  }
  let text = brief(p.description);
  if (p.type === "integer" && p.enum?.length) text += ` One of: ${p.enum.join(", ")}.`;
  if (p.default !== undefined) text += ` Default: ${String(p.default)}.`;
  return text;
}

// The catalog params a curated tool exposes, in order.
export function toolParamNames(tool: CuratedTool): string[] {
  const endpoint = getEndpoint(tool.endpoint);
  if (!endpoint) throw new Error(`Tool ${tool.name}: unknown endpoint ${tool.endpoint}`);
  const names = [...tool.params];
  if (tool.compose) {
    const list = tool.compose === "core" ? COMPOSE_CORE_PARAMS : COMPOSE_PARAMS;
    for (const name of list) {
      if (tool.exclude?.includes(name) || names.includes(name)) continue;
      if (getParam(endpoint, name)) names.push(name);
    }
  }
  return names;
}

export function buildShape(tool: CuratedTool): Record<string, ZodTypeAny> {
  const endpoint = getEndpoint(tool.endpoint);
  if (!endpoint) throw new Error(`Tool ${tool.name}: unknown endpoint ${tool.endpoint}`);
  const shape: Record<string, ZodTypeAny> = {};
  for (const name of toolParamNames(tool)) {
    const p = getParam(endpoint, name);
    if (!p) throw new Error(`Tool ${tool.name}: endpoint ${tool.endpoint} has no param ${name}`);
    const override = tool.overrides?.[name];
    const required = override?.required ?? p.required;
    const single = zodForParam(p);
    const base = override?.multiple ? z.union([single, z.array(single).min(1)]) : single;
    shape[name] = (required ? base : base.optional()).describe(
      paramDescription(p, override?.description)
    );
  }
  return shape;
}
