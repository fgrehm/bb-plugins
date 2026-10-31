import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { piExtrasRpcContract } from "./contract";
import type { PiSettings } from "./pi-settings";
import {
  THINKING_LEVELS,
  buildScopePatterns,
  isNegatedPattern,
  matchesModelPattern,
  modelReference,
  scopeForSettings,
  unresolvedPatterns,
  type PiModelSummary,
} from "./model-scope";
import { UpdateActions } from "./update-actions";
import { BehaviorSettings } from "./behavior-settings";
import { TextServiceSettings } from "./title-service-settings";
import { KNOWN_TOOLS, OTHER_BUILTIN_TOOLS, PI_DEFAULT_TOOLS, BUILTIN_INACTIVE, applyToolToggle, toolsState, type ToolsState } from "./pi-tools";

const FIELD_CLASS = "w-full rounded-md border border-input bg-background px-2 py-1";
/** Sentinel for a saved model that Pi's available list does not contain. */
const UNAVAILABLE = "(not available)";

type Tab = "models" | "runtime" | "tools" | "titles" | "maintenance";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "models", label: "Models" },
  { id: "runtime", label: "Runtime" },
  { id: "tools", label: "Tools" },
  { id: "titles", label: "Titles & commits" },
  { id: "maintenance", label: "Maintenance" },
];

function formatTokens(count: number | null): string {
  if (count === null) return "";
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

function matchesFilter(model: PiModelSummary, filter: string): boolean {
  if (filter === "") return true;
  const lowered = filter.toLowerCase();
  return (
    modelReference(model).toLowerCase().includes(lowered) ||
    (model.name?.toLowerCase().includes(lowered) ?? false)
  );
}

function groupByProvider(models: PiModelSummary[]): Array<[string, PiModelSummary[]]> {
  const groups = new Map<string, PiModelSummary[]>();
  for (const model of models) {
    const existing = groups.get(model.provider);
    if (existing === undefined) groups.set(model.provider, [model]);
    else existing.push(model);
  }
  return [...groups];
}

function placeholderModel(reference: string): PiModelSummary {
  const separator = reference.indexOf("/");
  return {
    provider: reference.slice(0, separator),
    id: reference.slice(separator + 1),
    name: null,
    contextWindow: null,
    maxTokens: null,
    reasoning: false,
    images: false,
  };
}

function SettingsTabs({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return <nav aria-label="Pi settings sections" className="flex gap-1 overflow-x-auto border-b border-border">
    {TABS.map((entry) => (
      <button
        key={entry.id}
        type="button"
        onClick={() => onSelect(entry.id)}
        aria-current={active === entry.id ? "page" : undefined}
        className={`shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active === entry.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
      >
        {entry.label}
      </button>
    ))}
  </nav>;
}

function ModelsTab({
  draft,
  setDraft,
  setScope,
  models,
  modelsError,
  modelsLoading,
  onRefreshModels,
  coveredRefs,
  visibleProviders,
  defaultRef,
  defaultAvailable,
  scope,
  writtenScope,
  unresolved,
  negated,
  coversEverything,
}: {
  draft: PiSettings;
  setDraft: (next: PiSettings) => void;
  setScope: (patterns: string[]) => void;
  models: PiModelSummary[];
  modelsError: string | null;
  modelsLoading: boolean;
  onRefreshModels: () => void;
  coveredRefs: Set<string>;
  visibleProviders: Array<[string, PiModelSummary[]]>;
  defaultRef: string | null;
  defaultAvailable: boolean;
  scope: string[];
  writtenScope: string[] | null;
  unresolved: string[];
  negated: string[];
  coversEverything: boolean;
}): ReactNode {
  const [modelFilter, setModelFilter] = useState("");
  const [modelListFilter, setModelListFilter] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const scopeIsEmpty = scope.length === 0;
  const filter = modelListFilter.trim();
  const scopedProviders = useMemo(
    () => visibleProviders.filter(([, providerModels]) =>
      providerModels.some((model) => matchesFilter(model, filter)),
    ),
    [visibleProviders, filter],
  );
  const noFilterMatches = models.length > 0 && scopedProviders.length === 0;

  const toggleModel = (reference: string, next: boolean) => {
    const checked = new Set(coveredRefs);
    if (next) checked.add(reference);
    else checked.delete(reference);
    setScope(buildScopePatterns(checked, scope, models, defaultRef));
  };

  const toggleModels = (references: string[], next: boolean) => {
    const checked = new Set(coveredRefs);
    for (const reference of references) {
      if (next) checked.add(reference);
      else checked.delete(reference);
    }
    setScope(buildScopePatterns(checked, scope, models, defaultRef));
  };

  const selectDefaultModel = (reference: string) => {
    if (reference === "" || reference === UNAVAILABLE) {
      if (reference === "") setDraft({ ...draft, defaultProvider: null, defaultModel: null });
      return;
    }
    const separator = reference.indexOf("/");
    const provider = reference.slice(0, separator);
    const id = reference.slice(separator + 1);
    // While a scope exists, Pi starts on the scope's first entry and ignores
    // the default model, so keep the chosen model first in the scope.
    const checked = new Set(coveredRefs);
    checked.add(reference);
    setDraft({
      ...draft,
      defaultProvider: provider,
      defaultModel: id,
      enabledModels: scopeIsEmpty ? scope : buildScopePatterns(checked, scope, models, reference),
    });
  };

  // Keep a saved model that no longer exists in the list so the select keeps
  // its value.
  const selectableProviders = useMemo(() => groupByProvider(
    defaultRef !== null && !defaultAvailable ? [...models, placeholderModel(defaultRef)] : models,
  ), [models, defaultRef, defaultAvailable]);

  return <div className="space-y-5 pt-4">
    {modelsError !== null ? (
      <p role="status" className="rounded-md border border-destructive/30 p-2 text-xs text-destructive">
        {modelsError} Model values stay editable.
      </p>
    ) : null}

    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="font-medium" htmlFor="pi-default-model">Default model</label>
        <button
          type="button"
          onClick={onRefreshModels}
          disabled={modelsLoading}
          className="text-xs underline underline-offset-2 disabled:opacity-50"
        >
          {modelsLoading ? "Loading..." : `Refresh (${models.length})`}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          className="w-36 shrink-0 rounded-md border border-input bg-background px-2 py-1"
          placeholder="Filter"
          value={modelFilter}
          onChange={(event) => setModelFilter(event.target.value)}
          aria-label="Filter models"
        />
        <select
          id="pi-default-model"
          className={`min-w-0 ${FIELD_CLASS}`}
          value={defaultRef === null ? "" : defaultAvailable ? defaultRef : UNAVAILABLE}
          onChange={(event) => selectDefaultModel(event.target.value)}
        >
          <option value="">Pi default (automatic)</option>
          {defaultRef !== null && !defaultAvailable ? (
            <option value={UNAVAILABLE}>{defaultRef} (not in Pi&apos;s list)</option>
          ) : null}
          {selectableProviders.filter(([, providerModels]) => providerModels.some((model) => matchesFilter(model, modelFilter))).map(([provider, providerModels]) => (
            <optgroup key={provider} label={provider}>
              {providerModels.filter((model) => matchesFilter(model, modelFilter)).map((model) => {
                const reference = modelReference(model);
                return <option key={reference} value={reference}>
                  {model.id}
                  {model.reasoning ? " thinking" : ""}
                  {model.images ? " images" : ""}
                </option>;
              })}
            </optgroup>
          ))}
        </select>
      </div>
      {defaultRef !== null && !defaultAvailable ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <code>{defaultRef}</code> is not in Pi&apos;s available list (retired, stale catalog, or
          provider signed out). It stays saved, but Pi starts on another model.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {scopeIsEmpty
          ? "A model scope decides what Pi offers; with no scope, every available model is offered and this default applies."
          : `A model scope is set, so Pi starts on its first entry${defaultRef !== null ? ` and keeps ${defaultRef} first in it` : ""}; this default applies only when the scope is empty.`}
      </p>
    </div>

    <div>
      <label className="mb-1 block font-medium" htmlFor="pi-thinking-level">Default thinking level</label>
      <select
        id="pi-thinking-level"
        className={FIELD_CLASS}
        value={draft.defaultThinkingLevel ?? ""}
        onChange={(event) => setDraft({ ...draft, defaultThinkingLevel: (event.target.value || null) as PiSettings["defaultThinkingLevel"] })}
      >
        <option value="">Pi default</option>
        {THINKING_LEVELS.map((level) => <option key={level}>{level}</option>)}
      </select>
    </div>

    <div className="space-y-2">
      <button
        type="button"
        className="text-xs underline underline-offset-2"
        onClick={() => setAdvanced((value) => !value)}
        aria-expanded={advanced}
      >
        {advanced ? "Hide raw provider and model" : "Edit provider and model as raw values"}
      </button>
      {advanced ? (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block font-medium">Default provider</span>
            <input
              className={FIELD_CLASS}
              value={draft.defaultProvider ?? ""}
              onChange={(event) => setDraft({ ...draft, defaultProvider: event.target.value || null })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Default model id</span>
            <input
              className={FIELD_CLASS}
              value={draft.defaultModel ?? ""}
              onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value || null })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Pi stores the provider and the model id separately. Choosing a model from the list above
            writes both together.
          </p>
        </div>
      ) : null}
    </div>

    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="font-medium">Model scope</h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {coversEverything
            ? "Every available model is in scope, so no scope is written to settings."
            : `${coveredRefs.size} of ${models.length} models in scope.`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-input px-2 py-1 text-xs disabled:opacity-50"
            disabled={models.length === 0}
            onClick={() => setScope(models.map(modelReference))}
          >
            Select all
          </button>
          <button
            type="button"
            className="rounded-md border border-input px-2 py-1 text-xs disabled:opacity-50"
            disabled={scopeIsEmpty}
            onClick={() => setScope([])}
          >
            Clear
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Pi has no model exclusion setting. The scope is an allowlist: it decides which models Pi
        offers and which one it starts on.
      </p>

      <input
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
        placeholder="Filter scope list"
        value={modelListFilter}
        onChange={(event) => setModelListFilter(event.target.value)}
        aria-label="Filter scope list"
      />

      {noFilterMatches ? (
        <p className="text-xs text-muted-foreground">No models match the filter.</p>
      ) : null}

      <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border p-2">
        {scopedProviders.map(([provider, providerModels]) => {
          const providerRefs = providerModels.map(modelReference);
          const selectedCount = providerRefs.filter((reference) => coveredRefs.has(reference)).length;
          return <fieldset key={provider} className="space-y-1">
            <legend className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={providerModels.length > 0 && selectedCount === providerModels.length}
                onChange={(event) => toggleModels(providerRefs, event.target.checked)}
                aria-label={`Toggle the listed ${provider} models`}
              />
              {provider}
              <span className="text-muted-foreground">{selectedCount}/{providerModels.length}</span>
            </legend>
            <div className="ml-5 space-y-1">
              {providerModels.filter((model) => matchesFilter(model, filter)).map((model) => {
                const reference = modelReference(model);
                const isDefault =
                  defaultRef !== null && reference.toLowerCase() === defaultRef.toLowerCase();
                return <label key={reference} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={coveredRefs.has(reference)}
                    onChange={(event) => toggleModel(reference, event.target.checked)}
                  />
                  <span className="font-mono">{model.id}</span>
                  <span className="text-muted-foreground">
                    {formatTokens(model.contextWindow)}
                    {model.reasoning ? " thinking" : ""}
                    {model.images ? " images" : ""}
                  </span>
                  {isDefault ? <span className="text-muted-foreground">(default)</span> : null}
                </label>;
              })}
            </div>
          </fieldset>;
        })}
      </div>

      {unresolved.length > 0 || negated.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Pi reports no match for these patterns and skips them at startup. They are kept in case a
            model or provider returns.
          </p>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...unresolved, ...negated])].map((pattern) => (
              <span
                key={pattern}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-xs"
              >
                {pattern}
                {isNegatedPattern(pattern) ? (
                  <span className="text-destructive">unsafe</span>
                ) : null}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => setScope(scope.filter((entry) => entry !== pattern))}
                  aria-label={`Remove pattern ${pattern}`}
                >
                  remove
                </button>
              </span>
            ))}
          </div>
          {negated.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              <code>!</code> is not an exclusion syntax here. A pattern with glob characters reaches
              Pi&apos;s glob matcher, where the prefix inverts the match and can select nearly every
              model.
            </p>
          ) : null}
        </div>
      ) : null}

      <details className="text-xs">
        <summary className="cursor-pointer">Patterns written to settings.json</summary>
        <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted p-2 font-mono">
          {writtenScope === null
            ? "(no enabledModels key: every available model is in scope)"
            : writtenScope.join("\n")}
        </pre>
      </details>
    </section>
  </div>;
}

type McpServer = { name: string; level: "user" | "project"; transport: "stdio" | "http"; detail: string | null };

type McpReport = {
  servers: McpServer[];
  autoEnableCodemode: boolean | null;
  path: string;
  error: string | null;
  invalid: string[];
};

function ToolsTab({
  draft,
  onChange,
}: {
  draft: PiSettings;
  onChange: (next: PiSettings) => void;
}): ReactNode {
  const rpc = useRpc<typeof piExtrasRpcContract>();
  const [mcp, setMcp] = useState<McpReport | null>(null);
  useEffect(() => {
    void rpc.call("readMcpServers", {}).then(setMcp).catch((error) => setMcp({
      servers: [], autoEnableCodemode: null, path: "", error: error instanceof Error ? error.message : String(error), invalid: [],
    }));
  }, [rpc]);

  const state = toolsState(draft.defaultTools);
  const setDefaultTools = (list: string[] | null) => onChange({ ...draft, defaultTools: list });
  const toggle = (name: string, next: boolean) => setDefaultTools(applyToolToggle(draft.defaultTools, name, next));

  const resolved = state.inherited
    ? "Pi's default tools are enabled (read, bash, edit, write)."
    : `${state.active.length} tools enabled in the written selection.`;

  return <div className="space-y-5 pt-4">
    <p className="text-xs text-muted-foreground">
      Pi starts BB threads with its own tool selection; BB picks the model and instructions itself.
      Checking a tool keeps Pi's defaults and adds or removes exactly that tool.
    </p>

    <section className="space-y-2">
      <h3 className="font-medium">Enabled at startup</h3>
      <p className="text-xs text-muted-foreground">{resolved}</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {[PI_DEFAULT_TOOLS, OTHER_BUILTIN_TOOLS].flat().map((tool) => (
          <label key={tool} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.activeSet.has(tool)}
              onChange={(event) => toggle(tool, event.target.checked)}
            />
            <span className="font-mono">{tool}</span>
          </label>
        ))}
      </div>
    </section>

    <section className="space-y-2">
      <h3 className="font-medium">Indirect reach</h3>
      <div className="space-y-1">
        {BUILTIN_INACTIVE.map((tool) => (
          <label key={tool} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.activeSet.has(tool)}
              onChange={(event) => toggle(tool, event.target.checked)}
            />
            <span className="font-mono">{tool}</span>
            <span className="text-muted-foreground">
              {tool === "codemode"
                ? "the model reaches tools by writing sandboxed scripts"
                : "the model finds undeclared tools by search"}
            </span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={"block text-xs font-medium text-muted-foreground"}>Codemode tool presentation</span>
          <select
            className={FIELD_CLASS}
            value={draft.codemode.mode ?? ""}
            onChange={(event) => onChange({ ...draft, codemode: { ...draft.codemode, mode: (event.target.value || null) as "on" | "only" | null } })}
          >
            <option value="">Pi default (on)</option>
            <option value="on">on: declared tools stay listed</option>
            <option value="only">only: tools reachable through codemode</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={"block text-xs font-medium text-muted-foreground"}>Codemode description token budget</span>
          <input
            className={FIELD_CLASS}
            type="number"
            min={0}
            step={1}
            value={draft.codemode.inlineBudget === null ? "" : String(draft.codemode.inlineBudget)}
            placeholder="Pi uses 3000"
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (raw === "") return onChange({ ...draft, codemode: { ...draft.codemode, inlineBudget: null } });
              const parsed = Number(raw);
              onChange({ ...draft, codemode: { ...draft.codemode, inlineBudget: Number.isInteger(parsed) && parsed >= 0 ? parsed : null } });
            }}
          />
        </label>
      </div>
    </section>

    <McpServersCard mcp={mcp} active={state} />

    {state.unmodeledModifiers.length > 0 ? (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          These reference tools the panel does not model, such as extension tools. They are kept as written.
        </p>
        <div className="flex flex-wrap gap-2">
          {state.unmodeledModifiers.map((entry) => (
            <span key={entry} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-xs">
              {entry}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => {
                  const remaining = (draft.defaultTools ?? []).filter((candidate) => candidate !== entry);
                  // Removing the last entry of an inherited (pi-defaults or
                  // modifier-only) list returns to the absent key; removing
                  // entries from an explicit selection keeps an explicit list,
                  // even when that is an empty one.
                  const inheritedish = draft.defaultTools === null || !draft.defaultTools.some((candidate) => candidate !== entry && !candidate.startsWith("+") && !candidate.startsWith("-"));
                  setDefaultTools(remaining.length === 0 && inheritedish ? null : remaining);
                }}
                aria-label={`Remove entry ${entry}`}
              >
                remove
              </button>
            </span>
          ))}
        </div>
      </div>
    ) : null}

    <details className="text-xs">
      <summary className="cursor-pointer">List written to settings.json</summary>
      <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted p-2 font-mono">
        {draft.defaultTools === null
          ? "(no defaultTools key: Pi uses its default selection)"
          : JSON.stringify(draft.defaultTools)}
      </pre>
    </details>
  </div>;
}

function McpServersCard({ mcp, active }: { mcp: McpReport | null; active: ToolsState }) {
  const selected = active.activeSet.has("codemode") || active.activeSet.has("tool_search");
  // Pi also activates codemode itself when a server with codemode exposure
  // connects, and tool search for deferred exposure, unless the file's
  // autoEnableCodemode is explicitly false.
  const autoActive = mcp !== null && mcp.error === null && mcp.servers.length > 0 && mcp.autoEnableCodemode !== false;
  return <section className="space-y-2 rounded-md border border-border p-3">
    <h3 className="font-medium">MCP servers</h3>
    {mcp === null ? <p className="text-xs text-muted-foreground" role="status">Loading MCP servers...</p>
      : mcp.error !== null ? <p role="status" className="text-xs text-destructive">{mcp.error}</p>
        : (
          <>
            {mcp.servers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None configured. Pi&apos;s own docs and tools cover the model&apos;s work without MCP.
              </p>
            ) : (
              <div className="space-y-1">
                {mcp.servers.map((server) => (
                  <div key={server.name} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="font-mono">{server.name}</span>
                    <span className="text-muted-foreground">{server.transport}</span>
                    {server.detail !== null ? <span className="truncate text-muted-foreground">{server.detail}</span> : null}
                  </div>
                ))}
              </div>
            )}
            {mcp.invalid.length > 0 ? (
              <p role="status" className="text-xs text-destructive">
                Pi skips these malformed entries until they are fixed:
                {mcp.invalid.map((entry) => <span key={entry} className="ml-1 font-mono">{entry}</span>)}
              </p>
            ) : null}
          </>
        )}
    {mcp !== null && mcp.error === null && mcp.servers.length > 0 && !selected ? (
      <p className="text-xs text-muted-foreground">
        These tools are not explicitly selected, so a server&apos;s tools are reachable when
        the server declares them directly.{autoActive
          ? " Pi may also activate codemode or tool search itself, based on the server's exposure."
          : " Automatic codemode activation is off here (autoEnableCodemode is false); tool search may still activate for servers with deferred exposure."}
        Enable one above and save for a static choice.
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">
        Servers are configured with <code>pi mcp add</code> and shown read-only here;
        project servers in <code>.pi/mcp.json</code> load after this workspace is trusted.
      </p>
    )}
  </section>;
}

export function PiSettingsPanel() {
  const rpc = useRpc<typeof piExtrasRpcContract>();
  const [tab, setTab] = useState<Tab>("models");
  const [settings, setSettings] = useState<PiSettings | null>(null);
  const [draft, setDraft] = useState<PiSettings | null>(null);
  const [models, setModels] = useState<PiModelSummary[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [updateOutput, setUpdateOutput] = useState("");
  const [updating, setUpdating] = useState<"models" | "plugins" | "pinned" | null>(null);

  const loadModels = useCallback(
    async (force: boolean) => {
      setModelsLoading(true);
      try {
        const result = await rpc.call("listModels", { force });
        setModels(result.models);
        setModelsError(result.error);
      } catch (error) {
        setModels([]);
        setModelsError(error instanceof Error ? error.message : String(error));
      } finally {
        setModelsLoading(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    void rpc.call("readSettings", {}).then((value) => {
      setSettings(value);
      setDraft(value);
    }).catch((error) => setMessage(String(error)));
    void loadModels(false);
  }, [rpc, loadModels]);

  const dirty =
    settings !== null && draft !== null && JSON.stringify(settings) !== JSON.stringify(draft);

  // BB unmounts the settings section when it leaves the settings route, so a
  // fresh mount already re-reads Pi. Re-read on focus as well, but never while
  // the user has unsaved edits.
  useEffect(() => {
    if (dirty) return;
    const reload = () => {
      if (document.visibilityState !== "visible") return;
      void rpc.call("readSettings", {}).then((value) => {
        setSettings(value);
        setDraft(value);
      }).catch(() => undefined);
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [dirty, rpc]);

  // A model scope decides which models Pi offers and which one it starts on.
  const defaultRef = useMemo(() => {
    if (draft === null || draft.defaultProvider === null || draft.defaultModel === null) return null;
    return `${draft.defaultProvider}/${draft.defaultModel}`;
  }, [draft]);

  const defaultAvailable = useMemo(
    () =>
      defaultRef !== null &&
      models.some((model) => modelReference(model).toLowerCase() === defaultRef.toLowerCase()),
    [defaultRef, models],
  );

  const scope = draft?.enabledModels ?? [];
  const coveredRefs = useMemo(
    () => new Set(scope.flatMap((pattern) => matchesModelPattern(pattern, models).map(modelReference))),
    [scope, models],
  );
  const unresolved = useMemo(() => unresolvedPatterns(scope, models), [scope, models]);
  const negated = useMemo(() => scope.filter(isNegatedPattern), [scope]);
  const scopeIsEmpty = scope.length === 0;
  const visibleProviders = useMemo(() => groupByProvider(models), [models]);
  const writtenScope = useMemo(() => scopeForSettings(scope, models), [scope, models]);
  const coversEverything =
    models.length > 0 &&
    writtenScope === null &&
    (scopeIsEmpty || coveredRefs.size === models.length);

  if (!draft) return <p className="text-sm text-muted-foreground">Loading Pi settings...</p>;

  const setScope = (patterns: string[]) => setDraft({ ...draft, enabledModels: patterns });

  const save = async () => {
    setMessage("Saving...");
    try {
      // An empty scope means "every available model", which pi stores by
      // omitting the key entirely.
      const next = { ...draft, enabledModels: writtenScope ?? [] };
      const saved = await rpc.call("writeSettings", next);
      setSettings(saved);
      setDraft(saved);
      setMessage("Saved");
    } catch (error) {
      setMessage(String(error));
    }
  };

  const update = async (target: "models" | "plugins" | "pinned") => {
    setUpdating(target);
    setMessage("");
    setUpdateOutput("");
    try {
      const result = await rpc.call("update", { target });
      const labels = target === "models"
        ? ["Models refreshed", "Model refresh failed"]
        : target === "plugins"
          ? ["Extensions updated", "Extension update failed"]
          : ["Pinned packages updated", "Pinned package update failed"];
      setMessage(labels[result.ok ? 0 : 1]!);
      setUpdateOutput(result.output || "No output.");
      // A refreshed catalog changes which models exist.
      if (target === "models") await loadModels(true);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setUpdating(null);
    }
  };

  return <div className="flex flex-col">
    <SettingsTabs active={tab} onSelect={setTab} />
    <div className="min-w-0 flex-1 px-0 py-0">
      {tab === "models" ? (
        <ModelsTab
          draft={draft}
          setDraft={setDraft}
          setScope={setScope}
          models={models}
          modelsError={modelsError}
          modelsLoading={modelsLoading}
          onRefreshModels={() => void loadModels(true)}
          coveredRefs={coveredRefs}
          visibleProviders={visibleProviders}
          defaultRef={defaultRef}
          defaultAvailable={defaultAvailable}
          scope={scope}
          writtenScope={writtenScope}
          unresolved={unresolved}
          negated={negated}
          coversEverything={coversEverything}
        />
      ) : null}
      {tab === "runtime" ? (
        <div className="space-y-4 pt-4">
          <BehaviorSettings draft={draft} onChange={setDraft} />
        </div>
      ) : null}
      {tab === "tools" ? <ToolsTab draft={draft} onChange={setDraft} /> : null}
      {tab === "titles" ? (
        <div className="pt-4">
          <TextServiceSettings models={models} />
        </div>
      ) : null}
      {tab === "maintenance" ? (
        <div className="space-y-3 pt-4">
          <p className="text-xs text-muted-foreground">
            These run against your global install right away; a refresh here does not change saved values.
          </p>
          <UpdateActions updating={updating} onUpdate={(target) => void update(target)} />
          {updateOutput ? <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap">{updateOutput}</pre> : null}
        </div>
      ) : null}
    </div>

    {tab !== "titles" && tab !== "maintenance" ? (
      <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-border bg-background py-3">
        <button
          type="button"
          disabled={!dirty}
          className="rounded-md border border-input px-3 py-1.5 disabled:opacity-50"
          onClick={() => void save()}
        >
          Save
        </button>
        <p className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes to Pi settings." : message}
        </p>
      </div>
    ) : null}
  </div>;
}