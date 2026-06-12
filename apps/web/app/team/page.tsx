'use client';
import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Crown, Shield, Eye, Mail } from 'lucide-react';
import { NavBar } from '../../components/NavBar';
import { useAuth } from '../../components/AuthProvider';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const ROLE_CONFIG = {
  owner:  { label: 'Owner',  icon: Crown,  color: 'text-[#d4ff00]' },
  admin:  { label: 'Admin',  icon: Shield, color: 'text-signal-high' },
  member: { label: 'Member', icon: Users,  color: 'text-ink-300' },
  viewer: { label: 'Viewer', icon: Eye,    color: 'text-ink-500' },
};

export default function TeamPage() {
  const { user, token } = useAuth();
  const [teams, setTeams] = useState<any[]>([]);
  const [activeTeam, setActiveTeam] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin'|'member'|'viewer'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${API}/api/teams/mine`, { headers: authHeaders })
      .then(r => r.json())
      .then((t: any[]) => {
        setTeams(t);
        if (t.length > 0) selectTeam(t[0].id);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  async function selectTeam(teamId: string) {
    setLoading(true);
    const [team, mems] = await Promise.all([
      fetch(`${API}/api/teams/${teamId}`, { headers: authHeaders }).then(r => r.json()),
      fetch(`${API}/api/teams/${teamId}/members`, { headers: authHeaders }).then(r => r.json()),
    ]);
    setActiveTeam(team);
    setMembers(mems);
    setLoading(false);
  }

  async function createTeam() {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    const res = await fetch(`${API}/api/teams`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ name: newTeamName.trim() }),
    });
    const team = await res.json();
    setTeams(prev => [...prev, team]);
    setNewTeamName('');
    setCreatingTeam(false);
    selectTeam(team.id);
  }

  async function invite() {
    if (!inviteEmail.trim() || !activeTeam) return;
    setInviting(true);
    await fetch(`${API}/api/teams/${activeTeam.id}/invite`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    setInviteEmail('');
    setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
    setTimeout(() => setInviteSuccess(''), 3000);
    setInviting(false);
    const mems = await fetch(`${API}/api/teams/${activeTeam.id}/members`, { headers: authHeaders }).then(r => r.json());
    setMembers(mems);
  }

  async function removeMember(memberId: string) {
    if (!activeTeam) return;
    await fetch(`${API}/api/teams/${activeTeam.id}/members/${memberId}`, { method: 'DELETE', headers: authHeaders });
    setMembers(prev => prev.filter(m => m.id !== memberId));
  }

  if (!user) return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-2xl mx-auto px-8 py-24 text-center">
        <Users size={32} className="text-ink-700 mx-auto mb-4" />
        <div className="text-sm text-ink-500">Sign in to create or join a team</div>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <h1 className="text-2xl font-medium text-ink-50">Team workspace</h1>
            <p className="text-xs font-mono text-ink-500 mt-1">Collaborate on DD investigations with your team</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Team list sidebar */}
          <div className="col-span-1">
            <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3">Your teams</div>
            <div className="space-y-1 mb-4">
              {teams.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTeam(t.id)}
                  className={`w-full text-left px-3 py-2.5 text-xs transition-colors ${activeTeam?.id === t.id ? 'bg-white/10 text-ink-50' : 'text-ink-400 hover:text-ink-200 hover:bg-white/5'}`}
                >
                  <div className="font-medium truncate">{t.name}</div>
                </button>
              ))}
              {teams.length === 0 && (
                <div className="text-[10px] font-mono text-ink-700 py-2">No teams yet</div>
              )}
            </div>

            {/* Create new team */}
            <div className="border border-white/5 p-3">
              <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-2">New team</div>
              <input
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createTeam()}
                placeholder="Team name..."
                className="w-full bg-ink-800 border border-white/10 text-xs text-ink-100 px-2 py-1.5 focus:outline-none focus:border-white/25 mb-2"
              />
              <button
                onClick={createTeam}
                disabled={creatingTeam || !newTeamName.trim()}
                className="w-full py-1.5 bg-ink-50 text-ink-900 text-[10px] font-mono uppercase tracking-wider hover:bg-white transition-colors disabled:opacity-40"
              >
                {creatingTeam ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>

          {/* Team detail */}
          <div className="col-span-2">
            {loading ? (
              <div className="animate-pulse space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-14 bg-white/5" />)}
              </div>
            ) : !activeTeam ? (
              <div className="border border-dashed border-white/10 py-16 text-center">
                <Users size={24} className="text-ink-700 mx-auto mb-3" />
                <div className="text-sm text-ink-500">Create a team to get started</div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Team header */}
                <div>
                  <h2 className="text-lg font-medium text-ink-50">{activeTeam.name}</h2>
                  <div className="text-[10px] font-mono text-ink-600 mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</div>
                </div>

                {/* Invite */}
                <div className="border border-white/5 p-5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mb-3">Invite member</div>
                  <div className="flex gap-2">
                    <input
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && invite()}
                      placeholder="colleague@firm.com"
                      className="flex-1 bg-ink-850 border border-white/10 text-xs text-ink-100 px-3 py-2 focus:outline-none focus:border-white/25"
                    />
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as any)}
                      className="bg-ink-850 border border-white/10 text-xs text-ink-300 px-2 py-2 focus:outline-none"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      onClick={invite}
                      disabled={inviting || !inviteEmail.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 bg-ink-50 text-ink-900 text-[10px] font-mono uppercase tracking-wider hover:bg-white transition-colors disabled:opacity-40"
                    >
                      <Mail size={10} />
                      {inviting ? 'Sending...' : 'Invite'}
                    </button>
                  </div>
                  {inviteSuccess && <div className="text-[10px] font-mono text-signal-clean mt-2">{inviteSuccess}</div>}
                </div>

                {/* Members list */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-ink-600 mb-3">Members</div>
                  <div className="space-y-0 border border-white/5">
                    {members.map(m => {
                      const rc = ROLE_CONFIG[m.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.member;
                      const RoleIcon = rc.icon;
                      return (
                        <div key={m.id} className="flex items-center gap-4 px-4 py-3 border-b border-white/5 last:border-b-0">
                          <div className="w-7 h-7 rounded-full bg-ink-700 flex items-center justify-center text-[10px] font-bold text-ink-200 shrink-0">
                            {(m.invitedEmail || m.userId || '?')[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-ink-200">{m.invitedEmail || m.userId}</div>
                            {m.status === 'invited' && <div className="text-[9px] font-mono text-ink-600">Invite pending</div>}
                          </div>
                          <div className={`flex items-center gap-1 text-[9px] font-mono ${rc.color}`}>
                            <RoleIcon size={10} />
                            {rc.label}
                          </div>
                          {m.role !== 'owner' && (
                            <button onClick={() => removeMember(m.id)} className="text-ink-700 hover:text-signal-critical transition-colors">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
