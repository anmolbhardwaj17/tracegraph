'use client';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  followUps?: string[];
}

interface Props {
  investigationId: string;
  companyName?: string;
  embedded?: boolean;
  onClose?: () => void;
}

export function TraceyChat({ investigationId, companyName, onClose }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (messages.length > 1) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `I've reviewed the full DD file on **${companyName || 'this company'}**.\n\nAsk me anything — deal viability, ownership structure, key people, risk flags, or what to prioritize in your due diligence.`,
      }]);
    }
  }, [companyName]);

  async function send(q?: string) {
    const question = (q || input).trim();
    if (!question || loading) return;
    // Route memo generation to the memo page
    if (question.toLowerCase().includes('generate ic memo') || question.toLowerCase().includes('ic memo')) {
      onClose?.();
      router.push(`/investigate/${investigationId}/memo`);
      return;
    }
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/investigations/${investigationId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, userName: user?.name, history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const fullReply = data.reply || 'Sorry, I encountered an issue.';
      const aiFollowUps: string[] = data.followUps || [];
      setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: data.sources }]);
      const words = fullReply.split(' ');
      for (let w = 0; w < words.length; w++) {
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 20));
        const partial = words.slice(0, w + 1).join(' ');
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.role === 'assistant') {
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: partial };
          }
          return updated;
        });
      }
      // Attach AI-generated follow-ups to the completed message
      if (aiFollowUps.length > 0) {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.role === 'assistant') {
            updated[updated.length - 1] = { ...updated[updated.length - 1], followUps: aiFollowUps };
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
    'Is this a viable acquisition target?',
    'What would block this deal?',
    'Summarize the ownership structure',
    "What's the founder's track record?",
    'What due diligence should I prioritize?',
  ];

  // Generate contextual follow-up suggestions based on last question
  function getFollowUps(): string[] {
    if (messages.length < 2) return [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content.toLowerCase() || '';

    if (lastUser.includes('viable') || lastUser.includes('acquisition') || lastUser.includes('target'))
      return ['What would block this deal?', "Who are the key people?", 'What DD should I prioritize?'];
    if (lastUser.includes('block') || lastUser.includes('concern') || lastUser.includes('issue'))
      return ['Summarize the ownership structure', 'Flag risks for legal review', 'Compare deal risk breakdown'];
    if (lastUser.includes('owner') || lastUser.includes('ubo') || lastUser.includes('structure') || lastUser.includes('control'))
      return ['Any offshore or tax haven entities?', "Map the founder's other companies", 'What warranties should I negotiate?'];
    if (lastUser.includes('founder') || lastUser.includes('track record') || lastUser.includes('director'))
      return ['Any PEPs or sanctions on the team?', 'Check dissolved company history', 'Show co-director relationships'];
    if (lastUser.includes('pep') || lastUser.includes('political') || lastUser.includes('sanction'))
      return ['Enhanced KYC implications?', 'Show the full matches tab', 'How close is the sanctions proximity?'];
    if (lastUser.includes('financial') || lastUser.includes('revenue') || lastUser.includes('profit'))
      return ['Any financial distress signals?', 'Compare to sector peers', 'What do the filed accounts show?'];
    if (lastUser.includes('due diligence') || lastUser.includes('prioritize') || lastUser.includes('next'))
      return ['What are the deal blockers?', 'Generate an IC memo', 'What legal DD is needed?'];
    if (lastUser.includes('court') || lastUser.includes('lawsuit') || lastUser.includes('litigation'))
      return ['Any adverse media coverage?', 'Pattern across multiple cases?', 'Reps and warranties implications'];
    if (lastUser.includes('subsidiary') || lastUser.includes('offshore') || lastUser.includes('jurisdiction'))
      return ['Any FATF greylist jurisdictions?', 'Trace the full ownership chain', 'Complexity for a share purchase?'];
    if (lastUser.includes('memo') || lastUser.includes('ic') || lastUser.includes('committee'))
      return ['Add financials section', 'What recommendation would you make?', 'Export as PDF'];

    return ['What would block this deal?', 'Show the ownership structure', 'What DD should I prioritize?'];
  }

  // Render via portal on document.body — bypasses all CSS containment
  if (!mounted) return null;

  const panel = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 400,
        height: '100vh',
        zIndex: 9999,
        background: '#08090a',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Gradient glow */}
      <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%) translateY(40%)', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(180,230,0,0.12) 0%, rgba(100,160,0,0.05) 40%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)', width: 250, height: 250, borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,255,0,0.08) 0%, transparent 60%)', pointerEvents: 'none' }} />

      {/* Close */}
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <X size={14} color="rgba(255,255,255,0.3)" />
      </button>

      {/* Messages — takes remaining space, scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '28px 24px 16px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'assistant' ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* Tracey orb avatar with animated eyes */}
                  <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: 2, background: 'radial-gradient(circle at 38% 32%, rgba(210,255,40,0.45) 0%, rgba(100,160,0,0.15) 35%, #0c0e08 80%)', boxShadow: '0 0 12px rgba(200,255,0,0.1)' }}>
                    <div style={{ position: 'absolute', top: 3, left: 6, width: 12, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', filter: 'blur(1px)' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 1 }}>
                      <div className="tracey-eye" style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4ff00', boxShadow: '0 0 5px rgba(212,255,0,0.8)' }} />
                      <div className="tracey-eye" style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4ff00', boxShadow: '0 0 5px rgba(212,255,0,0.8)', animationDelay: '0.1s' }} />
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                  {i === 0 && (
                    <p style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.2em', color: 'rgba(212,255,0,0.35)', textTransform: 'uppercase', marginBottom: 8 }}>Tracey</p>
                  )}
                  <div style={{ fontSize: 13.5, lineHeight: 1.75, color: 'rgba(255,255,255,0.65)' }}>
                    {(() => {
                      // Split thinking from answer
                      const thinkMatch = msg.content.match(/<thinking>([\s\S]*?)<\/thinking>/);
                      const thinking = thinkMatch?.[1]?.trim();
                      const answer = msg.content.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim();
                      return (
                        <>
                          {thinking && (
                            <details style={{ marginBottom: 12 }}>
                              <summary style={{ fontSize: 11, color: 'rgba(212,255,0,0.3)', cursor: 'pointer', userSelect: 'none', marginBottom: 6 }}>
                                Tracey&apos;s reasoning...
                              </summary>
                              <div style={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.3)', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, borderLeft: '2px solid rgba(212,255,0,0.15)', marginBottom: 8 }}>
                                {thinking.split('\n').map((line, j) => (
                                  <p key={j} style={{ marginTop: j > 0 ? 6 : 0 }}>{line}</p>
                                ))}
                              </div>
                            </details>
                          )}
                          {answer.split('\n').map((line, j) => (
                            <p key={j} style={{ marginTop: j > 0 ? 12 : 0 }}>
                              {line.split('**').map((part, k) =>
                                k % 2 === 1 ? <span key={k} style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>{part}</span> : part
                              )}
                            </p>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <p style={{ fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,0.1)', marginTop: 12, letterSpacing: '0.05em' }}>{msg.sources.join(' · ')}</p>
                  )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '85%', fontSize: 13.5, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: '10px 16px' }}>
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {/* Thinking orb — spins and pulses */}
              <div className="tracey-thinking" style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', position: 'relative', flexShrink: 0, background: 'radial-gradient(circle at 38% 32%, rgba(210,255,40,0.45) 0%, rgba(100,160,0,0.15) 35%, #0c0e08 80%)', boxShadow: '0 0 20px rgba(200,255,0,0.2)' }}>
                <div style={{ position: 'absolute', inset: 2, borderRadius: '50%', animation: 'traceyThinkSpin 1.5s linear infinite', background: 'conic-gradient(from 0deg, transparent 0%, rgba(212,255,0,0.2) 30%, transparent 60%)' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 1 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4ff00', boxShadow: '0 0 5px rgba(212,255,0,0.8)', animation: 'traceyThinkEyes 0.8s ease-in-out infinite' }} />
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4ff00', boxShadow: '0 0 5px rgba(212,255,0,0.8)', animation: 'traceyThinkEyes 0.8s ease-in-out infinite 0.1s' }} />
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'rgba(212,255,0,0.3)', fontStyle: 'italic' }}>thinking...</span>
            </div>
          )}

          {/* Suggestion pills — initial or AI-generated follow-ups */}
          {!loading && (() => {
            // Use AI-generated follow-ups from last assistant message, fall back to hardcoded
            const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
            const aiPills = lastAssistant?.followUps || [];
            const pills = messages.length <= 1 ? quickActions : aiPills.length > 0 ? aiPills : getFollowUps();
            if (pills.length === 0) return null;
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                {pills.map((q, i) => (
                  <button
                    key={`${messages.length}-${i}`}
                    onClick={() => send(q)}
                    style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', padding: '8px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)'; }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            );
          })()}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input — always at bottom */}
      <div style={{ padding: '12px 20px 20px', position: 'relative', zIndex: 1, background: 'linear-gradient(to top, #08090a 70%, transparent)', flexShrink: 0 }}>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this investigation..."
            disabled={loading}
            style={{ width: '100%', padding: '12px 48px 12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, fontSize: 13, color: 'rgba(255,255,255,0.85)', outline: 'none', boxSizing: 'border-box' }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: 12, background: 'linear-gradient(135deg, #c0e800, #7aab00)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: loading || !input.trim() ? 0.15 : 1 }}
          >
            <Send size={14} color="#000" />
          </button>
        </form>
      </div>

      <style>{`
        .tracey-eye {
          animation: traceyBlink 2.5s ease-in-out infinite, traceyLook 4s ease-in-out infinite;
        }
        @keyframes traceyBlink {
          0%,38%,42%,75%,79%,100% { transform: scaleY(1); }
          40% { transform: scaleY(0.1); }
          77% { transform: scaleY(0.1); }
        }
        @keyframes traceyLook {
          0%,20% { transform: translateX(0); }
          25%,40% { transform: translateX(1.5px); }
          45%,60% { transform: translateX(-1px) translateY(0.5px); }
          65%,80% { transform: translateX(0.5px) translateY(-0.5px); }
          85%,100% { transform: translateX(0); }
        }
        @keyframes traceyThinkSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes traceyThinkEyes {
          0%,100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .tracey-thinking {
          animation: traceyPulse 1.2s ease-in-out infinite;
        }
        @keyframes traceyPulse {
          0%,100% { box-shadow: 0 0 12px rgba(200,255,0,0.15); }
          50% { box-shadow: 0 0 25px rgba(200,255,0,0.3); }
        }
      `}</style>
    </div>
  );

  return createPortal(panel, document.body);
}
