'use client';
import { useEffect, useState } from 'react';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { useAuth } from './AuthProvider';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  authorId?: string;
}

export function CommentThread({ investigationId }: { investigationId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/investigations/${investigationId}/comments`)
      .then(r => r.json())
      .then(setComments)
      .catch(() => {});
  }, [open, investigationId]);

  async function submit() {
    if (!body.trim()) return;
    setLoading(true);
    const res = await fetch(`${API}/api/investigations/${investigationId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim(), authorName: user?.name || user?.email }),
    });
    const comment = await res.json();
    setComments(prev => [...prev, comment]);
    setBody('');
    setLoading(false);
  }

  async function deleteComment(id: string) {
    await fetch(`${API}/api/investigations/${investigationId}/comments/${id}`, { method: 'DELETE' });
    setComments(prev => prev.filter(c => c.id !== id));
  }

  const unread = comments.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors"
      >
        <MessageSquare size={11} />
        Notes
        {unread > 0 && <span className="bg-white/15 text-ink-300 px-1.5 py-0.5 rounded-sm text-[8px]">{unread}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-ink-850 border border-white/10 shadow-2xl z-40">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">Team notes</div>
            <button onClick={() => setOpen(false)} className="text-ink-600 hover:text-ink-400">×</button>
          </div>

          {/* Comments list */}
          <div className="max-h-72 overflow-y-auto p-4 space-y-4">
            {comments.length === 0 ? (
              <div className="text-center py-6">
                <MessageSquare size={20} className="text-ink-700 mx-auto mb-2" />
                <div className="text-xs text-ink-600">No notes yet. Add context for your team.</div>
              </div>
            ) : (
              comments.map(c => (
                <div key={c.id} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-ink-700 flex items-center justify-center text-[8px] font-bold text-ink-300">
                        {(c.authorName || 'A')[0].toUpperCase()}
                      </div>
                      <span className="text-[10px] font-medium text-ink-300">{c.authorName || 'Anonymous'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-ink-700">
                        {new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                      {(user?.id === c.authorId || !c.authorId) && (
                        <button
                          onClick={() => deleteComment(c.id)}
                          className="opacity-0 group-hover:opacity-100 text-ink-700 hover:text-signal-critical transition-all"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-ink-300 leading-relaxed pl-7">{c.body}</div>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/5 p-3 flex gap-2">
            <input
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Add a note..."
              disabled={loading}
              className="flex-1 bg-ink-800 border border-white/10 text-xs text-ink-100 px-3 py-2 focus:outline-none focus:border-white/25 placeholder:text-ink-700"
            />
            <button
              onClick={submit}
              disabled={loading || !body.trim()}
              className="px-3 py-2 bg-ink-50 text-ink-900 disabled:opacity-30 hover:bg-white transition-colors"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
