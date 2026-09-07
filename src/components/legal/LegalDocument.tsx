// FILE LOCATION: src/components/legal/LegalDocument.jsx
// DESCRIPTION: Reusable legal-document layout enforcing "read to the bottom
//              before you can accept". Used by the Terms of Service and Privacy
//              Policy pages (and can be embedded/modal inside the Register flow).
//
// Architecture:
//   - The document content scrolls inside a fixed-height panel.
//   - A scroll progress bar and a "You must read to the bottom" gate prevent the
//     user from agreeing until they have actually scrolled through everything.
//   - `onAgree` is only fired after the user has (1) reached the bottom AND
//     (2) ticked the "I have read and agree" checkbox.
//   - `footerNode` lets callers inject back/continue actions (e.g. return to Register).

import React, { useState, useRef, useCallback, useEffect } from "react";
import { FaCheck, FaFileContract, FaArrowLeft } from "react-icons/fa";
import { MdOutlineGavel, MdOutlinePrivacyTip } from "react-icons/md";

const IconMap = {
  terms: MdOutlineGavel,
  privacy: MdOutlinePrivacyTip,
};

type LegalSection = {
  heading: string;
  body: string | Array<string | { label: string; text: string }>;
};

const LegalDocument = ({
  type = "terms", // 'terms' | 'privacy'
  title = "Terms of Service",
  updatedAt = "",
  intro = "",
  sections = [],
  readToAccept = true,
  onAgree,
  agreeButtonLabel = "I Agree & Continue",
  footerNode = null,
  backTo = null,
  backLabel = "Back",
  embedded = false,
}: {
  type?: string;
  title?: string;
  updatedAt?: string;
  intro?: string;
  sections?: LegalSection[];
  readToAccept?: boolean;
  onAgree?: () => void;
  agreeButtonLabel?: string;
  footerNode?: React.ReactNode;
  backTo?: string | null;
  backLabel?: string;
  embedded?: boolean;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [agreed, setAgreed] = useState(false);

  const Icon = IconMap[type as keyof typeof IconMap] || FaFileContract;
  const canAccept = !readToAccept || (readToAccept && atBottom && agreed);

  const handleAgree = () => {
    if (!canAccept) return;
    if (onAgree) onAgree();
  };

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const max = scrollHeight - clientHeight;
    const percent = max > 0 ? Math.min(100, Math.round((scrollTop / max) * 100)) : 100;
    setScrollPercent(percent);
    setAtBottom(max <= 0 || scrollTop >= max - 8);
  }, []);

  useEffect(() => {
    handleScroll();
  }, [handleScroll]);

  if (embedded) {
    return (
      <div className="flex flex-col h-full bg-slate-800/95 rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 bg-slate-800/60 flex items-center gap-3">
          <div className="p-2.5 bg-amber-400/20 rounded-lg">
            <Icon className="text-amber-400 text-lg" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-white text-lg leading-tight">{title}</h2>
            {updatedAt && <p className="text-white/50 text-xs">Last updated: {updatedAt}</p>}
          </div>
        </div>

        {/* Scroll progress bar */}
        <div className="relative h-1 bg-white/10 shrink-0">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-200 ${
              atBottom ? "bg-green-400" : "bg-amber-400"
            }`}
            style={{ width: `${scrollPercent}%` }}
          />
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-y-auto flex-1 px-5 py-4 text-white/85 space-y-5 min-h-[40vh]"
        >
          {intro && <p className="text-sm leading-relaxed">{intro}</p>}
          {sections.map((sec, i) => (
            <section key={i}>
              <h2 className="font-semibold text-white mb-1.5 text-[15px]">
                <span className="text-amber-400 mr-2">
                  {String(i + 1).padStart(2, "0")}.
                </span>
                {sec.heading}
              </h2>
              {typeof sec.body === "string" ? (
                <p className="text-sm leading-relaxed">{sec.body}</p>
              ) : (
                <div className="text-sm leading-relaxed">
                  {sec.body.map((item, idx) =>
                    typeof item === "string" ? (
                      <li key={idx} className="ml-5 list-disc marker:text-amber-400/70">
                        {item}
                      </li>
                    ) : (
                      <p key={idx}>
                        <span className="text-amber-300 font-medium">{item.label}: </span>
                        {item.text}
                      </p>
                    )
                  )}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Agreement footer */}
        <div className="px-5 py-4 border-t border-white/10 bg-slate-800/60 space-y-3">
          {!atBottom && (
            <div className="flex items-center gap-2 text-amber-300 text-xs bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Please scroll to the bottom to enable agreement (you're at {scrollPercent}%).
            </div>
          )}
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setAgreed((v) => !v)}
              disabled={!atBottom}
              aria-disabled={!atBottom}
              className={`mt-0.5 w-6 h-6 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${
                agreed
                  ? "bg-green-500 border-green-500 text-white"
                  : atBottom
                    ? "border-amber-400 hover:border-amber-300"
                    : "border-white/20 cursor-not-allowed"
              }`}
            >
              {agreed && <FaCheck className="text-sm" />}
            </button>
            <label
              className="text-sm text-white/80 leading-relaxed cursor-pointer select-none"
              onClick={() => atBottom && setAgreed((v) => !v)}
            >
              I have read and agree to the {title}{type === "privacy" ? " and how my personal data is handled" : ""}.
            </label>
          </div>
          <button
            type="button"
            onClick={handleAgree}
            disabled={!canAccept}
            className={`w-full flex items-center justify-center gap-2 font-semibold py-2.5 px-4 rounded-lg transition-colors ${
              canAccept
                ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                : "bg-white/10 text-white/40 cursor-not-allowed"
            }`}
          >
            <FaCheck />
            {agreeButtonLabel || "I Agree"}
          </button>
          {footerNode}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 px-4 py-10">
      <div className="w-full max-w-3xl flex flex-col bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 sm:px-8 py-6 border-b border-white/10 bg-slate-800/40">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-400/20 rounded-xl">
              <Icon className="text-amber-400 text-2xl" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
              {updatedAt && (
                <p className="text-white/60 text-sm mt-1">
                  Last updated: {updatedAt}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Scroll progress bar */}
        <div className="relative h-1.5 bg-white/10">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-200 ${
              atBottom ? "bg-green-400" : "bg-amber-400"
            }`}
            style={{ width: `${scrollPercent}%` }}
          />
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-y-auto px-6 sm:px-8 py-6 max-h-[50vh] sm:max-h-[60vh] text-white/85 space-y-6"
        >
          {intro && <p className="text-base leading-relaxed">{intro}</p>}

          {sections.map((sec, i) => (
            <section key={i}>
              <h2 className="text-lg font-semibold text-white mb-2">
                <span className="text-amber-400 mr-2">
                  {String(i + 1).padStart(2, "0")}.
                </span>
                {sec.heading}
              </h2>
              {typeof sec.body === "string" ? (
                <p className="text-sm sm:text-base leading-relaxed">{sec.body}</p>
              ) : (
                <div className="text-sm sm:text-base leading-relaxed">
                  {sec.body.map((item, idx) =>
                    typeof item === "string" ? (
                      <li key={idx} className="ml-5 list-disc marker:text-amber-400/70">
                        {item}
                      </li>
                    ) : (
                      <p key={idx}>
                        <span className="text-amber-300 font-medium">{item.label}: </span>
                        {item.text}
                      </p>
                    )
                  )}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Agreement footer */}
        <div className="px-6 sm:px-8 py-5 border-t border-white/10 bg-slate-800/40 space-y-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setAgreed((v) => !v)}
              disabled={!atBottom}
              aria-disabled={!atBottom}
              aria-label="I have read and agree"
              className={`mt-0.5 w-6 h-6 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${
                agreed
                  ? "bg-green-500 border-green-500 text-white"
                  : atBottom
                    ? "border-amber-400 hover:border-amber-300"
                    : "border-white/20 cursor-not-allowed"
              }`}
            >
              {agreed && <FaCheck className="text-sm" />}
            </button>
            <label
              className="text-sm text-white/80 leading-relaxed cursor-pointer select-none"
              onClick={() => atBottom && setAgreed((v) => !v)}
            >
              I have read and agree to the{" "}
              <span className="text-amber-400 font-medium">{title}</span>{type === "privacy" ? " and how my personal data is handled" : ""}.
            </label>
          </div>

          {!atBottom && (
            <div className="flex items-center gap-2 text-amber-300 text-sm bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-2.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Please scroll to the bottom to enable the agreement checkbox (
              {scrollPercent < 100 ? `you're at ${scrollPercent}%` : "almost there"}).
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleAgree}
              disabled={!canAccept}
              className={`flex-1 flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-xl transition-all duration-300 ${
                canAccept
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg"
                  : "bg-white/10 text-white/40 cursor-not-allowed"
              }`}
            >
              <FaCheck />
              {agreeButtonLabel}
            </button>

            {backTo && (
              <a
                href={backTo}
                className="flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-xl border border-white/20 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <FaArrowLeft />
                {backLabel}
              </a>
            )}
          </div>

          {footerNode}
        </div>
      </div>
    </div>
  );
};

export default LegalDocument;
