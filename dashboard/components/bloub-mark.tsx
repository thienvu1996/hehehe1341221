"use client";

export function BloubMark({ tone = "active" }: { tone?: "active" | "quiet" | "alert" }) {
  return (
    <div className={`bloub bloub-${tone}`} aria-hidden="true">
      <div className="bloub-orbit bloub-orbit-one" />
      <div className="bloub-orbit bloub-orbit-two" />
      <div className="bloub-body">
        <span className="bloub-eye bloub-eye-left" />
        <span className="bloub-eye bloub-eye-right" />
      </div>
      <div className="bloub-pulse" />
    </div>
  );
}
