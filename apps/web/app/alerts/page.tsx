'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, X, ExternalLink } from 'lucide-react';
import { NavBar } from '../../components/NavBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-signal-critical', bg: 'bg-signal-critical/10', border: 'border-signal-critical/30' },
  HIGH:     { label: 'High',     color: 'text-signal-high',     bg: 'bg-signal-high/10',     border: 'border-signal-high/30' },
  MEDIUM:   { label: 'Medium',   color: 'text-signal-medium',   bg: 'bg-signal-medium/10',   border: 'border-signal-medium/30' },
  LOW:      { label: 'Low',      color: 'text-ink-400',         bg: 'bg-white/5',             border: 'border-white/10' },
};

const TYPE_LABELS: Record<string, string> = {
  RISK_INCREASE:       'Risk increase',
  NEW_PEP:             'New PEP detected',
  SANCTIONS_MATCH:     'Sanctions match',
  NEW_LITIGATION:      'New litigation',
  NEW_CRITICAL_FINDING:'New critical finding',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');

  const fetchAlerts = useCallback(async () => {
    const res = await fetch(`${API}/api/watchlist/alerts/list?unread=${filter === 'unread'}`);
    const data = await res.json().catch(() => []);
    setAlerts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  async function markRead(id: string) {
    await fetch(`${API}/api/watchlist/alerts/${id}/read`, { method: 'PUT' });
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
  }

  async function dismiss(id: string) {
    await fetch(`${API}/api/watchlist/alerts/${id}/dismiss`, { method: 'PUT' });
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  async function markAllRead() {
    const unread = alerts.filter(a => !a.read);
    await Promise.all(unread.map(a => fetch(`${API}/api/watchlist/alerts/${a.id}/read`, { method: 'PUT' })));
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  }

  const unreadCount = alerts.filter(a => !a.read && !a.dismissed).length;

  if (loading) return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-3xl mx-auto px-8 py-12 animate-pulse space-y-4">
        {[1,2,3,4].map(i => <div key={i} className="h-20 bg-white/5 rounded-sm" />)}
      </div>
    </main>
  );

  return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-3xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-ink-50 flex items-center gap-2">
              <Bell size={18} />
              Alerts
              {unreadCount > 0 && (
                <span className="text-xs font-mono bg-signal-critical/20 text-signal-critical border border-signal-critical/30 px-2 py-0.5 rounded-full">
                  {unreadCount} unread
                </span>
              )}
            </h1>
            <p className="text-xs font-mono text-ink-500 mt-1">
              Changes detected on your monitored companies
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Filter toggle */}
            <div className="flex border border-white/10 rounded-sm overflow-hidden">
              {(['unread', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                    filter === f ? 'bg-white/10 text-ink-50' : 'text-ink-600 hover:text-ink-400'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-500 border border-white/10 hover:text-ink-50 hover:border-white/30 transition-colors"
              >
                <CheckCheck size={11} />
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Alerts list */}
        {alerts.length === 0 ? (
          <div className="border border-white/5 py-16 text-center">
            <Bell size={24} className="text-ink-700 mx-auto mb-3" />
            <div className="text-sm text-ink-500">
              {filter === 'unread' ? 'No unread alerts' : 'No alerts yet'}
            </div>
            <div className="text-xs text-ink-700 mt-1">
              {filter === 'unread'
                ? <button onClick={() => setFilter('all')} className="text-ink-500 hover:text-ink-300 transition-colors">View all alerts</button>
                : 'Add companies to your watchlist to start monitoring'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map(alert => {
              const sev = SEV_CONFIG[alert.severity] || SEV_CONFIG.LOW;
              const invId = alert.metadata?.investigationId;
              return (
                <div
                  key={alert.id}
                  className={`border ${sev.border} ${alert.read ? 'opacity-60' : ''} bg-ink-850 p-4 transition-opacity`}
                >
                  <div className="flex items-start gap-3">
                    {/* Unread dot */}
                    <div className="mt-1.5 shrink-0">
                      {!alert.read ? (
                        <span className={`w-1.5 h-1.5 rounded-full block ${sev.color.replace('text-', 'bg-')}`} />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full block bg-transparent" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Company + type */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-medium text-ink-50">{alert.companyName}</span>
                        <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${sev.bg} ${sev.color} ${sev.border}`}>
                          {alert.severity}
                        </span>
                        <span className="text-[9px] font-mono text-ink-600">
                          {TYPE_LABELS[alert.alertType] || alert.alertType}
                        </span>
                      </div>

                      {/* Title */}
                      <div className="text-sm text-ink-200 leading-snug">{alert.title}</div>

                      {/* Description */}
                      {alert.description && (
                        <p className="text-xs text-ink-500 mt-1 leading-relaxed">{alert.description}</p>
                      )}

                      {/* Timestamp + actions */}
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-[9px] font-mono text-ink-700">
                          {new Date(alert.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {invId && (
                          <Link
                            href={`/investigate/${invId}/overview`}
                            className="flex items-center gap-1 text-[9px] font-mono text-ink-500 hover:text-ink-300 transition-colors"
                          >
                            <ExternalLink size={9} />
                            View investigation
                          </Link>
                        )}
                        {!alert.read && (
                          <button
                            onClick={() => markRead(alert.id)}
                            className="text-[9px] font-mono text-ink-600 hover:text-ink-400 transition-colors"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Dismiss */}
                    <button
                      onClick={() => dismiss(alert.id)}
                      className="text-ink-700 hover:text-ink-400 transition-colors shrink-0 mt-0.5"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Watchlist link */}
        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
          <span className="text-xs text-ink-600 font-mono">
            Alerts are generated when monitored companies show material changes
          </span>
          <Link href="/watchlist" className="text-xs font-mono text-ink-500 hover:text-ink-300 transition-colors">
            Manage watchlist →
          </Link>
        </div>

      </div>
    </main>
  );
}
