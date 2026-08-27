"use client";

import { ArrowDown, ArrowUp, Bot, CheckCircle2, Globe2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Connection = {
  id: string;
  display_name: string;
  enabled: number | boolean;
};

type Provider = {
  id: string;
  label: string;
  enabled: number | boolean;
  provider_type?: string;
  base_url?: string;
  source?: string;
  capabilities?: string[];
};

type WebRoute = {
  connection_id: string;
  search_provider_ids: string[];
  answer_provider_ids: string[];
  updated_at?: string;
};

type Draft = {
  search_provider_ids: string[];
  answer_provider_ids: string[];
};

const card: React.CSSProperties = {
  border: "1px solid rgba(56,189,248,.24)",
  borderRadius: 18,
  background: "rgba(15,23,42,.78)",
  padding: 18,
  boxShadow: "0 18px 50px rgba(2,6,23,.25)"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,.3)",
  background: "rgba(2,6,23,.65)",
  color: "#e2e8f0",
  padding: "10px 12px",
  outline: "none"
};

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: "1px solid rgba(148,163,184,.28)",
  borderRadius: 10,
  background: "rgba(30,41,59,.85)",
  color: "#e2e8f0",
  padding: "8px 10px",
  cursor: "pointer"
};

function asBool(value: unknown) {
  return value === true || Number(value) === 1;
}

function providerSupportsSearch(provider: Provider) {
  const capabilities = Array.isArray(provider.capabilities)
    ? provider.capabilities.map((value) => String(value).toLowerCase())
    : [];
  return provider.provider_type === "gemini" ||
    capabilities.includes("search") ||
    capabilities.includes("web_search") ||
    String(provider.base_url || "").toLowerCase().includes("api.x.ai");
}

function routeDraft(route?: WebRoute): Draft {
  return {
    search_provider_ids: Array.isArray(route?.search_provider_ids) ? route!.search_provider_ids : [],
    answer_provider_ids: Array.isArray(route?.answer_provider_ids) ? route!.answer_provider_ids : []
  };
}

export function WebAiRoutingManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [routes, setRoutes] = useState<WebRoute[]>([]);
  const [selected, setSelected] = useState("main");
  const [draft, setDraft] = useState<Draft>({ search_provider_ids: [], answer_provider_ids: [] });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const request = async (path: string, init: RequestInit = {}) => {
    const token = sessionStorage.getItem("dashboardSession") || "";
    const response = await fetch(`/api${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Token": token,
        ...(init.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.message || `HTTP ${response.status}`);
    return payload;
  };

  const load = async () => {
    if (!sessionStorage.getItem("dashboardSession")) return;
    setBusy(true);
    setError("");
    try {
      const [connectionsPayload, routesPayload] = await Promise.all([
        request("/admin/connections"),
        request("/admin/ai-web-routes")
      ]);
      const botRows = (connectionsPayload.zalo_connections || []).filter((row: Connection) => asBool(row.enabled));
      const providerRows = (connectionsPayload.ai_providers || []).filter((row: Provider) => asBool(row.enabled));
      const routeRows = routesPayload.routes || [];
      setConnections(botRows);
      setProviders(providerRows);
      setRoutes(routeRows);
      const nextSelected = botRows.some((row: Connection) => row.id === selected) ? selected : (botRows[0]?.id || "main");
      setSelected(nextSelected);
      setDraft(routeDraft(routeRows.find((row: WebRoute) => row.connection_id === nextSelected)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được định tuyến Web AI.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setDraft(routeDraft(routes.find((row) => row.connection_id === selected)));
  }, [selected, routes]);

  const selectedBot = useMemo(() => connections.find((row) => row.id === selected), [connections, selected]);
  const searchProviders = useMemo(() => providers.filter(providerSupportsSearch), [providers]);

  const toggle = (field: keyof Draft, id: string) => {
    setDraft((current) => {
      const values = current[field];
      return {
        ...current,
        [field]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
      };
    });
  };

  const move = (field: keyof Draft, id: string, delta: number) => {
    setDraft((current) => {
      const values = [...current[field]];
      const index = values.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= values.length) return current;
      [values[index], values[target]] = [values[target], values[index]];
      return { ...current, [field]: values };
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/admin/ai-web-routes", {
        method: "POST",
        body: JSON.stringify({ connection_id: selected, ...draft })
      });
      setNotice(`Đã lưu AI Web cho ${selectedBot?.display_name || selected}.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được định tuyến Web AI.");
    } finally {
      setBusy(false);
    }
  };

  const renderProviderRows = (rows: Provider[], field: keyof Draft, emptyText: string) => {
    if (!rows.length) return <div style={{ color: "#fbbf24", fontSize: 13 }}>{emptyText}</div>;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((provider) => {
          const selectedIndex = draft[field].indexOf(provider.id);
          const checked = selectedIndex >= 0;
          return (
            <div key={`${field}-${provider.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", border: "1px solid rgba(148,163,184,.15)", borderRadius: 11, padding: 10 }}>
              <label style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(field, provider.id)} />
                <span style={{ minWidth: 0 }}>
                  <b>{checked ? `#${selectedIndex + 1} ` : ""}{provider.label || provider.id}</b>
                  <span style={{ color: "#64748b" }}> ({provider.id})</span>
                  <span style={{ display: "block", color: "#94a3b8", fontSize: 11, marginTop: 3 }}>
                    {provider.provider_type || "provider"} · {provider.source || "dashboard"}{providerSupportsSearch(provider) ? " · Web Search ✅" : " · Chat/Answer"}
                  </span>
                </span>
              </label>
              {checked ? (
                <div style={{ display: "flex", gap: 5 }}>
                  <button style={{ ...buttonStyle, padding: 6 }} onClick={() => move(field, provider.id, -1)} disabled={selectedIndex <= 0}><ArrowUp size={14} /></button>
                  <button style={{ ...buttonStyle, padding: 6 }} onClick={() => move(field, provider.id, 1)} disabled={selectedIndex >= draft[field].length - 1}><ArrowDown size={14} /></button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section style={{ ...card, maxWidth: 1180, margin: "0 auto 20px", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#38bdf8", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.1 }}>Per-bot web routing</p>
          <h2 style={{ margin: "6px 0" }}><Globe2 size={20} style={{ verticalAlign: "-4px", marginRight: 7 }} />AI xử lý Web / Realtime theo từng bot</h2>
          <p style={{ margin: 0, color: "#94a3b8" }}>Chọn riêng AI đi tìm dữ liệu Web và AI trả lời cuối. Thứ tự #1 → #2 → #3 là thứ tự ưu tiên/fallback.</p>
        </div>
        <button style={buttonStyle} onClick={() => void load()} disabled={busy}>{busy ? <Loader2 size={16} /> : <RefreshCw size={16} />} Nạp lại</button>
      </div>

      {notice ? <div style={{ marginTop: 12, color: "#86efac" }}>{notice}</div> : null}
      {error ? <div style={{ marginTop: 12, color: "#fca5a5" }}>{error}</div> : null}

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "minmax(220px,300px) 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>Bot cần cấu hình</span>
            <select style={inputStyle} value={selected} onChange={(event) => setSelected(event.target.value)}>
              {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.display_name || connection.id}{connection.id === "main" ? " · Bot chính" : ""}</option>)}
            </select>
          </label>
          <div style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 12, padding: 12, color: "#94a3b8", fontSize: 12, lineHeight: 1.65 }}>
            <Bot size={15} style={{ verticalAlign: "-3px", marginRight: 5 }} />
            Không chọn provider nào = tự động theo Priority chung. Nếu chọn, Worker chỉ thử đúng danh sách đã chọn theo thứ tự.
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ border: "1px solid rgba(56,189,248,.18)", borderRadius: 13, padding: 13 }}>
            <div style={{ marginBottom: 8 }}><b>1. AI Web Search ưu tiên</b></div>
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 0 }}>Chỉ hiện provider có Web Search native. Gemini dùng Google Search; xAI trực tiếp có Web Search. Nexus Grok chỉ chat thì không nằm ở đây.</p>
            {renderProviderRows(searchProviders, "search_provider_ids", "Chưa có provider nào hỗ trợ Web Search. Gemini hoặc xAI direct cần được cấu hình trước.")}
          </div>

          <div style={{ border: "1px solid rgba(167,139,250,.18)", borderRadius: 13, padding: 13 }}>
            <div style={{ marginBottom: 8 }}><b>2. AI trả lời cuối ưu tiên</b></div>
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 0 }}>AI #1 sẽ nhận dữ liệu Web vừa tìm được và trả lời người dùng. Vì vậy bạn có thể để Gemini Search nhưng Grok là AI trả lời #1.</p>
            {renderProviderRows(providers, "answer_provider_ids", "Chưa có AI provider nào đang bật.")}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={{ ...buttonStyle, background: "rgba(2,132,199,.55)" }} onClick={() => void save()} disabled={busy || !selected}>
              {busy ? <Loader2 size={16} /> : <CheckCircle2 size={16} />} Lưu AI Web cho bot này
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
