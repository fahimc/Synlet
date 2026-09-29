import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { clearComposerValue, readComposerValue } from "@/components/ui";
import { AgentHarness } from "@/generated/AgentHarness";
import "./styles.css";

let login: Promise<string> | undefined;
async function operatorToken(): Promise<string> {
  const stored = window.sessionStorage.getItem("synlet-operator-token");
  if (stored) return stored;
  login ??= new Promise<string>((resolveToken) => {
    const box = document.createElement("form");
    box.id = "synlet-login";
    box.style.cssText =
      "position:fixed;z-index:9999;inset:25% 15%;padding:32px;background:#17202b;color:white;border:1px solid #888;border-radius:12px";
    box.innerHTML =
      '<h2>Synlet full-control sign in</h2><p>Paste the operator token from runtime-data/operator-auth.json. Anyone with this token has full launch-user PC access. Keep remote proxy authentication enabled.</p><input aria-label="Operator token" type="password" autocomplete="off" required style="width:100%;padding:12px"><button type="submit">Connect</button>';
    box.onsubmit = (event) => {
      event.preventDefault();
      const token = box.querySelector("input")!.value.trim();
      if (!token) return;
      window.sessionStorage.setItem("synlet-operator-token", token);
      box.remove();
      resolveToken(token);
    };
    document.body.append(box);
  });
  return login;
}
const headers = { "content-type": "application/json" };

interface AgentRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly prompt: string;
  readonly result?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface TraceEvent {
  readonly sequence: number;
  readonly nodeId: string;
  readonly parentNodeId?: string;
  readonly kind: "run" | "model" | "skill" | "tool" | "result" | "error";
  readonly label: string;
  readonly status: "running" | "completed" | "failed";
  readonly data: unknown;
}

interface Message {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly runId?: string;
  readonly events?: readonly TraceEvent[];
  readonly status?: AgentRun["status"];
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("authorization", `Bearer ${await operatorToken()}`);
  new Headers(init.headers).forEach((value, key) =>
    requestHeaders.set(key, value),
  );
  const response = await fetch(path, { ...init, headers: requestHeaders });
  const value = (await response.json()) as
    T | { code?: string; message?: string };
  if (!response.ok) {
    if (response.status === 401) {
      window.sessionStorage.removeItem("synlet-operator-token");
      login = undefined;
    }
    const error = value as { code?: string; message?: string };
    throw new Error(error.message ?? error.code ?? `HTTP ${response.status}`);
  }
  return value as T;
}

function detail(event: TraceEvent): string {
  const data = event.data as Record<string, unknown> | null;
  if (data && typeof data.summary === "string") return data.summary;
  if (data && typeof data.message === "string") return data.message;
  if (data?.failure && typeof data.failure === "object") {
    const failure = data.failure as Record<string, unknown>;
    const explanation = [
      failure.message,
      failure.feedback,
      failure.diagnostic,
    ].find((value): value is string => typeof value === "string");
    if (explanation) return `Restarted with failure context: ${explanation}`;
  }
  if (event.kind === "tool" && data?.arguments)
    return JSON.stringify(data.arguments).slice(0, 160);
  if (event.kind === "result") return "Answer returned to chat";
  return event.parentNodeId
    ? `from ${event.parentNodeId.slice(0, 12)}`
    : "root";
}

function traceModel(event: TraceEvent): string | undefined {
  if (event.kind !== "model") return undefined;
  const data = event.data as Record<string, unknown> | null;
  if (data && typeof data.modelVersion === "string") return data.modelVersion;
  if (data && typeof data.modelId === "string") return data.modelId;
  return undefined;
}

function traceView(events: readonly TraceEvent[]) {
  const latest = new Map<string, TraceEvent>();
  for (const event of events) latest.set(event.nodeId, event);
  return [...latest.values()].map((event) => {
    const model = traceModel(event);
    return {
      label: event.label,
      detail: detail(event),
      model: model ? `MODEL · ${model}` : "",
      hasModel: Boolean(model),
      status: event.status,
      tone:
        event.status === "failed"
          ? "danger"
          : event.status === "running"
            ? "warning"
            : "success",
      icon: event.kind,
    };
  });
}

function App() {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [runs, setRuns] = useState<readonly AgentRun[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [runtime, setRuntime] = useState("checking");
  const [model, setModel] = useState("local model");
  const [capabilities, setCapabilities] = useState([
    { label: "GPU", value: "checking", tone: "muted" },
    { label: "MCP", value: "checking", tone: "muted" },
    { label: "TOOLS", value: "checking", tone: "muted" },
  ]);
  const activeRun = useRef<string | undefined>(undefined);

  async function refreshRuns(): Promise<readonly AgentRun[]> {
    const persisted = await api<AgentRun[]>("/api/v1/agent-runs?limit=500");
    setRuns(persisted);
    return persisted;
  }

  async function openSession(
    nextSessionId: string,
    knownRuns?: readonly AgentRun[],
  ): Promise<void> {
    if (activeRun.current) return;
    const available = knownRuns ?? (await refreshRuns());
    const sessionRuns = available
      .filter((run) => run.sessionId === nextSessionId)
      .toReversed();
    const eventSets = await Promise.all(
      sessionRuns.map((run) =>
        api<TraceEvent[]>(`/api/v1/agent-runs/${run.runId}/events?after=0`),
      ),
    );
    setSessionId(nextSessionId);
    setMessages(
      sessionRuns.flatMap((run, index) => [
        {
          id: `${run.runId}-user`,
          role: "user" as const,
          content: run.prompt,
        },
        {
          id: `${run.runId}-assistant`,
          role: "assistant" as const,
          content:
            run.status === "running"
              ? "Working on it…"
              : (run.result ?? run.status),
          runId: run.runId,
          events: eventSets[index] ?? [],
          status: run.status,
        },
      ]),
    );
    const running = sessionRuns.find((run) => run.status === "running");
    if (running) {
      activeRun.current = running.runId;
      const events = eventSets[sessionRuns.indexOf(running)] ?? [];
      void watch(running.runId, events.at(-1)?.sequence ?? 0);
    }
  }

  useEffect(() => {
    void Promise.all([
      api<{ readiness: string }>("/health/ready"),
      api<{ modelId: string; role: string; enabled: boolean }[]>(
        "/api/v1/models",
      ),
      api<{ source: string }[]>("/api/v1/agent-tools"),
    ])
      .then(([health, models, tools]) => {
        const enabledModels = models.filter((entry) => entry.enabled);
        const controller = enabledModels.find(
          (entry) => entry.role === "controller",
        );
        setRuntime(
          health.readiness === "ready"
            ? "LOCAL HOST · READY"
            : health.readiness.toUpperCase(),
        );
        setModel(
          enabledModels.length > 0
            ? `SOMA · ${enabledModels.length} models`
            : "models unavailable",
        );
        setCapabilities([
          {
            label: "GPU",
            value: controller ? "configured" : "unavailable",
            tone: controller ? "success" : "danger",
          },
          {
            label: "MCP",
            value: `${tools.filter((entry) => entry.source === "mcp").length} tools`,
            tone: "success",
          },
          { label: "TOOLS", value: `${tools.length} active`, tone: "success" },
        ]);
      })
      .catch((error: unknown) => {
        setRuntime("UNAVAILABLE");
        setCapabilities([
          {
            label: "ERROR",
            value: error instanceof Error ? error.message : String(error),
            tone: "danger",
          },
        ]);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    void refreshRuns()
      .then((persisted) => {
        if (!disposed && persisted[0])
          return openSession(persisted[0].sessionId, persisted);
        return undefined;
      })
      .catch((error: unknown) => {
        if (!disposed)
          setMessages([
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Could not restore session logs: ${error instanceof Error ? error.message : String(error)}`,
              status: "failed",
            },
          ]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function watch(runId: string, initialAfter = 0): Promise<void> {
    let after = initialAfter;
    for (;;) {
      const [run, fresh] = await Promise.all([
        api<AgentRun>(`/api/v1/agent-runs/${runId}`),
        api<TraceEvent[]>(`/api/v1/agent-runs/${runId}/events?after=${after}`),
      ]);
      const lastEvent = fresh.at(-1);
      if (lastEvent) after = lastEvent.sequence;
      setMessages((current) =>
        current.map((message) =>
          message.runId !== runId
            ? message
            : {
                ...message,
                content:
                  run.status === "running"
                    ? "Working on it…"
                    : (run.result ?? run.status),
                events: [
                  ...(message.events ?? []),
                  ...fresh.filter(
                    (event) =>
                      !(message.events ?? []).some(
                        (existing) => existing.sequence === event.sequence,
                      ),
                  ),
                ],
                status: run.status,
              },
        ),
      );
      if (run.status !== "running") {
        activeRun.current = undefined;
        await refreshRuns();
        return;
      }
      await new Promise((resolvePromise) =>
        window.setTimeout(resolvePromise, 350),
      );
    }
  }

  async function send(): Promise<void> {
    const prompt = readComposerValue();
    if (!prompt || activeRun.current) return;
    clearComposerValue();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: prompt },
    ]);
    try {
      const run = await api<AgentRun>("/api/v1/agent-runs", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ sessionId, prompt }),
      });
      setRuns((current) => [run, ...current]);
      activeRun.current = run.runId;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Starting local agent…",
          runId: run.runId,
          events: [],
          status: "running",
        },
      ]);
      await watch(run.runId);
    } catch (error: unknown) {
      activeRun.current = undefined;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : String(error),
          status: "failed",
        },
      ]);
    }
  }

  function onAction(action: string): void {
    if (action === "send") void send();
    if (action === "newChat" && !activeRun.current) {
      setSessionId(crypto.randomUUID());
      setMessages([]);
    }
    if (action.startsWith("session:") && !activeRun.current)
      void openSession(action.slice("session:".length));
    if (action === "cancel" && activeRun.current)
      void api(`/api/v1/agent-runs/${activeRun.current}/cancel`, {
        method: "POST",
      });
  }

  const view = useMemo(() => {
    const sessionEntries = new Map<
      string,
      { title: string; createdAt: string }
    >();
    for (const run of runs) {
      if (!sessionEntries.has(run.sessionId))
        sessionEntries.set(run.sessionId, {
          title: run.prompt,
          createdAt: run.createdAt,
        });
    }
    return {
      runtime,
      model,
      draft: "",
      empty: messages.length === 0,
      running: Boolean(activeRun.current),
      history: [...sessionEntries.entries()]
        .slice(0, 20)
        .map(([id, entry]) => ({
          title: entry.title.slice(0, 34),
          action: `session:${id}`,
          createdAt: entry.createdAt,
        })),
      capabilities,
      messages: messages.map((message) => {
        const trace = traceView(message.events ?? []);
        const status = message.status ?? "completed";
        return {
          ...message,
          label: message.role === "user" ? "You" : "Synlet",
          tone:
            message.role === "user"
              ? "dark"
              : status === "failed"
                ? "danger"
                : "success",
          hasTrace: trace.length > 0,
          trace,
          traceStatus: status === "running" ? "LIVE" : status.toUpperCase(),
          traceTone:
            status === "failed"
              ? "danger"
              : status === "running"
                ? "warning"
                : "success",
          traceSummary: `${trace.length} routed nodes`,
        };
      }),
    };
  }, [capabilities, messages, model, runs, runtime]);

  return <AgentHarness data={{ view }} onAction={onAction} />;
}

const target = document.querySelector("#root");
if (!target) throw new Error("Missing #root");
createRoot(target).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
