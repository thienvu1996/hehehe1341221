"use client";

import {
  AlertCircle,
  BellRing,
  Bot,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
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

const PRIMARY_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || "https://bot.jean1331.io.vn";
const FALLBACK_API_URL = "https://hehehe1341221.vuthien616.workers.dev";
const API_URLS = Array.from(new Set([PRIMARY_API_URL, FALLBACK_API_URL].filter(Boolean)));
const PAGE_SIZE = 10;

async function fetchBotApi(path: string, init: RequestInit = {}) {
  let lastError: unknown;

  for (const baseUrl of API_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        mode: "cors",
        cache: init.cache || "no-store"
      });

      return { response, apiUrl: baseUrl };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Không gọi được API bot.");
}

function formatDashboardError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (/failed to fetch|network request failed|load failed/i.test(error.message)) {
    return `Không gọi được API bot. Dashboard đã thử ${API_URLS.join(" và ")}. Hãy tải lại trang bằng Ctrl+F5 rồi nhập key lại.`;
  }

  if (error.message === "Unauthorized" || error.message === "Session expired") {
    return "Key hết hạn hoặc không đúng.";
  }

  return error.message;
}

type MessageRow = {
  id: number;
  chat_id: string;
  chat_type: string;
  user_name: string;
  text: string;
  message_date?: number | null;
  metadata?: Record<string, unknown>;
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
  metadata?: Record<string, unknown>;
  updated_at: string;
};

type SearchRow = {
  id: number;
  user_name: string;
  query: string;
  answer: string;
  sources?: Array<{ title: string; url: string }>;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type ImageRow = {
  id: number;
  user_name: string;
  photo_url: string;
  caption: string;
  analysis: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type AiUsageRow = {
  id: number;
  provider: string;
  model: string;
  feature: string;
  chat_id: string;
  chat_type: string;
  user_name: string;
  ok: number;
  http_status?: number | null;
  error_code: string;
  error_message: string;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type ChatSettingRow = {
  chat_id: string;
  chat_type: string;
  chat_title: string;
  user_name: string;
  weather_enabled: number;
  weather_time: string;
  weather_location: string;
  timezone: string;
  last_weather_sent_date?: string | null;
  updated_at: string;
};

type ReminderRow = {
  id: string;
  chat_id: string;
  chat_type: string;
  chat_title: string;
  user_name: string;
  title: string;
  due_at_utc: string;
  due_local_date: string;
  due_local_time: string;
  timezone: string;
  status: string;
  sent_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
};

type BotProfile = {
  display_name: string;
  gender: string;
  age: string;
  speaking_style: string;
  persona: string;
  default_language: string;
  updated_at?: string;
};

type DashboardData = {
  ok: boolean;
  generated_at: string;
  profile: BotProfile;
  counts: {
    messages: number;
    links: number;
    searches: number;
    images: number;
    ai_usage: number;
    chat_settings: number;
    reminders: number;
  };
  ai_usage?: {
    stats: {
      calls_total: number;
      calls_ok: number;
      calls_error: number;
      quota_errors: number;
      prompt_tokens: number;
      output_tokens: number;
      total_tokens: number;
      calls_24h: number;
      errors_24h: number;
      tokens_24h: number;
    };
    recent: AiUsageRow[];
  };
  recent: {
    messages: MessageRow[];
    links: LinkRow[];
    searches: SearchRow[];
    images: ImageRow[];
    chat_settings: ChatSettingRow[];
    reminders: ReminderRow[];
  };
};

type TabKey = "links" | "searches" | "images" | "messages" | "schedules" | "profile" | "ai";

const tabs: Array<{ key: TabKey; label: string; icon: typeof Link2 }> = [
  { key: "links", label: "Link nha", icon: Link2 },
  { key: "searches", label: "Cau hoi", icon: Search },
  { key: "images", label: "Anh", icon: ImageIcon },
  { key: "messages", label: "Tin nhan", icon: MessageSquareText },
  { key: "schedules", label: "Lich", icon: CalendarClock },
  { key: "profile", label: "Bot", icon: Bot },
  { key: "ai", label: "AI quota", icon: Gauge }
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

function usePagedRows<T>(rows: T[], query: string) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [query, rows.length]);

  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage]
  );

  return {
    page: safePage,
    pageRows,
    totalPages,
    setPage
  };
}

function getMetaLabel(metadata?: Record<string, unknown>) {
  const eventName = typeof metadata?.event_name === "string" ? metadata.event_name : "";
  const message = metadata?.message && typeof metadata.message === "object" ? (metadata.message as Record<string, unknown>) : {};
  const urlCount = typeof message.url_count === "number" ? message.url_count : 0;

  return [eventName, urlCount ? `${urlCount} url` : ""].filter(Boolean).join(" | ");
}

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

function PaginationFooter({
  page,
  totalItems,
  totalPages,
  onPageChange
}: {
  page: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems <= PAGE_SIZE) {
    return null;
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);

  return (
    <div className="pagination-bar">
      <span>
        {start}-{end} / {totalItems} dong
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="page-button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Trang truoc"
        >
          <ChevronLeft size={17} />
        </button>
        <span className="page-count">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          className="page-button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Trang sau"
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}

function TokenGate({
  error,
  isLoading,
  onLogin
}: {
  error: string;
  isLoading: boolean;
  onLogin: (key: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");

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
              void onLogin(clean);
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
          <button type="submit" className="primary-button" disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
            {isLoading ? "Dang mo..." : "Mo dashboard"}
          </button>
          <p className="form-hint">Key chinh chi dung de tao session 30 phut, khong luu dai trong browser.</p>
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
  const { page, pageRows, totalPages, setPage } = usePagedRows(filtered, query);

  if (filtered.length === 0) {
    return <EmptyState icon={Link2} title="Chua co link hop dieu kien" />;
  }

  return (
    <>
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
            {pageRows.map((link) => (
              <tr key={link.id}>
                <td>
                  <div className="table-title">{link.summary || link.title || "Link thue nha"}</div>
                  <div className="meta-line">{getMetaLabel(link.metadata)}</div>
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
      <PaginationFooter page={page} totalItems={filtered.length} totalPages={totalPages} onPageChange={setPage} />
    </>
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
  const { page, pageRows, totalPages, setPage } = usePagedRows(filtered, query);

  if (filtered.length === 0) {
    return <EmptyState icon={Search} title="Chua co cau hoi hop dieu kien" />;
  }

  return (
    <>
      <div className="record-list">
        {pageRows.map((row) => (
          <article className="record-item" key={row.id}>
            <div className="record-head">
              <div>
                <p className="record-kicker">{row.user_name || "Nguoi dung"} hoi</p>
                <h3>{row.query}</h3>
                <div className="meta-line">{getMetaLabel(row.metadata)}</div>
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
      <PaginationFooter page={page} totalItems={filtered.length} totalPages={totalPages} onPageChange={setPage} />
    </>
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
  const { page, pageRows, totalPages, setPage } = usePagedRows(filtered, query);

  if (filtered.length === 0) {
    return <EmptyState icon={Camera} title="Chua co anh hop dieu kien" />;
  }

  return (
    <>
      <div className="image-grid">
        {pageRows.map((row) => (
          <article className="image-item" key={row.id}>
            <img src={row.photo_url} alt={row.caption || "Anh tu Zalo"} loading="lazy" />
            <div>
              <p className="record-kicker">{row.user_name || "Nguoi dung"} gui anh</p>
              <h3>{row.caption || "Khong co caption"}</h3>
              <div className="meta-line">{getMetaLabel(row.metadata)}</div>
              <p>{row.analysis || "Chua co phan tich."}</p>
              <time>{formatDate(row.created_at)}</time>
            </div>
          </article>
        ))}
      </div>
      <PaginationFooter page={page} totalItems={filtered.length} totalPages={totalPages} onPageChange={setPage} />
    </>
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
  const { page, pageRows, totalPages, setPage } = usePagedRows(filtered, query);

  if (filtered.length === 0) {
    return <EmptyState icon={MessageSquareText} title="Chua co tin nhan hop dieu kien" />;
  }

  return (
    <>
      <div className="message-list">
        {pageRows.map((row) => (
          <article className="message-item" key={row.id}>
            <div className="message-avatar">
              <Bot size={17} />
            </div>
            <div>
              <div className="message-meta">
                <strong>{row.user_name || "Nguoi dung"}</strong>
                <span>{formatDate(row.created_at || row.message_date)}</span>
              </div>
              <div className="meta-line">{getMetaLabel(row.metadata)}</div>
              <p>{row.text || "Tin nhan khong co text"}</p>
            </div>
          </article>
        ))}
      </div>
      <PaginationFooter page={page} totalItems={filtered.length} totalPages={totalPages} onPageChange={setPage} />
    </>
  );
}

function getChatLabel(chatTitle?: string, chatId?: string) {
  if (chatTitle) {
    return chatTitle;
  }

  if (!chatId) {
    return "Chua ro chat";
  }

  return `Chat ${chatId.slice(0, 8)}...`;
}

function formatLocalScheduleDate(value?: string | null) {
  if (!value) {
    return "Chua gui";
  }

  const parts = value.split("-");

  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  return value;
}

function SchedulePanel({
  settings,
  reminders,
  query
}: {
  settings: ChatSettingRow[];
  reminders: ReminderRow[];
  query: string;
}) {
  const filteredSettings = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return settings;
    }

    return settings.filter((row) =>
      normalize(`${row.chat_title} ${row.chat_type} ${row.user_name} ${row.weather_location} ${row.weather_time}`).includes(needle)
    );
  }, [settings, query]);
  const filteredReminders = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return reminders;
    }

    return reminders.filter((row) =>
      normalize(`${row.chat_title} ${row.chat_type} ${row.user_name} ${row.title} ${row.status}`).includes(needle)
    );
  }, [reminders, query]);
  const settingsPage = usePagedRows(filteredSettings, query);
  const remindersPage = usePagedRows(filteredReminders, query);

  return (
    <div className="schedule-panel">
      <section className="schedule-section">
        <div className="section-head">
          <div>
            <p className="record-kicker">Daily weather</p>
            <h2>Lich thoi tiet</h2>
          </div>
          <span className="count-chip">{filteredSettings.length} cau hinh</span>
        </div>
        {filteredSettings.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Chua co lich thoi tiet hop dieu kien" />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Chat/group</th>
                    <th>Trang thai</th>
                    <th>Gio gui</th>
                    <th>Dia diem</th>
                    <th>Lan gui cuoi</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsPage.pageRows.map((row) => (
                    <tr key={row.chat_id}>
                      <td>
                        <div className="table-title">{getChatLabel(row.chat_title, row.chat_id)}</div>
                        <span className="muted">{row.chat_type || "CHAT"}</span>
                      </td>
                      <td>
                        <span className={`status-pill ${row.weather_enabled ? "status-ok" : "status-error"}`}>
                          {row.weather_enabled ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          {row.weather_enabled ? "bat" : "tat"}
                        </span>
                      </td>
                      <td>{row.weather_time || "06:00"}</td>
                      <td>{row.weather_location || "TP Ho Chi Minh"}</td>
                      <td>
                        <div>{formatLocalScheduleDate(row.last_weather_sent_date)}</div>
                        <span className="muted">{formatDate(row.updated_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationFooter
              page={settingsPage.page}
              totalItems={filteredSettings.length}
              totalPages={settingsPage.totalPages}
              onPageChange={settingsPage.setPage}
            />
          </>
        )}
      </section>

      <section className="schedule-section">
        <div className="section-head">
          <div>
            <p className="record-kicker">One-time reminders</p>
            <h2>Lich nhac viec</h2>
          </div>
          <span className="count-chip">{filteredReminders.length} lich</span>
        </div>
        {filteredReminders.length === 0 ? (
          <EmptyState icon={BellRing} title="Chua co lich nhac viec" />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Viec</th>
                    <th>Chat/group</th>
                    <th>Trang thai</th>
                    <th>Thoi gian</th>
                    <th>Tao luc</th>
                  </tr>
                </thead>
                <tbody>
                  {remindersPage.pageRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="table-title">{row.title || "Viec da hen"}</div>
                        <span className="muted">{row.user_name || "Nguoi dung"}</span>
                      </td>
                      <td>
                        <div>{getChatLabel(row.chat_title, row.chat_id)}</div>
                        <span className="muted">{row.chat_type || "CHAT"}</span>
                      </td>
                      <td>
                        <span className={`status-pill ${row.status === "pending" ? "status-ok" : "status-muted"}`}>
                          {row.status === "pending" ? <BellRing size={14} /> : <CheckCircle2 size={14} />}
                          {row.status || "pending"}
                        </span>
                      </td>
                      <td>
                        <div>
                          {row.due_local_time || "??:??"} {formatLocalScheduleDate(row.due_local_date)}
                        </div>
                        <span className="muted">{row.timezone || "Asia/Ho_Chi_Minh"}</span>
                      </td>
                      <td>{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationFooter
              page={remindersPage.page}
              totalItems={filteredReminders.length}
              totalPages={remindersPage.totalPages}
              onPageChange={remindersPage.setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}

function BotProfilePanel({
  profile,
  onSave
}: {
  profile?: BotProfile;
  onSave: (profile: BotProfile) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BotProfile>({
    display_name: "",
    gender: "",
    age: "",
    speaking_style: "",
    persona: "",
    default_language: "vi"
  });
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setDraft({
        display_name: profile.display_name || "",
        gender: profile.gender || "",
        age: profile.age || "",
        speaking_style: profile.speaking_style || "",
        persona: profile.persona || "",
        default_language: profile.default_language || "vi"
      });
    }
  }, [profile]);

  const updateField = (field: keyof BotProfile, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus("");
  };

  return (
    <form
      className="profile-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);
        setStatus("");

        try {
          await onSave(draft);
          setStatus("Đã lưu cấu hình bot.");
        } catch (saveError) {
          setStatus(saveError instanceof Error ? saveError.message : "Không lưu được cấu hình.");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="section-head">
        <div>
          <p className="record-kicker">Bot persona</p>
          <h2>Cau hinh bot</h2>
        </div>
        <span className="count-chip">{profile?.updated_at ? `Cap nhat ${formatDate(profile.updated_at)}` : "Mac dinh"}</span>
      </div>

      <div className="profile-grid">
        <label className="field-block" htmlFor="bot-display-name">
          <span>Tên bot</span>
          <input
            id="bot-display-name"
            value={draft.display_name}
            onChange={(event) => updateField("display_name", event.target.value)}
            placeholder="Bot Thu Thập atess"
            maxLength={80}
          />
        </label>
        <label className="field-block" htmlFor="bot-gender">
          <span>Giới tính / cách xưng hô</span>
          <input
            id="bot-gender"
            value={draft.gender}
            onChange={(event) => updateField("gender", event.target.value)}
            placeholder="nam, nữ, trung tính, xưng mình..."
            maxLength={60}
          />
        </label>
        <label className="field-block" htmlFor="bot-age">
          <span>Độ tuổi / vai diễn</span>
          <input
            id="bot-age"
            value={draft.age}
            onChange={(event) => updateField("age", event.target.value)}
            placeholder="25 tuổi, trợ lý trẻ, anh/chị quản lý..."
            maxLength={40}
          />
        </label>
        <label className="field-block" htmlFor="bot-language">
          <span>Ngôn ngữ mặc định</span>
          <input
            id="bot-language"
            value={draft.default_language}
            onChange={(event) => updateField("default_language", event.target.value)}
            placeholder="vi"
            maxLength={20}
          />
        </label>
      </div>

      <label className="field-block" htmlFor="bot-style">
        <span>Phong cách nói</span>
        <textarea
          id="bot-style"
          value={draft.speaking_style}
          onChange={(event) => updateField("speaking_style", event.target.value)}
          placeholder="Tự nhiên, thân thiện, hỏi lại khi thiếu thông tin..."
          maxLength={500}
          rows={3}
        />
      </label>

      <label className="field-block" htmlFor="bot-persona">
        <span>Tính cách / nhiệm vụ</span>
        <textarea
          id="bot-persona"
          value={draft.persona}
          onChange={(event) => updateField("persona", event.target.value)}
          placeholder="Trợ lý Zalo giúp nhóm lưu link thuê nhà, nhắc lịch, thời tiết..."
          maxLength={900}
          rows={5}
        />
      </label>

      <div className="profile-actions">
        {status ? <span className={status.includes("Đã lưu") ? "save-status ok" : "save-status error"}>{status}</span> : null}
        <button className="primary-button compact" type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
          {isSaving ? "Dang luu..." : "Luu cau hinh"}
        </button>
      </div>
    </form>
  );
}

function AiUsageList({
  usage,
  query,
  stats
}: {
  usage: AiUsageRow[];
  query: string;
  stats?: NonNullable<DashboardData["ai_usage"]>["stats"];
}) {
  const filtered = useMemo(() => {
    const needle = normalize(query);

    if (!needle) {
      return usage;
    }

    return usage.filter((row) =>
      normalize(`${row.model} ${row.feature} ${row.error_code} ${row.error_message} ${row.user_name}`).includes(needle)
    );
  }, [usage, query]);
  const { page, pageRows, totalPages, setPage } = usePagedRows(filtered, query);

  return (
    <div className="ai-panel">
      <div className="quota-note">
        <Gauge size={18} />
        <span>
          Day la usage bot da ghi nhan. Gemini khong tra ve so quota con lai truc tiep, nen loi 429/quota se hien o log.
        </span>
      </div>
      <div className="mini-stats">
        <StatTile label="AI calls 24h" value={stats?.calls_24h ?? 0} icon={Cpu} accent="#38BDF8" />
        <StatTile label="Tokens 24h" value={stats?.tokens_24h ?? 0} icon={Sparkles} accent="#22C55E" />
        <StatTile label="Loi 24h" value={stats?.errors_24h ?? 0} icon={AlertCircle} accent="#F59E0B" />
        <StatTile label="Quota errors" value={stats?.quota_errors ?? 0} icon={Gauge} accent="#EF4444" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Gauge} title="Chua co log AI usage" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Model</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Loi</th>
                <th>Luc</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="table-title">{row.feature || "ai_call"}</div>
                    <div className="meta-line">{row.provider || "gemini"} | {row.chat_type || "CHAT"}</div>
                  </td>
                  <td>{row.model || "unknown"}</td>
                  <td>
                    <span className={`status-pill ${row.ok ? "status-ok" : "status-error"}`}>
                      {row.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {row.ok ? "ok" : row.http_status || "error"}
                    </span>
                  </td>
                  <td>
                    <div>{row.total_tokens || 0}</div>
                    <span className="muted">in {row.prompt_tokens || 0} / out {row.output_tokens || 0}</span>
                  </td>
                  <td>
                    <div className="error-cell">{row.error_code || "-"}</div>
                    {row.error_message ? <span className="muted">{row.error_message}</span> : null}
                  </td>
                  <td>{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter page={page} totalItems={filtered.length} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
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
  const [sessionToken, setSessionToken] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("links");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const login = async (dashboardKey: string) => {
    setIsLoading(true);
    setError("");

    try {
      const { response } = await fetchBotApi("/admin/dashboard-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: dashboardKey }),
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok || !payload.session_token) {
        throw new Error(payload.message || `HTTP ${response.status}`);
      }

      sessionStorage.setItem("dashboardSession", payload.session_token);
      localStorage.removeItem("dashboardToken");
      setSessionToken(payload.session_token);
      await loadData(payload.session_token);
    } catch (loginError) {
      sessionStorage.removeItem("dashboardSession");
      setSessionToken("");
      setData(null);
      setError(formatDashboardError(loginError, "Không mở được dashboard."));
    } finally {
      setIsLoading(false);
    }
  };

  const loadData = async (currentToken = sessionToken) => {
    if (!currentToken) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const { response } = await fetchBotApi("/admin/dashboard-data", {
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
      if (loadError instanceof Error && /session|unauthorized/i.test(loadError.message)) {
        sessionStorage.removeItem("dashboardSession");
        setSessionToken("");
      }

      setData(null);
      setError(formatDashboardError(loadError, "Không tải được dữ liệu."));
    } finally {
      setIsLoading(false);
    }
  };

  const saveProfile = async (profile: BotProfile) => {
    if (!sessionToken) {
      throw new Error("Session đã hết hạn, hãy đăng nhập lại.");
    }

    const { response } = await fetchBotApi("/admin/bot-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Token": sessionToken
      },
      body: JSON.stringify(profile),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `HTTP ${response.status}`);
    }

    setData((current) => (current ? { ...current, profile: payload.profile || profile } : current));
  };

  useEffect(() => {
    localStorage.removeItem("dashboardToken");
    const savedToken = sessionStorage.getItem("dashboardSession") || "";

    if (savedToken) {
      setSessionToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (sessionToken && !data && !isLoading && !error) {
      void loadData(sessionToken);
    }
  }, [sessionToken]);

  if (!sessionToken || (!data && error)) {
    return <TokenGate onLogin={login} isLoading={isLoading} error={error} />;
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
              sessionStorage.removeItem("dashboardSession");
              localStorage.removeItem("dashboardToken");
              setSessionToken("");
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
        <StatTile label="Lich" value={data?.counts.reminders ?? 0} icon={CalendarClock} accent="#FB7185" />
        <StatTile label="AI calls" value={data?.counts.ai_usage ?? 0} icon={Gauge} accent="#A78BFA" />
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
          {data && activeTab === "schedules" ? (
            <SchedulePanel
              settings={data.recent.chat_settings ?? []}
              reminders={data.recent.reminders ?? []}
              query={query}
            />
          ) : null}
          {data && activeTab === "profile" ? <BotProfilePanel profile={data.profile} onSave={saveProfile} /> : null}
          {data && activeTab === "ai" ? (
            <AiUsageList usage={data.ai_usage?.recent ?? []} stats={data.ai_usage?.stats} query={query} />
          ) : null}
        </div>
      </section>
    </main>
  );
}
