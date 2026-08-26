"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function ImageLightboxBridge() {
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.closest(".image-item")) return;
      if (!target.src) return;
      event.preventDefault();
      setImage({ src: target.src, alt: target.alt || "Ảnh Zalo" });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImage(null);
    };

    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh phóng to"
      onClick={() => setImage(null)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(2, 6, 23, .88)",
        backdropFilter: "blur(10px)"
      }}
    >
      <button
        type="button"
        aria-label="Đóng ảnh"
        onClick={() => setImage(null)}
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          width: 42,
          height: 42,
          display: "grid",
          placeItems: "center",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,.22)",
          background: "rgba(15,23,42,.9)",
          color: "white",
          cursor: "pointer"
        }}
      >
        <X size={22} />
      </button>
      <img
        src={image.src}
        alt={image.alt}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: "block",
          maxWidth: "min(96vw, 1500px)",
          maxHeight: "90vh",
          objectFit: "contain",
          borderRadius: 14,
          boxShadow: "0 30px 90px rgba(0,0,0,.5)"
        }}
      />
    </div>
  );
}
