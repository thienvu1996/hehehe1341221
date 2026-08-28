"use client";

import { Camera, Check, Film, ImagePlus, Loader2, Plus, RefreshCw, Sparkles, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const ANGLES = [
  ["front", "Chính diện"],
  ["left_45", "Trái 45°"],
  ["right_45", "Phải 45°"],
  ["left_profile", "Nghiêng trái"],
  ["right_profile", "Nghiêng phải"],
  ["back", "Phía sau"],
  ["full_body_front", "Toàn thân trước"],
  ["full_body_back", "Toàn thân sau"],
  ["closeup", "Cận mặt"],
  ["other", "Khác"]
] as const;

const card: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.18)",
  borderRadius: 16,
  background: "rgba(8,18,25,.78)",
  padding: 18
};

const input: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,.22)",
  background: "rgba(3,12,18,.8)",
  color: "#e5eef5",
  padding: "10px 12px",
  outline: "none"
};

const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,.22)",
  padding: "9px 12px",
  background: "rgba(15,33,42,.9)",
  color: "#e5eef5",
  cursor: "pointer",
  fontWeight: 700
};

type RefImage = {
  id: string;
  angle_type: string;
  title: string;
  file_url: string;
  is_cover: number;
  is_image_seed: number;
  is_video_seed: number;
};

type Character = {
  id: string;
  connection_id: string;
  name: string;
  description: string;
  gender: string;
  age_range: string;
  style_tags: string;
  base_prompt: string;
  negative_prompt: string;
  seed: string;
  source_model: string;
  is_default: number;
  is_active: number;
  images: RefImage[];
};

type Generation = {
  id: string;
  media_type: string;
  model: string;
  status: string;
  output_url: string;
  prompt: string;
  created_at: string;
};

function sessionToken() {
  return typeof window === "undefined" ? "" : sessionStorage.getItem("dashboardSession") || "";
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-Dashboard-Token": sessionToken(),
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || `HTTP ${response.status}`);
  return data;
}

export function CharacterManager() {
  const [connectionId, setConnectionId] = useState("main");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [r2Ready, setR2Ready] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [prompt, setPrompt] = useState("");
  const [imageDraft, setImageDraft] = useState({ url: "", angle: "front", title: "" });
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    gender: "",
    age_range: "",
    style_tags: "",
    base_prompt: "",
    negative_prompt: "",
    seed: "",
    source_model: ""
  });

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("connection_id") || "main";
    setConnectionId(id);
  }, []);

  const selected = useMemo(() => characters.find((row) => row.id === selectedId) || characters[0] || null, [characters, selectedId]);

  async function load() {
    if (!sessionToken()) return;
    setBusy(true);
    try {
      const [chars, gens] = await Promise.all([
        api(`/admin/characters?connection_id=${encodeURIComponent(connectionId)}`),
        api(`/admin/media-generations?connection_id=${encodeURIComponent(connectionId)}`).catch(() => ({ generations: [] }))
      ]);
      setCharacters(chars.characters || []);
      setR2Ready(Boolean(chars.r2_ready));
      setGenerations(gens.generations || []);
      if (!selectedId && chars.characters?.[0]?.id) setSelectedId(chars.characters[0].id);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tải được dữ liệu");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [connectionId]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name || "",
      description: selected.description || "",
      gender: selected.gender || "",
      age_range: selected.age_range || "",
      style_tags: selected.style_tags || "",
      base_prompt: selected.base_prompt || "",
      negative_prompt: selected.negative_prompt || "",
      seed: selected.seed || "",
      source_model: selected.source_model || ""
    });
  }, [selected?.id]);

  async function createCharacter() {
    setBusy(true);
    try {
      const data = await api(`/admin/characters?connection_id=${encodeURIComponent(connectionId)}`, {
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId, name: `Nhân vật ${characters.length + 1}`, is_active: 1, is_default: characters.length === 0 ? 1 : 0 })
      });
      await load();
      setSelectedId(data.character.id);
      setStatus("Đã tạo nhân vật mẫu.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tạo được nhân vật");
    } finally {
      setBusy(false);
    }
  }

  async function saveCharacter(extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/admin/characters/${selected.id}?connection_id=${encodeURIComponent(connectionId)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, ...extra })
      });
      await load();
      setStatus("Đã lưu nhận diện nhân vật.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCharacter() {
    if (!selected || !window.confirm(`Xóa nhân vật ${selected.name}?`)) return;
    setBusy(true);
    try {
      await api(`/admin/characters/${selected.id}?connection_id=${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      setSelectedId("");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không xóa được");
    } finally {
      setBusy(false);
    }
  }

  async function addImageUrl() {
    if (!selected || !imageDraft.url.trim()) return;
    setBusy(true);
    try {
      await api(`/admin/characters/${selected.id}/images?connection_id=${encodeURIComponent(connectionId)}`, {
        method: "POST",
        body: JSON.stringify({ file_url: imageDraft.url.trim(), angle_type: imageDraft.angle, title: imageDraft.title, is_image_seed: 1, is_video_seed: 1 })
      });
      setImageDraft({ url: "", angle: imageDraft.angle, title: "" });
      await load();
      setStatus("Đã thêm ảnh tham chiếu.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thêm được ảnh");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File | null) {
    if (!selected || !file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("angle_type", imageDraft.angle);
    form.set("title", imageDraft.title || file.name);
    setBusy(true);
    try {
      await api(`/admin/characters/${selected.id}/images?connection_id=${encodeURIComponent(connectionId)}`, { method: "POST", body: form });
      await load();
      setStatus("Đã upload ảnh lên R2.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không upload được ảnh");
    } finally {
      setBusy(false);
    }
  }

  async function deleteImage(image: RefImage) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/admin/characters/${selected.id}/images/${image.id}?connection_id=${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không xóa được ảnh");
    } finally {
      setBusy(false);
    }
  }

  async function generate(type: "image" | "video") {
    if (!selected || !prompt.trim()) return;
    setBusy(true);
    setStatus(type === "video" ? "Đang gửi model tạo video..." : "Đang gửi model tạo ảnh...");
    try {
      const data = await api(`/admin/media-generate?connection_id=${encodeURIComponent(connectionId)}`, {
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId, character_id: selected.id, type, prompt: prompt.trim() })
      });
      setStatus(data.output_url ? `Đã tạo ${type === "video" ? "video" : "ảnh"}.` : `Đã gửi job ${data.provider_job_id || ""}.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tạo được media");
    } finally {
      setBusy(false);
    }
  }

  const coveredAngles = new Set((selected?.images || []).map((row) => row.angle_type));

  return (
    <main style={{ maxWidth: 1220, margin: "0 auto", padding: "26px 18px 60px", color: "#e5eef5" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ color: "#5ee6a8", fontSize: 12, fontWeight: 800, letterSpacing: ".08em" }}>IDENTITY PACK</div>
          <h1 style={{ margin: "5px 0 4px", fontSize: 30 }}>Nhân vật mẫu · Ảnh 360</h1>
          <div style={{ color: "#91a8b5", fontSize: 14 }}>Một bộ mặt/nhân vật dùng lại cho gen ảnh và gen video của từng bot.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={button} onClick={() => void load()} disabled={busy}><RefreshCw size={16} /> Nạp lại</button>
          <button style={{ ...button, background: "rgba(16,100,76,.65)" }} onClick={() => void createCharacter()} disabled={busy}><Plus size={16} /> Tạo nhân vật</button>
        </div>
      </div>

      {status ? <div style={{ ...card, marginBottom: 14, padding: 12, color: status.includes("Đã") ? "#7ff0bd" : "#e6c27a" }}>{status}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(230px,.72fr) minmax(0,2.2fr)", gap: 16 }}>
        <aside style={card}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Nhân vật của bot</div>
          <div style={{ display: "grid", gap: 8 }}>
            {characters.map((row) => (
              <button key={row.id} onClick={() => setSelectedId(row.id)} style={{ ...button, justifyContent: "flex-start", width: "100%", background: selected?.id === row.id ? "rgba(29,78,96,.8)" : "rgba(9,25,33,.7)" }}>
                <UserRound size={16} />
                <span style={{ textAlign: "left", minWidth: 0 }}><strong>{row.name}</strong><br /><small style={{ color: "#8ea6b2" }}>{row.images?.length || 0} ảnh {row.is_default ? "· mặc định" : ""}</small></span>
              </button>
            ))}
            {!characters.length ? <div style={{ color: "#8ea6b2", fontSize: 13 }}>Chưa có nhân vật. Bấm “Tạo nhân vật”.</div> : null}
          </div>
        </aside>

        <section style={{ display: "grid", gap: 16 }}>
          {selected ? (
            <>
              <div style={card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
                  <div><div style={{ color: "#8ea6b2", fontSize: 12 }}>Nhận diện cố định</div><h2 style={{ margin: "3px 0 0" }}>{selected.name}</h2></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!selected.is_default ? <button style={button} onClick={() => void saveCharacter({ is_default: 1 })}><Check size={15} /> Đặt mặc định</button> : <span style={{ ...button, cursor: "default", color: "#74efb0" }}><Check size={15} /> Mặc định</span>}
                    <button style={{ ...button, color: "#f3a3a3" }} onClick={() => void deleteCharacter()}><Trash2 size={15} /> Xóa</button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>Tên<input style={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                  <label>Giới tính / dạng người<input style={input} value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })} placeholder="Nữ, nam, trung tính..." /></label>
                  <label>Độ tuổi / vai diễn<input style={input} value={draft.age_range} onChange={(e) => setDraft({ ...draft, age_range: e.target.value })} placeholder="24-28, trợ lý, người mẫu..." /></label>
                  <label>Model tạo bộ gốc<input style={input} value={draft.source_model} onChange={(e) => setDraft({ ...draft, source_model: e.target.value })} placeholder="grok-imagine-image..." /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Mô tả<textarea style={{ ...input, minHeight: 70 }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Prompt nhận diện gốc<textarea style={{ ...input, minHeight: 90 }} value={draft.base_prompt} onChange={(e) => setDraft({ ...draft, base_prompt: e.target.value })} placeholder="Các nét cố định của khuôn mặt, tóc, vóc dáng..." /></label>
                  <label>Tag phong cách<input style={input} value={draft.style_tags} onChange={(e) => setDraft({ ...draft, style_tags: e.target.value })} placeholder="fashion, office, long-hair..." /></label>
                  <label>Seed<input style={input} value={draft.seed} onChange={(e) => setDraft({ ...draft, seed: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Negative prompt<textarea style={{ ...input, minHeight: 60 }} value={draft.negative_prompt} onChange={(e) => setDraft({ ...draft, negative_prompt: e.target.value })} /></label>
                </div>
                <button style={{ ...button, marginTop: 12, background: "rgba(16,100,76,.65)" }} onClick={() => void saveCharacter()} disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />} Lưu nhân vật</button>
              </div>

              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div><div style={{ color: "#8ea6b2", fontSize: 12 }}>Bộ góc tham chiếu</div><h2 style={{ margin: "3px 0" }}>Ảnh 360 · {selected.images?.length || 0} ảnh</h2></div>
                  <div style={{ color: r2Ready ? "#72efb0" : "#e6c27a", fontSize: 12 }}>{r2Ready ? "R2 upload: sẵn sàng" : "R2 chưa gắn: hiện dùng URL ảnh"}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 14px" }}>
                  {ANGLES.slice(0, 9).map(([key, label]) => <span key={key} style={{ padding: "5px 8px", borderRadius: 999, fontSize: 11, background: coveredAngles.has(key) ? "rgba(18,110,78,.4)" : "rgba(80,92,105,.22)", color: coveredAngles.has(key) ? "#7bf2ba" : "#8298a4" }}>{coveredAngles.has(key) ? "✓ " : ""}{label}</span>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0,1fr) 160px auto", gap: 8 }}>
                  <select style={input} value={imageDraft.angle} onChange={(e) => setImageDraft({ ...imageDraft, angle: e.target.value })}>{ANGLES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                  <input style={input} value={imageDraft.url} onChange={(e) => setImageDraft({ ...imageDraft, url: e.target.value })} placeholder="https://.../anh-mau.jpg" />
                  <input style={input} value={imageDraft.title} onChange={(e) => setImageDraft({ ...imageDraft, title: e.target.value })} placeholder="Tên ảnh" />
                  <button style={button} onClick={() => void addImageUrl()}><ImagePlus size={16} /> Thêm URL</button>
                </div>
                {r2Ready ? <label style={{ ...button, marginTop: 9, width: "fit-content" }}><Camera size={16} /> Upload ảnh<input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void uploadFile(e.target.files?.[0] || null)} /></label> : null}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginTop: 14 }}>
                  {selected.images?.map((img) => (
                    <div key={img.id} style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, overflow: "hidden", background: "rgba(3,12,18,.7)" }}>
                      <a href={img.file_url} target="_blank" rel="noreferrer"><img src={img.file_url} alt={img.title || img.angle_type} style={{ width: "100%", height: 170, objectFit: "cover", display: "block" }} /></a>
                      <div style={{ padding: 9 }}><strong style={{ fontSize: 12 }}>{ANGLES.find(([key]) => key === img.angle_type)?.[1] || img.angle_type}</strong><div style={{ color: "#849ba6", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{img.title || img.id}</div><button style={{ ...button, padding: "5px 8px", marginTop: 7, color: "#f3a3a3" }} onClick={() => void deleteImage(img)}><Trash2 size={13} /> Xóa</button></div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={{ color: "#8ea6b2", fontSize: 12 }}>Test bằng đúng identity pack</div>
                <h2 style={{ margin: "3px 0 12px" }}>Gen ảnh / video</h2>
                <textarea style={{ ...input, minHeight: 90 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="VD: mặc váy đen, đứng trong quán cafe, nhìn vào máy ảnh..." />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button style={{ ...button, background: "rgba(63,72,160,.55)" }} disabled={busy || !prompt.trim()} onClick={() => void generate("image")}><Sparkles size={16} /> Tạo ảnh</button>
                  <button style={{ ...button, background: "rgba(118,62,137,.55)" }} disabled={busy || !prompt.trim()} onClick={() => void generate("video")}><Film size={16} /> Tạo video</button>
                </div>
                {generations.length ? <div style={{ marginTop: 14, display: "grid", gap: 7 }}>{generations.slice(0, 8).map((gen) => <div key={gen.id} style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1fr) 120px", gap: 8, padding: 9, borderRadius: 9, background: "rgba(3,12,18,.55)", fontSize: 12 }}><span>{gen.media_type}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gen.prompt}</span>{gen.output_url ? <a style={{ color: "#75d7ff" }} href={gen.output_url} target="_blank" rel="noreferrer">Mở kết quả</a> : <span style={{ color: "#9aabb4" }}>{gen.status}</span>}</div>)}</div> : null}
              </div>
            </>
          ) : <div style={card}>Tạo một nhân vật để bắt đầu lưu bộ ảnh 360.</div>}
        </section>
      </div>
    </main>
  );
}
