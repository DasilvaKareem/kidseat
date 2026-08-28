"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FIND, type Locale } from "@/lib/i18n";

function textOf(message: { parts?: Array<{ type: string; text?: string }> }): string {
  return (message.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export default function ChatBar({
  locale,
  signedIn,
  onRequestSignIn,
}: {
  locale: Locale;
  signedIn: boolean;
  onRequestSignIn: () => void;
}) {
  const t = FIND[locale];
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setOpen(true);
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3">
      <div className="pointer-events-auto w-full max-w-[720px] overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_8px_30px_rgba(27,23,20,0.18)]">
        {open && (
          <div
            ref={scrollRef}
            className="max-h-[45svh] overflow-y-auto border-b border-line px-4 py-4"
          >
            {messages.length === 0 && (
              <p className="text-[16px] text-muted">{t.chat.intro}</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[17px] leading-relaxed ${
                    m.role === "user"
                      ? "bg-brand text-white"
                      : "bg-canvas text-ink"
                  }`}
                >
                  {textOf(m)}
                </p>
              </div>
            ))}
            {busy && <p className="text-[16px] text-muted">{t.loading}</p>}
          </div>
        )}

        {signedIn ? (
          <form onSubmit={submit} className="flex items-center gap-2 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setOpen(true)}
              placeholder={t.chat.placeholder}
              aria-label={t.chat.placeholder}
              className="min-h-[56px] flex-1 rounded-2xl bg-canvas px-4 text-[17px] text-ink placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || input.trim() === ""}
              className="min-h-[56px] rounded-2xl bg-brand px-5 text-[17px] font-semibold text-white disabled:opacity-40"
            >
              {t.chat.send}
            </button>
          </form>
        ) : (
          // Locked rather than hidden: the capability stays discoverable, and
          // the reason it is unavailable is stated plainly.
          <button
            onClick={onRequestSignIn}
            className="flex min-h-[64px] w-full items-center justify-center gap-2 px-4 text-[17px] font-semibold text-brand"
          >
            {t.chat.locked}
          </button>
        )}
      </div>
    </div>
  );
}
