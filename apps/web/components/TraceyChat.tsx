'use client';
import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

interface Props {
  investigationId: string;
  companyName?: string;
  /** Embedded mode — renders as sidebar content, no floating button */
  embedded?: boolean;
  onClose?: () => void;
}

export function TraceyChat({ investigationId, companyName, embedded, onClose }: Props) {
  const [open, setOpen] = useState(embedded ? true : false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Welcome message
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `Hi, I'm Tracey — your corporate intelligence consultant. I've analyzed the full investigation report for **${companyName || 'this company'}**.\n\nAsk me anything about the risk score, findings, PEP flags, financials, or what action to take. What would you like to know?`,
      }]);
    }
  }, [open, companyName]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/investigations/${investigationId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply || 'Sorry, I encountered an issue.', sources: data.sources }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: "I'm having trouble connecting. Please try again." }]);
    }
    setLoading(false);
  }

  // Quick action buttons
  const quickActions = [
    'What are the main concerns?',
    'Explain the risk score',
    'Any PEP or sanctions flags?',
    'How are the financials?',
    'What should I do next?',
  ];

  // Embedded mode — full sidebar panel with gradient
  if (embedded) {
    return (
      <div className="flex flex-col h-full relative overflow-hidden bg-[#0a0a0f]">
        {/* Gradient glow — top center */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-blue-600/20 blur-[100px] pointer-events-none" />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[200px] h-[200px] rounded-full bg-violet-500/15 blur-[80px] pointer-events-none" />

        {/* Close button — minimal */}
        <button onClick={onClose} className="absolute top-3 right-3 z-10 text-white/20 hover:text-white/60 transition-colors">
          <X className="w-4 h-4" />
        </button>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-5 pt-8 pb-4 space-y-5 relative z-[1]">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
              {/* Tracey avatar — only on assistant messages */}
              {msg.role === 'assistant' && i === 0 && (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 mt-1">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
              )}
              {msg.role === 'assistant' && i > 0 && <div className="w-7 shrink-0" />}

              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-white/10 text-white/90'
                  : 'text-white/80'
              }`}>
                {msg.content.split('\n').map((line, j) => (
                  <p key={j} className={j > 0 ? 'mt-2' : ''}>
                    {line.split('**').map((part, k) =>
                      k % 2 === 1 ? <strong key={k} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                ))}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <span className="text-[9px] font-mono text-white/25">Sources: {msg.sources.join(' · ')}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="w-7 shrink-0" />
              <div className="flex gap-1.5 px-4 py-3">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-pulse" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {/* Quick actions — clean pills */}
          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-2 pl-9">
              {quickActions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="text-[11px] text-white/40 hover:text-white/80 px-3 py-1.5 rounded-full border border-white/8 hover:border-white/20 hover:bg-white/5 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input — bottom, glass effect */}
        <div className="px-4 py-4 relative z-[1]">
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Tracey..."
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-white/5 border border-white/8 rounded-full text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/15 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 shrink-0"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Floating mode (original)
  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-ink-50 text-ink-900 shadow-lg hover:bg-white transition-all flex items-center justify-center group">
          <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span className="absolute -top-8 right-0 bg-ink-800 text-ink-200 text-[10px] font-mono px-2 py-1 rounded-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">Ask Tracey</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] max-h-[600px] bg-ink-900 border border-white/10 rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-ink-850">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-medium text-ink-50">Tracey</div>
                <div className="text-[10px] font-mono text-ink-500">Corporate Intelligence Consultant</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-ink-500 hover:text-ink-50 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-[300px] max-h-[420px]">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-ink-700 text-ink-50'
                    : 'bg-ink-850 text-ink-200 border border-white/5'
                }`}>
                  {msg.content.split('\n').map((line, j) => (
                    <p key={j} className={j > 0 ? 'mt-2' : ''}>
                      {line.split('**').map((part, k) =>
                        k % 2 === 1 ? <strong key={k} className="text-ink-50">{part}</strong> : part
                      )}
                    </p>
                  ))}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5">
                      <span className="text-[9px] font-mono text-ink-600">Sources: {msg.sources.join(' · ')}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-ink-850 border border-white/5 rounded-lg px-4 py-3">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-ink-500 animate-pulse" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-ink-500 animate-pulse" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-ink-500 animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Quick actions — show only at start */}
            {messages.length <= 1 && !loading && (
              <div className="space-y-1.5">
                {quickActions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(q); setTimeout(() => send(), 50); setInput(q); }}
                    className="block w-full text-left text-xs text-ink-400 hover:text-ink-50 hover:bg-ink-800 px-3 py-2 rounded-sm transition-colors border border-white/5"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-white/5 bg-ink-850">
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Tracey about this investigation..."
                disabled={loading}
                className="flex-1 px-3 py-2 bg-ink-900 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-600 focus:outline-none focus:border-white/20 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-3 py-2 bg-ink-50 text-ink-900 rounded-sm hover:bg-white transition-colors disabled:opacity-30"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
