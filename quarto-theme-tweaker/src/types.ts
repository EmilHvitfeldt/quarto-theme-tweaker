/** Shared message + schema types used across host, webview, and bridge. */

export type Widget = "slider" | "color" | "select";

export interface Preset {
  /** Stable id, also used as the key in the working set. */
  id: string;
  label: string;
  group: string;
  /** Optional finer grouping within a `group` (rendered as a sub-header). */
  subgroup?: string;
  /** Sass variable name, including leading `$`. */
  sassVar: string;
  widget: Widget;
  /** Unit appended to numeric slider values (e.g. "rem"). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Options for `select` widgets. */
  options?: string[];
  default: string | number;
  /** If present, the fast path: a runtime CSS custom property. */
  cssVar?: string;
  /** Selector the cssVar lives on (defaults to ":root"). */
  applyScope?: string;
}

export interface PresetSchema {
  format: string;
  presets: Preset[];
}

/** Messages: webview -> host. */
export type PanelToHost =
  | { type: "ready" }
  | { type: "valueChanged"; id: string; value: string | number }
  | { type: "commit" }
  | { type: "reset" }
  | { type: "fullRender" };

/** Messages: host -> webview. */
export type HostToPanel =
  | { type: "init"; schema: PresetSchema; values: Record<string, string | number>; previewUrl: string }
  | { type: "status"; text: string; kind?: "info" | "error" }
  | { type: "values"; values: Record<string, string | number> }
  | { type: "dirty"; ids: string[] };

/** Messages: host/server -> bridge client (in the preview page). */
export type BridgeMessage =
  | { type: "setCssVar"; selector: string; name: string; value: string }
  | { type: "replaceStylesheet"; css: string }
  | { type: "reload" };
