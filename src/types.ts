// Shapes shared by the generated endpoint definitions (src/generated) and the tool registry.
// Regenerate with `npm run gen` after the API docs change.

export type ParamType =
  | "string"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "array"
  | "object"
  | "email"
  | "url";

export interface ParamSpec {
  // RecurPost API parameter name, sent as-is
  key: string;
  type: ParamType;
  required: boolean;
  description: string;
  // Allowed values when the docs list them
  values?: string[];
  default?: string;
  example?: unknown;
  // For arrays: what one element is
  items?: "string" | "object";
  // A single value is accepted as a one-item list
  acceptsList?: boolean;
}

export interface ToolSpec {
  // MCP tool name: the endpoint id, or endpoint id plus action for endpoints that bundle several
  name: string;
  title: string;
  module: string;
  endpoint: string;
  // Sent as the `action` parameter on endpoints that bundle several actions
  action?: string;
  // Sent as confirm=true: the user chose the tool, that is the confirmation
  confirm?: boolean;
  summary: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  params: ParamSpec[];
}

export interface ModuleSpec {
  key: string;
  title: string;
  description: string;
}
