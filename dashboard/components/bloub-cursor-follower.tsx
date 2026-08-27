"use client";

import { useEffect, useRef, useState } from "react";
import { BloubMark } from "./bloub-mark";

export function BloubCursorFollower() {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef({ x: -100, y: -100 });
  const currentRef = useRef({ x: -100, y: -100 });
  const frameRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncEnabled = () => setEnabled(finePointer.matches && !reducedMotion.matches);
    syncEnabled();
    finePointer.addEventListener("change", syncEnabled);
    reducedMotion.addEventListener("change", syncEnabled);

    return () => {
      finePointer.removeEventListener("change", syncEnabled);
      reducedMotion.removeEventListener("change", syncEnabled);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }

    const animate = () => {
      const current = currentRef.current;
      const target = targetRef.current;
      current.x += (target.x - current.x) * 0.2;
      current.y += (target.y - current.y) * 0.2;

      if (nodeRef.current) {
        nodeRef.current.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) translate(-50%, -50%) scale(${interactive ? 1.12 : 1})`;
      }
      frameRef.current = requestAnimationFrame(animate);
    };

    const onPointerMove = (event: PointerEvent) => {
      targetRef.current = { x: event.clientX + 18, y: event.clientY + 18 };
      if (!visible) {
        currentRef.current = { x: event.clientX + 18, y: event.clientY + 18 };
        setVisible(true);
      }

      const element = event.target instanceof Element ? event.target : null;
      setInteractive(Boolean(element?.closest("button, a, input, select, textarea, [role='button']")));
    };

    const onPointerLeave = () => setVisible(false);
    const onPointerEnter = () => setVisible(true);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    document.documentElement.addEventListener("mouseenter", onPointerEnter);
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      document.documentElement.removeEventListener("mouseenter", onPointerEnter);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [enabled, interactive, visible]);

  if (!enabled) return null;

  return (
    <div
      ref={nodeRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 9999,
        width: 34,
        height: 34,
        pointerEvents: "none",
        opacity: visible ? 0.9 : 0,
        transition: "opacity 140ms ease, filter 140ms ease",
        filter: interactive ? "drop-shadow(0 0 10px rgba(52,211,153,.55))" : "drop-shadow(0 5px 12px rgba(0,0,0,.28))",
        willChange: "transform, opacity"
      }}
    >
      <div style={{ width: 34, height: 34, transform: "scale(.62)", transformOrigin: "top left" }}>
        <BloubMark tone="active" />
      </div>
    </div>
  );
}
