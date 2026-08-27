"use client";

import { useEffect } from "react";

const TAB_LABELS: Record<string, string> = {
  links: "link nha",
  searches: "cau hoi",
  images: "anh",
  messages: "tin nhan",
  memory: "memory",
  schedules: "lich",
  profile: "bot",
  ai: "ai quota"
};

const VALID_TABS = new Set(Object.keys(TAB_LABELS));

function normalize(text = "") {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function currentConnectionId() {
  return new URLSearchParams(window.location.search).get("connection_id") || "main";
}

function storageKey() {
  return `dashboardActiveTab:${currentConnectionId()}`;
}

function findTabButton(tab: string) {
  const wanted = TAB_LABELS[tab];
  if (!wanted) return null;
  return [...document.querySelectorAll<HTMLButtonElement>("button.tab-button")]
    .find((button) => normalize(button.textContent || "") === wanted) || null;
}

function persistTab(tab: string) {
  if (!VALID_TABS.has(tab)) return;
  sessionStorage.setItem(storageKey(), tab);
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function DashboardTabPersistence() {
  useEffect(() => {
    if (window.location.pathname !== "/") return;

    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab") || "";
    const savedTab = sessionStorage.getItem(storageKey()) || "";
    const targetTab = VALID_TABS.has(urlTab) ? urlTab : VALID_TABS.has(savedTab) ? savedTab : "";
    let restored = false;

    const restore = () => {
      if (restored || !targetTab) return;
      const button = findTabButton(targetTab);
      if (!button) return;
      restored = true;
      if (!button.classList.contains("active")) button.click();
      persistTab(targetTab);
    };

    restore();
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });

    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button.tab-button") : null;
      if (!element) return;
      const label = normalize(element.textContent || "");
      const entry = Object.entries(TAB_LABELS).find(([, value]) => value === label);
      if (entry) persistTab(entry[0]);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
