'use client';
import { useEffect, useState } from 'react';
import { Share2, Link2, X, Check, Copy } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

export function ShareInvestigation({ investigationId }: { investigationId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ enabled: boolean; shareUrl: string | null }>({ enabled: false, shareUrl: null });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/investigations/${investigationId}/share`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [open, investigationId]);

  async function enable() {
    setLoading(true);
    const res = await fetch(`${API}/api/investigations/${investigationId}/share`, { method: 'POST' });
    const data = await res.json();
    setStatus({ enabled: true, shareUrl: data.shareUrl });
    setLoading(false);
  }

  async function disable() {
    setLoading(true);
    await fetch(`${API}/api/investigations/${investigationId}/share`, { method: 'DELETE' });
    setStatus({ enabled: false, shareUrl: null });
    setLoading(false);
  }

  function copyLink() {
    if (!status.shareUrl) return;
    navigator.clipboard.writeText(status.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors"
      >
        <Share2 size={11} />
        Share
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-ink-850 border border-white/10 shadow-2xl z-40 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">Share investigation</div>
            <button onClick={() => setOpen(false)} className="text-ink-600 hover:text-ink-400"><X size={14} /></button>
          </div>

          <div className="space-y-4">
            {/* Public link toggle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-ink-300">Public share link</span>
                <button
                  onClick={status.enabled ? disable : enable}
                  disabled={loading}
                  className={`relative w-10 h-5 rounded-full transition-colors ${status.enabled ? 'bg-signal-clean/60' : 'bg-white/10'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${status.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <p className="text-[10px] font-mono text-ink-600">
                {status.enabled ? 'Anyone with the link can view this report (read-only).' : 'Enable to generate a shareable link.'}
              </p>
            </div>

            {/* Copy link */}
            {status.enabled && status.shareUrl && (
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-ink-900 border border-white/10 px-3 py-2 text-[10px] font-mono text-ink-500 truncate">
                    {status.shareUrl}
                  </div>
                  <button
                    onClick={copyLink}
                    className="flex items-center gap-1 px-3 py-2 border border-white/10 text-[10px] font-mono text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors"
                  >
                    {copied ? <><Check size={10} className="text-signal-clean" /> Copied</> : <><Copy size={10} /> Copy</>}
                  </button>
                </div>
              </div>
            )}

            {/* Team sharing note */}
            <div className="border-t border-white/5 pt-4">
              <div className="text-[9px] font-mono text-ink-600">
                Team members with access can also view this investigation.{' '}
                <a href="/team" className="text-ink-400 hover:text-ink-200 transition-colors">Manage team →</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
