'use client';
import { useState, useRef, useEffect } from 'react';
import { X, Send } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

interface Props {
  investigationId: string;
  companyName?: string;
  embedded?: boolean;
  onClose?: () => void;
}

export function TraceyChat({ investigationId, companyName, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only auto-scroll after user sends a message (not on welcome message)
  useEffect(() => {
    if (messages.length > 1) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Welcome
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `I've analyzed the full investigation report for **${companyName || 'this company'}**.\n\nAsk me anything — risk score, findings, PEP flags, financials, or what action to take.`,
      }]);
    }
  }, [companyName]);

  async function send(q?: string) {
    const question = (q || input).trim();
    if (!question || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/investigations/${investigationId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const fullReply = data.reply || 'Sorry, I encountered an issue.';
      // Stream effect — add message empty then fill word by word
      const msgIdx = messages.length + 1; // +1 for the user message we just added
      setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: data.sources }]);
      const words = fullReply.split(' ');
      for (let w = 0; w < words.length; w++) {
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 20));
        const partial = words.slice(0, w + 1).join(' ');
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: partial };
          }
          return updated;
        });
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Connection issue. Please try again." }]);
    }
    setLoading(false);
  }

  const quickActions = [
    'What are the main concerns?',
    'Explain the risk score',
    'Any PEP or sanctions flags?',
    'How are the financials?',
    'What should I do next?',
  ];

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#08090a' }}>
      {/* Gradient glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[40%] w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(180,230,0,0.12) 0%, rgba(100,160,0,0.05) 40%, transparent 65%)' }} />
      <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 w-[250px] h-[250px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(212,255,0,0.08) 0%, transparent 60%)' }} />

      {/* Close button */}
      <button onClick={onClose} className="absolute top-4 right-4 z-10 w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center transition-colors">
        <X className="w-3.5 h-3.5 text-white/25 hover:text-white/60" />
      </button>

      {/* Chat — absolute positioned: top to bottom minus input height */}
      <div className="absolute top-0 left-0 right-0 bottom-[70px] overflow-y-auto px-6 pt-7 pb-4 space-y-6 z-[1]">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'assistant' ? (
              <div>
                {i === 0 && (
                  <p className="text-[10px] font-medium tracking-[0.2em] uppercase mb-4" style={{ color: 'rgba(212,255,0,0.35)' }}>Tracey</p>
                )}
                <div className="text-[13.5px] leading-[1.75] text-white/65">
                  {msg.content.split('\n').map((line, j) => (
                    <p key={j} className={j > 0 ? 'mt-3' : ''}>
                      {line.split('**').map((part, k) =>
                        k % 2 === 1 ? <span key={k} className="text-white/90 font-medium">{part}</span> : part
                      )}
                    </p>
                  ))}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <p className="text-[8px] font-mono text-white/10 mt-3 tracking-wide">{msg.sources.join(' · ')}</p>
                )}
              </div>
            ) : (
              <div className="flex justify-end">
                <div className="max-w-[85%] text-[13.5px] leading-[1.7] text-white/85 bg-white/[0.06] rounded-2xl px-4 py-2.5">
                  {msg.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 h-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ animationDelay: `${i * 200}ms`, background: 'rgba(212,255,0,0.4)' }} />
            ))}
          </div>
        )}

        {messages.length <= 1 && !loading && (
          <div className="flex flex-wrap gap-2 pt-1">
            {quickActions.map((q, i) => (
              <button
                key={i}
                onClick={() => send(q)}
                className="text-[11px] text-white/25 hover:text-white/60 px-3.5 py-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.03] hover:border-white/[0.08] transition-all duration-200"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input — absolute bottom */}
      <div className="absolute bottom-0 left-0 right-0 px-5 pb-5 pt-3 z-[1]" style={{ background: 'linear-gradient(to top, #08090a 60%, transparent)' }}>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this investigation..."
            disabled={loading}
            className="w-full pl-4 pr-12 py-3 bg-white/[0.03] border border-white/[0.05] rounded-2xl text-[13px] text-white/85 placeholder:text-white/15 focus:outline-none focus:border-white/[0.1] focus:bg-white/[0.05] disabled:opacity-40 transition-all"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-15 hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #c0e800, #7aab00)' }}
          >
            <Send className="w-3.5 h-3.5 text-black" />
          </button>
        </form>
      </div>
    </div>
  );
}
