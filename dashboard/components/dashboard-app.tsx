"use client";

import {
  AlertCircle,
  Bot,
  Camera,
  CheckCircle2,
  Database,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BloubMark } from "./bloub-mark";

const API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || "https://bot.jean1331.io.vn";

type MessageRow = {
  id: number;
  chat_id: string;
  chat_type: string;
  user_name: string;
  text: string;
  message_date?: number | null;
  created_at: string;
};

type LinkRow = {
  id: number;
  user_name: string;
  url: string;
  source_text: string;
  title: string;
  description: string;
  summary: string;
  price_text: string;
  area_text: string;
  status: string;
  http_status?: number | null;
  updated_at: string;
};

type SearchRow = {
  id: number;
  user_name: string;
  query: string;
  answer: string;
  sources?: Array<{ title: string; url: string }>;
  created_at: string;
};

type ImageRow = {
  id: number;
  user_name: string;
  photo_url: string;
  caption: string;
  analysis: string;
  created_at: string;
};

type DashboardData = {
  ok: boolean;
  generated_at: string;
  counts: {
    messages: number;
    links: number;
    searches: number;
    images: number;
  };
  recent: {
    messages: MessageRow[];
    links: LinkRow[];
    searches: SearchRow[];
    images: ImageRow[];
  };
};

type TabKey = "links" | "searches" | "images" | "messages";

const tabs: Array<{ key: TabKey; label: string; icon: typeof Link2 }> = [
  { key: "links", label: "Link nha", icon: Link2 },
  { key: "searches", label: "Cau hoi", icon: Search },
  { key: "images", label: "Anh", icon: ImageIcon },
  { key: "messages", label: "Tin nhan", icon: MessageSquareText }
];

const formatDate = (value?: string | number | null) => {
  if (!value) {
    return "Chua ro";
  }

  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Chua ro";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(date);
};

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function StatTile({
  label,
  value,
  icon: Icon,
  accent
}: {
  label: string;
  value: number | string;
  icon: typeof Link2;
  accent: string;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-icon" style={{ color: accent }}>
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function TokenGate({
  token,
  setToken,
  error
}: {
  token: string;
  setToken: (token: string) => void;
  error: string;
}) {
  const [draft, setDraft] = useState(token);

  return (
    <main className="gate-shell">
      <section className="gate-panel">
        <BloubMark tone={error ? "alert" : "quiet"} />
        <div className="gate-copy">
          <p className="eyebrow">Private dashboard</p>
          <h1>Zalo Rental Intel</h1>
          <p>Nhap dashboard key de xem du lieu bot da luu tu Zalo.</p>
        </div>
        <form
          className="token-form"
          onSubmit={(event) => {
            event.preventDefault();
            const clean = draft.trim();

            if (clean) {
              localStorage.setItem("dashboardToken", clean);
              setToken(clean);
            }
          }}
        >
          <label htmlFor="dashboard-token">Dashboard key</label>
          <div className="token-row">
            <KeyRound size={18} />
            <input
              id="dashboard-token"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Dan key vao day"
              type="password"
              autoComplete="off"
            />
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="primary-button">
            <ShieldCheck size={18} />
            Mo dashboard
          </button>
        </form>
      </section>
    </main>
  );
}

function LinksTable({ links, query }: { links: LinkRow[]; query: string }) {
  const filtered = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return links;
    }

    return links.filter((link) =>
      normalize([link.title, link.summary, link.price_text, link.area_text, link.source_text, link.url].join(" ")).includes(
        needle
      )
    );
  }, [links, query]);

  if (filtered.length === 0) {
    return <EmptyState icon={Link2} title="Chua co link hop dieu kien" />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Link</th>
            <th>Gia / khu vuc</th>
            <th>Trang thai</th>
            <th>Cap nhat</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((link) => (
            <tr key={link.id}>
              <td>
                <div className="table-title">{link.summary || link.title || "Link thue nha"}</div>
                <a href={link.url} target="_blank" rel="noreferrer" className="external-link">
                  {link.url}
                  <ExternalLink size={14} />
                </a>
              </td>
              <td>
                <div>{link.price_text || "Chua ro gia"}</div>
                <span className="muted">{link.area_text || "Chua ro khu vuc"}</span>
              </td>
              <td>
                <span className={`status-pill ${link.status === "ok" ? "status-ok" : "status-error"}`}>
                  {link.status === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {link.status || "unknown"}
                  {link.http_status ? ` ${link.http_status}` : ""}
                </span>
              </td>
              <td>{formatDate(link.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchList({ searches, query }: { searches: SearchRow[]; query: string }) {
  const filtered = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return searches;
    }

    return searches.filter((row) => normalize(`${row.query} ${row.answer}`).includes(needle));
  }, [searches, query]);

  if (filtered.length === 0) {
    return <EmptyState icon={Search} title="Chua co cau hoi hop dieu kien" />;
  }

  return (
    <div className="record-list">
      {filtered.map((row) => (
        <article className="record-item" key={row.id}>
          <div className="record-head">
            <div>
              <p className="record-kicker">{row.user_name || "Nguoi dung"} hoi</p>
              <h3>{row.query}</h3>
            </div>
            <time>{formatDate(row.created_at)}</time>
          </div>
          <p>{row.answer || "Chua co cau tra loi."}</p>
          {row.sources?.length ? (
            <div className="source-row">
              {row.sources.slice(0, 3).map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                  {source.title || "Nguon"}
                  <ExternalLink size={13} />
                </a>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ImageList({ images, query }: { images: ImageRow[]; query: string }) {
  const filtered = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return images;
    }

    return images.filter((row) => normalize(`${row.caption} ${row.analysis}`).includes(needle));
  }, [images, query]);

  if (filtered.length === 0) {
    return <EmptyState icon={Camera} title="Chua co anh hop dieu kien" />;
  }

  return (
    <div className="image-grid">
      {filtered.map((row) => (
        <article className="image-item" key={row.id}>
          <img src={row.photo_url} alt={row.caption || "Anh tu Zalo"} loading="lazy" />
          <div>
            <p className="record-kicker">{row.user_name || "Nguoi dung"} gui anh</p>
            <h3>{row.caption || "Khong co caption"}</h3>
            <p>{row.analysis || "Chua co phan tich."}</p>
            <time>{formatDate(row.created_at)}</time>
          </div>
        </article>
      ))}
    </div>
  );
}

function MessageList({ messages, query }: { messages: MessageRow[]; query: string }) {
  const filtered = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return messages;
    }

    return messages.filter((row) => normalize(`${row.user_name} ${row.text}`).includes(needle));
  }, [messages, query]);

  if (filtered.length === 0) {
    return <EmptyState icon={MessageSquareText} title="Chua co tin nhan hop dieu kien" />;
  }

  return (
    <div className="message-list">
      {filtered.map((row) => (
        <article className="message-item" key={row.id}>
          <div className="message-avatar">
            <Bot size={17} />
          </div>
          <div>
            <div className="message-meta">
              <strong>{row.user_name || "Nguoi dung"}</strong>
              <span>{formatDate(row.created_at || row.message_date)}</span>
            </div>
            <p>{row.text || "Tin nhan khong co text"}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title }: { icon: typeof Link2; title: string }) {
  return (
    <div className="empty-state">
      <BloubMark tone="quiet" />
      <div>
        <Icon size={20} />
        <p>{title}</p>
      </div>
    </div>
  );
}

export function DashboardApp() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("links");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const loadData = async (currentToken = token) => {
    if (!currentToken) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/admin/dashboard-data`, {
        headers: {
          "X-Dashboard-Token": currentToken
        },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || `HTTP ${response.status}`);
      }

      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Khong tai duoc du lieu");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const savedToken = localStorage.getItem("dashboardToken") || "";

    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (token && !data && !isLoading && !error) {
      void loadData(token);
    }
  }, [token]);

  if (!token || (!data && error)) {
    return <TokenGate token={token} setToken={setToken} error={error === "Unauthorized" ? "Key khong dung." : error} />;
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand-block">
          <BloubMark tone={error ? "alert" : "active"} />
          <div>
            <p className="eyebrow">Zalo Bot Dashboard</p>
            <h1>Rental Intel</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="api-chip">
            <Database size={15} />
            {data ? `Sync ${formatDate(data.generated_at)}` : "Dang tai"}
          </span>
          <button className="ghost-button" onClick={() => loadData()} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
            Nap lai
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              localStorage.removeItem("dashboardToken");
              setToken("");
              setData(null);
            }}
          >
            <KeyRound size={17} />
            Doi key
          </button>
        </div>
      </header>

      <section className="summary-grid" aria-label="Tong quan du lieu Zalo">
        <StatTile label="Tin nhan" value={data?.counts.messages ?? 0} icon={MessageSquareText} accent="#38BDF8" />
        <StatTile label="Link da luu" value={data?.counts.links ?? 0} icon={Link2} accent="#22C55E" />
        <StatTile label="Cau search" value={data?.counts.searches ?? 0} icon={Sparkles} accent="#F59E0B" />
        <StatTile label="Anh da doc" value={data?.counts.images ?? 0} icon={ImageIcon} accent="#F472B6" />
      </section>

      <section className="workbench">
        <div className="control-bar">
          <nav className="tabs" aria-label="Loai du lieu">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  className={activeTab === tab.key ? "tab-button active" : "tab-button"}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <label className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Loc theo gia, khu vuc, nguoi gui..."
            />
          </label>
        </div>

        {error ? (
          <div className="alert-line">
            <AlertCircle size={17} />
            {error}
          </div>
        ) : null}

        <div className="panel-body">
          {isLoading && !data ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              Dang lay du lieu tu Zalo bot...
            </div>
          ) : null}
          {data && activeTab === "links" ? <LinksTable links={data.recent.links} query={query} /> : null}
          {data && activeTab === "searches" ? <SearchList searches={data.recent.searches} query={query} /> : null}
          {data && activeTab === "images" ? <ImageList images={data.recent.images} query={query} /> : null}
          {data && activeTab === "messages" ? <MessageList messages={data.recent.messages} query={query} /> : null}
        </div>
      </section>
    </main>
  );
}
