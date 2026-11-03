import { useState, type FormEvent } from 'react';
import { ApiError, get, post, useSession, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { navigate } from '../lib/router';
import { STRUCTURE, money, plural, prizeLine, until } from '../lib/format';
import { Button, TextInput } from '../ui/controls';
import { Chip, Empty, Loading, Note, Page, PageHead, Plate, Rows, Section, Spec } from '../ui/layout';
import { TournamentRow } from './HubScreen';
import { toast } from '../lib/toast';
import s from './screens.module.css';

export function JoinScreen() {
  const [code, setCode] = useState('');
  const pub = useLoad(() => get<{ tournaments: TournamentSummary[] }>('/api/tournaments?scope=public'));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) navigate(`/j/${c}`);
  };
  const open = (pub.data?.tournaments ?? []).filter((t) => t.status !== 'FINISHED');
  return (
    <Page>
      <PageHead title="Join" lede="Got an invite code from a sponsor? Enter it to see the tournament before you join." />
      <form className={s.codeForm} onSubmit={submit}>
        <TextInput
          label="Invite code"
          code
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ABCD2345"
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          hint="8 characters. Letters and numbers, no O, 0, I or 1."
        />
        <Button type="submit" variant="primary" size="lg" block disabled={code.trim().length < 6}>
          Look up invite
        </Button>
      </form>
      <Section title="Open to everyone">
        {pub.loading && !pub.data ? (
          <Loading />
        ) : open.length ? (
          <Rows>
            {open.map((t) => (
              <TournamentRow key={t.id} t={t} mine={false} />
            ))}
          </Rows>
        ) : (
          <Empty title="No public tournaments right now">Private tournaments only show up with an invite link.</Empty>
        )}
      </Section>
    </Page>
  );
}

interface InviteInfo {
  valid: boolean;
  reason: string | null;
  invite: { code: string; expiresAt: number; remaining: number };
  tournament: TournamentSummary | null;
}

const REASON: Record<string, string> = {
  invite_expired: 'This invite has expired. Ask the sponsor for a new link.',
  invite_used_up: 'This invite has no uses left. Ask the sponsor for a new link.',
  invite_revoked: 'This invite was replaced by a newer one. Ask the sponsor for the current link.',
  tournament_closed: 'This tournament is already over.',
};

export function InviteScreen({ code }: { code: string }) {
  const session = useSession();
  const info = useLoad(() => get<InviteInfo>(`/api/invites/${encodeURIComponent(code)}`), [code]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (info.loading && !info.data) return <Loading label="Checking invite" />;
  if (info.error) {
    return (
      <Page>
        <PageHead title="Invite not found" lede={info.error.status === 404 ? `No invite uses the code ${code.toUpperCase()}. Check the code and try again.` : info.error.message} />
        <Button to="/join" variant="secondary">
          Enter a different code
        </Button>
      </Page>
    );
  }
  const d = info.data!;
  const t = d.tournament;
  const next = encodeURIComponent(`/j/${code}`);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ tournamentId: string; eligibleFrom: number; already: boolean }>('/api/join', { code });
      if (r.eligibleFrom > 1) toast(`You’re in. You can compete from stage ${r.eligibleFrom}.`, 'good');
      navigate(`/t/${r.tournamentId}`);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className={s.invite}>
        <Chip tone={d.valid ? 'info' : 'stop'}>{d.valid ? `Invite ${d.invite.code}` : 'Invite unavailable'}</Chip>
        <h1 className={s.inviteTitle}>{t?.title ?? 'Tournament'}</h1>
        {t && (
          <Plate>
            <Spec
              items={[
                ['Sponsor', t.sponsor.name ?? 'Unknown'],
                ['Prizes', prizeLine(t)],
                ['Payout', STRUCTURE[t.structure].label],
                ['Committed', money(t.commitmentCents, t.currency)],
                ['Stages', `${t.stages}${t.selection === 'RANDOM' ? ', random games' : ''}`],
                ['Timer', `${t.timer.minSeconds}–${t.timer.maxSeconds}s per round`],
                ['Players', `${t.players} of ${t.maxPlayers}`],
                ['Status', t.status === 'RUNNING' ? `Live, stage ${t.currentStage}${t.lateEntry ? ' (late entry open)' : ''}` : t.status === 'LOBBY' ? 'Lobby open' : t.status.toLowerCase()],
                ...(d.valid ? ([['Invite', `Expires in ${until(d.invite.expiresAt)}, ${plural(d.invite.remaining, 'use')} left`]] as [string, string][]) : []),
              ]}
            />
          </Plate>
        )}
        {!d.valid && <p className={s.inviteBad}>{REASON[d.reason ?? ''] ?? 'This invite can’t be used.'}</p>}
        {err && <p className={s.inviteBad} role="alert">{err}</p>}
        {d.valid &&
          (session ? (
            <Button variant="primary" size="lg" block busy={busy} onClick={join}>
              Join tournament
            </Button>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <Button variant="primary" size="lg" block to={`/auth?mode=signup&next=${next}`}>
                Create account to join
              </Button>
              <Button variant="secondary" block to={`/auth?next=${next}`}>
                I have an account
              </Button>
            </div>
          ))}
        <Note>Prize amounts are commitments made by the sponsor. This app records and calculates them; it does not hold or pay out money.</Note>
      </div>
    </Page>
  );
}
