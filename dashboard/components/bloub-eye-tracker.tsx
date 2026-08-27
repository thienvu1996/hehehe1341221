"use client";

import { useEffect } from "react";

export function BloubEyeTracker() {
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches) return;

    let frame = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;

    const updateEyes = () => {
      frame = 0;
      const blobs = document.querySelectorAll<HTMLElement>(".bloub");

      blobs.forEach((blob) => {
        const rect = blob.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = pointerX - cx;
        const dy = pointerY - cy;
        const distance = Math.hypot(dx, dy) || 1;

        // Clamp movement so the pupils stay inside the mascot face.
        const strength = Math.min(1, distance / 120);
        const eyeX = (dx / distance) * 3.8 * strength;
        const eyeY = (dy / distance) * 2.8 * strength;

        blob.querySelectorAll<HTMLElement>(".bloub-eye").forEach((eye) => {
          // Use the individual CSS translate property so the existing blink
          // animation can continue to own `transform: scaleY(...)`.
          eye.style.translate = `${eyeX.toFixed(2)}px ${eyeY.toFixed(2)}px`;
        });
      });
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateEyes);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      scheduleUpdate();
    };

    const onScroll = () => scheduleUpdate();
    const onResize = () => scheduleUpdate();

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    scheduleUpdate();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll<HTMLElement>(".bloub-eye").forEach((eye) => {
        eye.style.translate = "";
      });
    };
  }, []);

  return null;
}
