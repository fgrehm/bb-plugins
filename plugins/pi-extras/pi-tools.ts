/**
 * Pi's `defaultTools` semantics, mirrored from Pi's own resolver
 * (packages/coding-agent/src/core/settings-manager.ts `resolveDefaultTools`),
 * which the docs in packages/coding-agent/docs/settings.md describe:
 *
 * - an absent key (`null` here) uses Pi's defaults (read, bash, edit, write);
 * - an explicit `[]` disables built-in tools;
 * - a list whose non-modifier entries (`plain`) are non-empty replaces the
 *   selection with those plain names; note an empty-string entry is a plain
 *   entry, so `[""]` is a replacing list resolving to no valid tools;
 * - a list of only `+name` / `-name` entries modifies Pi's inherited selection;
 * - plain names may repeat: `-name` removes the first matching occurrence, so
 *   `["read", "read", "-read"]` leaves `read` selected.
 *
 * Edits preserve these semantics: a toggle in inherited mode writes
 * `+name` / `-name` entries against Pi's defaults and returns `null` when
 * nothing relative remains; a toggle on an explicit selection rewrites it as
 * the resolved plain-name list, folding modifiers in. Modifier entries
 * targeting tools the panel does not model (extension tools) are preserved
 * verbatim, in their original order, including duplicates, because Pi applies
 * modifiers in order and the panel cannot model their targets.
 */
export const PI_DEFAULT_TOOLS = ["read", "bash", "edit", "write"] as const;

/** Built-in extensions that register inactive; `+name` enables them. */
export const BUILTIN_INACTIVE = ["codemode", "tool_search"] as const;

/** Built-ins Pi ships but does not enable by default. */
export const OTHER_BUILTIN_TOOLS = ["powershell", "grep", "find", "ls"] as const;

export const KNOWN_TOOLS: readonly string[] = [...PI_DEFAULT_TOOLS, ...OTHER_BUILTIN_TOOLS, ...BUILTIN_INACTIVE];

function isModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

export type ToolsState = {
  /** True when edits resolve against Pi's defaults: key absent, or modifier-only. */
  inherited: boolean;
  /** Ordered resolved active tool names, as Pi resolves them. */
  active: string[];
  /** Resolved names as a set, mirroring the ordered list. */
  activeSet: Set<string>;
  /** Raw modifier entries targeting tools the panel does not model, in order. */
  unmodeledModifiers: string[];
};

/** Pi's `resolveDefaultTools` for the panel's raw list; `null` means the key is absent. */
export function resolveDefaultToolsPanel(defaultTools: readonly string[] | null): string[] {
  const raw = defaultTools ?? [];
  const plain = raw.filter((entry) => !isModifier(entry));
  // An absent key is pi's defaults; an explicit [] is an empty selection.
  const tools = defaultTools === null
    ? [...PI_DEFAULT_TOOLS]
    : plain.length > 0 || raw.length === 0 ? [...plain] : [...PI_DEFAULT_TOOLS];
  for (const entry of raw) {
    if (!isModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

export function toolsState(defaultTools: readonly string[] | null): ToolsState {
  const raw = defaultTools ?? [];
  const plain = raw.filter((entry) => !isModifier(entry));
  const active = resolveDefaultToolsPanel(defaultTools);
  return {
    inherited: defaultTools === null || (raw.length > 0 && plain.length === 0),
    active,
    activeSet: new Set(active),
    unmodeledModifiers: raw.filter(
      (entry) => isModifier(entry) && !KNOWN_TOOLS.includes(entry.slice(1)),
    ),
  };
}

/**
 * Applies one toggle. Returns `null` when the result equals Pi's inherited
 * selection, so the key can be removed; an explicit selection (including an
 * empty one) is returned as the resolved plain-name list.
 */
export function applyToolToggle(
  defaultTools: readonly string[] | null,
  name: string,
  next: boolean,
): string[] | null {
  const state = toolsState(defaultTools);
  if (!state.activeSet.has(name) === !next) {
    // A no-op toggle must not rewrite anything: keep the original representation.
    return defaultTools === null ? null : [...defaultTools];
  }
  const active = new Set(state.activeSet);
  if (next) active.add(name);
  else active.delete(name);

  if (state.inherited) {
    const list: string[] = [];
    for (const tool of PI_DEFAULT_TOOLS) {
      if (!active.has(tool)) list.push(`-${tool}`);
    }
    for (const tool of [...OTHER_BUILTIN_TOOLS, ...BUILTIN_INACTIVE]) {
      if (active.has(tool)) list.push(`+${tool}`);
    }
    // Unknown modifiers stay exactly as written, in original order, because pi
    // applies them in order and their resolved values are not modeled here.
    for (const entry of defaultTools ?? []) {
      if (state.unmodeledModifiers.includes(entry)) list.push(entry);
    }
    if (list.length === 0) return null;
    return list;
  }

  // Explicit selection: rewrite as the resolved plain-name list, including
  // unknown tools plain entries or `+name` modifiers contributed.
  const order: string[] = [...KNOWN_TOOLS];
  for (const tool of state.active) {
    if (!KNOWN_TOOLS.includes(tool) && !order.includes(tool)) order.push(tool);
  }
  const list: string[] = [];
  for (const tool of order) {
    if (!active.has(tool) || list.includes(tool)) continue;
    // A resolved name that begins with "+" or "-" (pi allows extension tools
    // with such names) cannot be written as a plain entry: pi would read it as
    // a modifier. It is kept as an explicit `+name` selection that pi resolves
    // onto the baseline.
    list.push(isModifier(tool) ? `+${tool}` : tool);
  }
  // When every entry is a modifier, pi's list would be modifier-only and
  // resolve against its defaults instead of the explicit baseline. An empty
  // plain entry anchors the baseline: pi reads it as a replacing list and
  // resolves it to exactly the appended selections.
  if (list.length > 0 && list.every((entry) => isModifier(entry))) list.unshift("");
  return list.length === 0 ? [] : list;
}