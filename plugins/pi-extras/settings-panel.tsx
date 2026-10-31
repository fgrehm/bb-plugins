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

const FIELD_CLASS = "w-full rounded-md border border-input bg-background px-2 py-1";
/** Sentinel for a saved model that Pi's available list does not contain. */
const UNAVAILABLE = "(not available)";

type Tab = "models" | "runtime" | "titles" | "maintenance";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "models", label: "Models" },
  { id: "runtime", label: "Runtime" },
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
  return <nav aria-label="Pi settings sections" className="flex gap-1 border-b border-border">
    {TABS.map((entry) => (
      <button
        key={entry.id}
        type="button"
        onClick={() => onSelect(entry.id)}
        aria-current={active === entry.id ? "page" : undefined}
        className={`rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active === entry.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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