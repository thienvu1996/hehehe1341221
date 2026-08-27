const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const DEFAULT_EVENT_LOCATION = "TP Hồ Chí Minh, Việt Nam";

function normalizeLiveText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, values = []) {
  return values.some((value) => text.includes(value));
}

function isSportsLiveQuestion(text = "") {
  const normalized = normalizeLiveText(text);
  if (!normalized) return false;

  const sportsSignals = [
    "bong da",
    "lich thi dau",
    "lich da",
    "tran dau",
    "tran nao",
    "doi tuyen",
    "viet nam da",
    "vn da",
    "da voi ai",
    "may gio da",
    "dang da",
    "sap da",
    "u23",
    "u22",
    "u20",
    "u19",
    "u17",
    "nu viet nam",
    "futsal",
    "v-league",
    "v league",
    "aff cup",
    "asean cup",
    "asian cup",
    "sea games",
    "world cup",
    "ket qua bong da"
  ];

  return hasAny(normalized, sportsSignals) || /\bvn\s+da\b/.test(normalized);
}

function isEventLiveQuestion(text = "") {
  const normalized = normalizeLiveText(text);
  if (!normalized) return false;

  const eventSignals = [
    "su kien",
    "event",
    "concert",
    "show nao",
    "le hoi",
    "hoi cho",
    "trien lam",
    "co gi choi",
    "di dau choi",
    "toi nay co gi",
    "dem nay co gi",
    "hom nay co gi",
    "cuoi tuan co gi"
  ];

  return hasAny(normalized, eventSignals) || /(^|\s)sk($|\s|[?!.;,])/.test(normalized);
}

function isGeneralRealtimeQuestion(text = "") {
  const normalized = normalizeLiveText(text);
  if (!normalized) return false;

  const realtimeSignals = [
    "moi nhat",
    "tin moi",
    "hien tai",
    "bay gio",
    "luc nay",
    "dang dien ra",
    "sap dien ra",
    "toi nay",
    "dem nay",
    "hom nay",
    "ngay mai",
    "cuoi tuan nay",
    "gia vang",
    "ty gia",
    "ket qua hom nay"
  ];

  const infoSignals = [
    "co gi",
    "su kien",
    "lich",
    "thi dau",
    "tran",
    "gia",
    "tin",
    "ket qua",
    "may gio",
    "o dau",
    "choi gi"
  ];

  return hasAny(normalized, realtimeSignals) && hasAny(normalized, infoSignals);
}

function isLiveIntelQuestion(text = "") {
  return isSportsLiveQuestion(text) || isEventLiveQuestion(text) || isGeneralRealtimeQuestion(text);
}

function formatVietnamNow(now = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: DEFAULT_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
}

function expandLiveQuery(text = "", env = {}, now = new Date()) {
  let expanded = String(text || "").trim();
  const normalized = normalizeLiveText(expanded);
  const sports = isSportsLiveQuestion(expanded);
  const events = isEventLiveQuestion(expanded);

  expanded = expanded.replace(/(^|\s)sk(?=$|\s|[?!.;,])/gi, "$1sự kiện");
  if (sports) {
    expanded = expanded.replace(/\bvn\b/gi, "Việt Nam");
  }

  const location = String(env.DEFAULT_EVENT_LOCATION || env.DEFAULT_WEATHER_LOCATION || DEFAULT_EVENT_LOCATION).trim();
  const lines = [
    expanded,
    `Thời điểm cần kiểm tra theo giờ Việt Nam (${DEFAULT_TIMEZONE}): ${formatVietnamNow(now)}.`
  ];

  if (sports) {
    lines.push("Nếu câu hỏi nói 'Việt Nam đá/VN đá', hãy kiểm tra lịch thi đấu thực tế của các đội tuyển bóng đá Việt Nam phù hợp (ĐTQG, U23/U22, nữ, futsal...) và chỉ nêu trận đã được nguồn mới xác nhận.");
  }
  if (events && !/(ha noi|hanoi|ho chi minh|hcm|sai gon|da nang|can tho|hai phong)/i.test(normalized)) {
    lines.push(`Nếu người dùng không ghi địa điểm, ưu tiên sự kiện tại ${location}.`);
  }

  return lines.join("\n");
}

function hasExplicitMention(message = {}) {
  const text = String(message?.text || message?.caption || "");
  if (text.includes("@")) return true;
  const mentions = message?.mentions || message?.mention || message?.entities;
  return Array.isArray(mentions) ? mentions.length > 0 : Boolean(mentions);
}

function isPrivateChat(message = {}) {
  return normalizeLiveText(message?.chat?.chat_type || "").includes("private");
}

function shouldHandleLiveMessage(message = {}, text = "") {
  if (!isLiveIntelQuestion(text)) return false;
  return isPrivateChat(message) || hasExplicitMention(message);
}

export {
  DEFAULT_EVENT_LOCATION,
  DEFAULT_TIMEZONE,
  expandLiveQuery,
  formatVietnamNow,
  hasExplicitMention,
  isEventLiveQuestion,
  isGeneralRealtimeQuestion,
  isLiveIntelQuestion,
  isPrivateChat,
  isSportsLiveQuestion,
  normalizeLiveText,
  shouldHandleLiveMessage
};
