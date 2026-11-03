import { useEffect, useMemo, useState } from 'react';
import {
  GAME_IDS,
  GAME_META,
  LIMITS,
  SPECIAL_AWARD_TYPES,
  defaultConfig,
  normalizeConfig,
  totalCommitmentCents,
  validateConfig,
  type Currency,
  type GameId,
  type PayoutStructure,
  type SpecialAwardType,
  type TournamentConfig,
} from '@shared/client';
import { ApiError, get, patch, post } from '../lib/api';
import { navigate } from '../lib/router';
import { STRUCTURE, money } from '../lib/format';
import { toast } from '../lib/toast';
import { Button, Field, Segmented, Stepper, TextInput, Toggle, fieldStyles } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { GameMark } from '../ui/GameMark';
import { Loading, Note, Page, PageHead, Plate, Section, Spec } from '../ui/layout';
import s from './screens.module.css';

const STEPS = ['Basics', 'Prizes', 'Stages', 'Timing', 'Review'] as const;
const STEP_OF = (field: string): number => {
  if (/^(title|entry\.visibility|entry\.maxPlayers)/.test(field)) return 0;
  if (/^(payout|currency|specialAwards|entry\.late)/.test(field)) return 1;
  if (/^(stages|games|gameSettings)/.test(field)) return 2;
  if (/^(timer|invite)/.test(field)) return 3;
  return 4;
};
const SYMBOL: Record<Currency, string> = { USD: '$', EUR: '€', GBP: '£', PTS: '' };

function MoneyInput({ label, cents, currency, onChange, error, hint }: { label: string; cents: number; currency: Currency; onChange: (c: number) => void; error?: string | null; hint?: string }) {
  const [text, setText] = useState(cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : '');
  useEffect(() => {
    const parsed = Math.round(parseFloat(text || '0') * 100);
    if (parsed !== cents) setText(cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <TextInput
      label={label}
      inputMode="decimal"
      prefix={SYMBOL[currency] || undefined}
      placeholder="0"
      value={text}
      hint={hint ?? (currency === 'PTS' ? 'Points' : undefined)}
      error={error}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        setText(v);
        const c = Math.round(parseFloat(v || '0') * 100);
        onChange(Number.isFinite(c) ? c : 0);
      }}
    />
  );
}

function randomLineup(n: number, pool: readonly GameId[]): GameId[] {
  const out: GameId[] = [];
  for (let i = 0; i < n; i++) {
    const options = pool.filter((g) => g !== out[i - 1]);
    out.push(options[Math.floor(Math.random() * options.length)] ?? pool[0]);
  }
  return out;
}

export function CreateScreen({ editId }: { editId?: string }) {
  const [cfg, setCfg] = useState<TournamentConfig>(() => ({ ...defaultConfig(), title: '' }));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(!editId);
  const [serverErr, setServerErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    get<{ config: TournamentConfig; isSponsor: boolean; tournament: { status: string } }>(`/api/tournaments/${editId}`)
      .then((r) => {
        if (!r.isSponsor || r.tournament.status !== 'LOBBY') {
          toast('Settings are locked for this tournament.', 'error');
          navigate(`/t/${editId}`, { replace: true });
          return;
        }
        const c = r.config;
        if (c.games.selection === 'RANDOM' && c.games.pool.length === 0) c.games.pool = [...GAME_IDS];
        if (!c.entry.lateEntry) c.entry.lateEntryUntilStage = Math.min(5, c.stages);
        setCfg(c);
        setLoaded(true);
      })
      .catch((e) => {
        toast((e as ApiError).message, 'error');
        navigate('/sponsor', { replace: true });
      });
  }, [editId]);

  const set = (f: (c: TournamentConfig) => void) =>
    setCfg((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as TournamentConfig;
      f(next);
      return next;
    });

  const normalized = useMemo(() => normalizeConfig(cfg), [cfg]);
  const errors = useMemo(() => validateConfig(normalized), [normalized]);
  const errFor = (field: string) => (touched.has(STEP_OF(field)) ? (errors.find((e) => e.field === field || e.field.startsWith(field + '.'))?.message ?? null) : null);
  const stepErrors = (i: number) => errors.filter((e) => STEP_OF(e.field) === i);
  const total = totalCommitmentCents(normalized);
  const lineupGames: GameId[] = cfg.games.selection === 'MANUAL' ? cfg.games.manual : cfg.games.pool;

  // keep manual lineup length in sync with stage count
  useEffect(() => {
    if (cfg.games.selection !== 'MANUAL') return;
    if (cfg.games.manual.length === cfg.stages) return;
    set((c) => {
      const m = c.games.manual.slice(0, c.stages);
      while (m.length < c.stages) m.push(GAME_IDS[m.length % GAME_IDS.length]);
      c.games.manual = m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.stages, cfg.games.selection]);

  const go = (to: number) => {
    setTouched((t) => new Set([...t, step]));
    if (to > step && stepErrors(step).length) {
      toast(stepErrors(step)[0].message, 'error');
      return;
    }
    setStep(to);
    window.scrollTo(0, 0);
  };

  const submit = async () => {
    setTouched(new Set([0, 1, 2, 3, 4]));
    if (errors.length) {
      setStep(STEP_OF(errors[0].field));
      toast(errors[0].message, 'error');
      return;
    }
    setBusy(true);
    setServerErr(null);
    try {
      if (editId) {
        await patch(`/api/tournaments/${editId}/config`, { config: normalized });
        toast('Settings saved. Players see the new version now.', 'good');
        navigate(`/t/${editId}`);
      } else {
        const r = await post<{ id: string }>('/api/tournaments', { config: normalized });
        navigate(`/t/${r.id}`);
      }
    } catch (e) {
      setServerErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Loading />;

  return (
    <Page>
      <PageHead title={editId ? 'Edit tournament' : 'New tournament'} />
      <div className={s.wizard}>
        <div>
          <div className={s.steps} aria-hidden>
            {STEPS.map((_, i) => (
              <div key={i} className={`${s.stepPip} ${i <= step ? s.stepPipOn : ''}`} />
            ))}
          </div>
          <p className={s.stepLabel} style={{ marginTop: 8 }}>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </div>

        {step === 0 && (
          <div className={s.formGrid}>
            <TextInput label="Tournament name" value={cfg.title} maxLength={LIMITS.titleMax} placeholder="Friday Night Elimination" onChange={(e) => set((c) => void (c.title = e.target.value))} error={errFor('title')} />
            <Field label="Who can find it">
              <Segmented
                label="Visibility"
                value={cfg.entry.visibility}
                onChange={(v) => set((c) => void (c.entry.visibility = v))}
                options={[
                  { value: 'PRIVATE', label: 'Invite only' },
                  { value: 'PUBLIC', label: 'Listed publicly' },
                ]}
              />
            </Field>
            <Field label="Player cap" hint={`${LIMITS.minPlayersToStart}–${LIMITS.maxPlayers} competitors.`} error={errFor('entry.maxPlayers')}>
              <Stepper label="player cap" value={cfg.entry.maxPlayers} min={LIMITS.minPlayersToStart} max={LIMITS.maxPlayers} step={cfg.entry.maxPlayers >= 20 ? 5 : 1} onChange={(v) => set((c) => void (c.entry.maxPlayers = v))} />
            </Field>
            <Toggle checked={cfg.entry.hostCompetes} onChange={(v) => set((c) => void (c.entry.hostCompetes = v))} label="I’m competing too" hint="Off: you host and watch, and you can’t win your own prizes." />
          </div>
        )}

        {step === 1 && (
          <div className={s.formGrid}>
            <Field label="Currency">
              <Segmented label="Currency" value={cfg.currency} onChange={(v) => set((c) => void (c.currency = v))} options={(['USD', 'EUR', 'GBP', 'PTS'] as Currency[]).map((c) => ({ value: c, label: c === 'PTS' ? 'Points' : c }))} />
            </Field>
            <Field label="Payout structure">
              <div className={s.structPick} role="radiogroup" aria-label="Payout structure">
                {(['PER_STAGE', 'MOST_WINS', 'HYBRID'] as PayoutStructure[]).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={cfg.payout.structure === p} className={s.structOpt} onClick={() => set((c) => void (c.payout.structure = p))}>
                    <i className={s.radioDot} aria-hidden />
                    <div>
                      <b>{STRUCTURE[p].label}</b>
                      <span>{STRUCTURE[p].describe}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Field>
            {cfg.payout.structure !== 'MOST_WINS' && (
              <MoneyInput label="Award per stage winner" cents={cfg.payout.stageAwardCents} currency={cfg.currency} onChange={(v) => set((c) => void (c.payout.stageAwardCents = v))} error={errFor('payout.stageAwardCents')} hint={`× ${cfg.stages} stages = ${money(cfg.payout.stageAwardCents * cfg.stages, cfg.currency)}. A shared stage win splits it.`} />
            )}
            {cfg.payout.structure !== 'PER_STAGE' && (
              <MoneyInput label="Final award (most stage wins)" cents={cfg.payout.finalAwardCents} currency={cfg.currency} onChange={(v) => set((c) => void (c.payout.finalAwardCents = v))} error={errFor('payout.finalAwardCents')} hint="Players level on stage wins, outright wins and rounds survived split it." />
            )}
            <Toggle
              checked={cfg.entry.lateEntry && cfg.payout.structure === 'PER_STAGE'}
              disabled={cfg.payout.structure !== 'PER_STAGE'}
              onChange={(v) => set((c) => {
                c.entry.lateEntry = v;
                if (v && c.entry.lateEntryUntilStage < 2) c.entry.lateEntryUntilStage = Math.min(5, c.stages);
              })}
              label="Allow late entry"
              hint={cfg.payout.structure === 'PER_STAGE' ? 'Late players compete from the next stage and can’t win earlier stage awards.' : 'Only available with Per stage winner payouts.'}
            />
            {cfg.entry.lateEntry && cfg.payout.structure === 'PER_STAGE' && (
              <Field label="Late entry closes when stage … starts" error={errFor('entry.lateEntryUntilStage')}>
                <Stepper label="late-entry cutoff stage" value={cfg.entry.lateEntryUntilStage} min={2} max={cfg.stages} onChange={(v) => set((c) => void (c.entry.lateEntryUntilStage = v))} />
              </Field>
            )}
            <Section title="Special awards" aside={`${cfg.specialAwards.length} of ${LIMITS.maxSpecialAwards}`}>
              <div style={{ display: 'grid', gap: 8 }}>
                {cfg.specialAwards.map((a, i) => (
                  <div className={s.award} key={a.id}>
                    <div className={s.awardHead}>
                      <select
                        className={fieldStyles.input}
                        aria-label="Award criteria"
                        value={a.type}
                        onChange={(e) => set((c) => {
                          const t = e.target.value as SpecialAwardType;
                          c.specialAwards[i].type = t;
                          c.specialAwards[i].label = SPECIAL_AWARD_TYPES[t].label;
                          if (t === 'STAGE_N') c.specialAwards[i].stage = c.specialAwards[i].stage ?? Math.ceil(c.stages / 2);
                        })}
                      >
                        {(Object.keys(SPECIAL_AWARD_TYPES) as SpecialAwardType[]).map((t) => (
                          <option key={t} value={t}>
                            {SPECIAL_AWARD_TYPES[t].label}: {SPECIAL_AWARD_TYPES[t].describe(a.stage)}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" icon="close" aria-label="Remove award" onClick={() => set((c) => void c.specialAwards.splice(i, 1))} />
                    </div>
                    <div className={s.two}>
                      <TextInput label="Name" value={a.label} maxLength={40} onChange={(e) => set((c) => void (c.specialAwards[i].label = e.target.value))} />
                      <MoneyInput label="Amount" cents={a.amountCents} currency={cfg.currency} onChange={(v) => set((c) => void (c.specialAwards[i].amountCents = v))} />
                    </div>
                    {a.type === 'STAGE_N' && (
                      <Field label="Stage">
                        <Stepper label="award stage" value={a.stage ?? 1} min={1} max={cfg.stages} onChange={(v) => set((c) => void (c.specialAwards[i].stage = v))} />
                      </Field>
                    )}
                    <p style={{ fontSize: 14, color: 'var(--dust)' }}>{SPECIAL_AWARD_TYPES[a.type].describe(a.stage)} Ties split the amount.</p>
                    {errFor(`specialAwards.${i}`) && <p className={fieldStyles.error}>{errFor(`specialAwards.${i}`)}</p>}
                  </div>
                ))}
                {cfg.specialAwards.length < LIMITS.maxSpecialAwards && (
                  <Button
                    icon="plus"
                    onClick={() => set((c) => void c.specialAwards.push({ id: `award-${Date.now().toString(36)}`, type: 'FIRST_STAGE', label: SPECIAL_AWARD_TYPES.FIRST_STAGE.label, amountCents: 500 }))}
                  >
                    Add a special award
                  </Button>
                )}
                <Note>Award criteria are stored with the tournament and can’t change once the countdown starts.</Note>
              </div>
            </Section>
          </div>
        )}

        {step === 2 && (
          <div className={s.formGrid}>
            <Field label="Tournament stages" hint={`${LIMITS.minStages}–${LIMITS.maxStages}. Each stage is one game; a game can run several rounds inside its stage.`} error={errFor('stages')}>
              <Stepper label="stages" value={cfg.stages} min={LIMITS.minStages} max={LIMITS.maxStages} onChange={(v) => set((c) => {
                c.stages = v;
                if (c.entry.lateEntryUntilStage > v) c.entry.lateEntryUntilStage = v;
              })} />
            </Field>
            <Field label="Game selection">
              <Segmented
                label="Game selection"
                value={cfg.games.selection}
                onChange={(v) => set((c) => {
                  c.games.selection = v;
                  if (v === 'RANDOM' && c.games.pool.length === 0) c.games.pool = [...GAME_IDS];
                  if (v === 'MANUAL' && c.games.manual.length !== c.stages) c.games.manual = randomLineup(c.stages, GAME_IDS);
                })}
                options={[
                  { value: 'RANDOM', label: 'Random' },
                  { value: 'MANUAL', label: 'Pick each stage' },
                ]}
              />
            </Field>
            {cfg.games.selection === 'RANDOM' ? (
              <Field label="Games the server may draw" hint="The server builds the lineup when you create the tournament. Players see each game when its stage starts." error={errFor('games.pool')}>
                <div className={s.poolGrid}>
                  {GAME_IDS.map((g) => {
                    const on = cfg.games.pool.includes(g);
                    return (
                      <button key={g} type="button" role="checkbox" aria-checked={on} className={s.poolItem} onClick={() => set((c) => void (c.games.pool = on ? c.games.pool.filter((x) => x !== g) : [...c.games.pool, g]))}>
                        <GameMark id={g} size={32} />
                        <span>
                          <b style={{ fontWeight: 600 }}>{GAME_META[g].name}</b>
                          <br />
                          <span style={{ fontSize: 13, color: 'var(--dust)' }}>{GAME_META[g].tagline}</span>
                        </span>
                        <span className={s.checkBox}>{on && <Icon name="check" size={16} />}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : (
              <Field label="Lineup" error={errFor('games.manual')}>
                <div className={s.stageList}>
                  {cfg.games.manual.map((g, i) => (
                    <div className={s.stageItem} key={i}>
                      <span className={s.stageNo}>{i + 1}</span>
                      <GameMark id={g} size={30} />
                      <select className={fieldStyles.input} aria-label={`Stage ${i + 1} game`} value={g} onChange={(e) => set((c) => void (c.games.manual[i] = e.target.value as GameId))}>
                        {GAME_IDS.map((id) => (
                          <option key={id} value={id}>
                            {GAME_META[id].name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <Button size="sm" icon="shuffle" onClick={() => set((c) => void (c.games.manual = randomLineup(c.stages, GAME_IDS)))}>
                  Shuffle a lineup
                </Button>
              </Field>
            )}
            {lineupGames.includes('zero-hour') && (
              <Field label="Zero Hour target" hint="The target is this percentage of the average submitted number." error={errFor('gameSettings.zeroHourPercent')}>
                <Stepper label="Zero Hour percentage" unit="%" value={cfg.gameSettings.zeroHourPercent} min={10} max={100} onChange={(v) => set((c) => void (c.gameSettings.zeroHourPercent = v))} />
              </Field>
            )}
          </div>
        )}

        {step === 3 && (
          <div className={s.formGrid}>
            <p style={{ color: 'var(--dust)' }}>Every stage draws its own round timer between these two values. The server keeps time; nobody’s connection can stretch it.</p>
            <div className={s.two}>
              <Field label="Shortest" error={errFor('timer.minSeconds')}>
                <Stepper label="minimum seconds" unit="s" value={cfg.timer.minSeconds} min={LIMITS.minTimer} max={LIMITS.maxTimer} onChange={(v) => set((c) => {
                  c.timer.minSeconds = v;
                  if (c.timer.maxSeconds < v) c.timer.maxSeconds = v;
                })} />
              </Field>
              <Field label="Longest" error={errFor('timer.maxSeconds')}>
                <Stepper label="maximum seconds" unit="s" value={cfg.timer.maxSeconds} min={LIMITS.minTimer} max={LIMITS.maxTimer} onChange={(v) => set((c) => {
                  c.timer.maxSeconds = v;
                  if (c.timer.minSeconds > v) c.timer.minSeconds = v;
                })} />
              </Field>
            </div>
            <Field label="Invite link expires after">
              <Segmented label="Invite expiry" value={cfg.invite.expiresInHours} onChange={(v) => set((c) => void (c.invite.expiresInHours = v))} options={LIMITS.inviteHours.map((h) => ({ value: h, label: h >= 24 ? `${h / 24}d` : `${h}h` }))} />
            </Field>
            <Field label="Invite uses" hint="How many players can join with one link. Make a new link any time from the lobby." error={errFor('invite.maxUses')}>
              <Stepper label="invite uses" value={cfg.invite.maxUses} min={1} max={LIMITS.maxInviteUses} step={cfg.invite.maxUses >= 20 ? 5 : 1} onChange={(v) => set((c) => void (c.invite.maxUses = v))} />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className={s.formGrid}>
            <Plate>
              <div className={s.reviewBlock}>
                <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 'var(--t-2xl)', textTransform: 'uppercase' }}>{normalized.title || 'Untitled'}</h2>
                <Spec
                  items={[
                    ['Visibility', normalized.entry.visibility === 'PUBLIC' ? 'Listed publicly' : 'Invite only'],
                    ['Players', `Up to ${normalized.entry.maxPlayers}${normalized.entry.hostCompetes ? ', you included' : ', you host only'}`],
                    ['Payout', STRUCTURE[normalized.payout.structure].label],
                    ...(normalized.payout.structure !== 'MOST_WINS' ? ([['Per stage', money(normalized.payout.stageAwardCents, normalized.currency)]] as [string, string][]) : []),
                    ...(normalized.payout.structure !== 'PER_STAGE' ? ([['Final award', money(normalized.payout.finalAwardCents, normalized.currency)]] as [string, string][]) : []),
                    ['Late entry', normalized.entry.lateEntry ? `Open until stage ${normalized.entry.lateEntryUntilStage} starts` : 'Closed at start'],
                    ['Stages', String(normalized.stages)],
                    ['Games', normalized.games.selection === 'RANDOM' ? `Random from ${normalized.games.pool.length} game${normalized.games.pool.length === 1 ? '' : 's'}` : 'Picked per stage'],
                    ['Round timer', `${normalized.timer.minSeconds}–${normalized.timer.maxSeconds}s, drawn per stage`],
                    ['Invite', `${normalized.invite.maxUses} uses, expires after ${normalized.invite.expiresInHours >= 24 ? `${normalized.invite.expiresInHours / 24} day(s)` : `${normalized.invite.expiresInHours} hour(s)`}`],
                    ...(lineupGames.includes('zero-hour') ? ([['Zero Hour', `${normalized.gameSettings.zeroHourPercent}% of the average`]] as [string, string][]) : []),
                  ]}
                />
                {normalized.games.selection === 'MANUAL' && (
                  <div className={s.stageList}>
                    {normalized.games.manual.map((g, i) => (
                      <div className={s.stageItem} key={i}>
                        <span className={s.stageNo}>{i + 1}</span>
                        <GameMark id={g} size={26} />
                        <span>{GAME_META[g].name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {normalized.specialAwards.length > 0 && (
                  <Spec items={normalized.specialAwards.map((a) => [a.label, `${money(a.amountCents, normalized.currency)} — ${SPECIAL_AWARD_TYPES[a.type].describe(a.stage)}`] as [string, string])} />
                )}
                <div className={s.totalLine}>
                  <span>Total prize commitment</span>
                  <b>{money(total, normalized.currency)}</b>
                </div>
              </div>
            </Plate>
            {errors.length > 0 && (
              <ul className={s.errorList}>
                {errors.map((e) => (
                  <li key={e.field + e.message}>
                    <button type="button" style={{ background: 'none', border: 0, color: 'inherit', textDecoration: 'underline', padding: 0 }} onClick={() => setStep(STEP_OF(e.field))}>
                      {e.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {serverErr && <p className={fieldStyles.error} role="alert">{serverErr}</p>}
            <Note>You’re committing to pay these prizes yourself, outside this app. The platform records the commitment and calculates who it goes to.</Note>
          </div>
        )}
      </div>

      <div className={s.wizBar}>
        <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)} icon="back" aria-label="Back" />
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => go(step + 1)}>
            Next: {STEPS[step + 1]}
          </Button>
        ) : (
          <Button variant="primary" busy={busy} onClick={submit} disabled={errors.length > 0}>
            {editId ? 'Save settings' : 'Create tournament'}
          </Button>
        )}
      </div>
    </Page>
  );
}
