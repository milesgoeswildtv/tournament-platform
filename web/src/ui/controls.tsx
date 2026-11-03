import { useId, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Link } from '../lib/router';
import { audio } from '../lib/audio';
import s from './controls.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Inline CSS custom properties (e.g. a game's accent) with regular style props. */
export const vars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  busy?: boolean;
  icon?: IconName;
  to?: string;
}

export function Button({ variant = 'secondary', size = 'md', block, busy, icon, to, className, children, onClick, disabled, type, ...rest }: BtnProps) {
  const cls = cx(s.btn, s[variant], size !== 'md' && s[size], block && s.block, busy && s.busy, className);
  const content = (
    <>
      {icon && <Icon name={icon} size={size === 'lg' ? 24 : 20} />}
      {children}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls} onClick={() => audio.play('tap')}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={(e) => {
        audio.unlock();
        onClick?.(e);
      }}
      {...rest}
    >
      {content}
    </button>
  );
}

export function IconButton({ icon, label, badge, pressed, onClick, to, className }: { icon: IconName; label: string; badge?: number; pressed?: boolean; onClick?: () => void; to?: string; className?: string }) {
  const inner = (
    <>
      <Icon name={icon} />
      {badge ? <span className={s.badge}>{badge > 9 ? '9+' : badge}</span> : null}
    </>
  );
  if (to)
    return (
      <Link to={to} className={cx(s.iconBtn, className)} aria-label={label} title={label}>
        {inner}
      </Link>
    );
  return (
    <button type="button" className={cx(s.iconBtn, className)} aria-label={label} title={label} aria-pressed={pressed} onClick={() => { audio.unlock(); onClick?.(); }}>
      {inner}
    </button>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className={s.error} role="alert">{error}</p> : hint ? <p className={s.hint}>{hint}</p> : null}
    </div>
  );
}

export function TextInput({ label, hint, error, className, code, mono, prefix, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; code?: boolean; mono?: boolean; prefix?: string }) {
  const id = useId();
  const input = <input id={id} className={cx(s.input, code && s.codeInput, mono && s.monoInput, className)} aria-invalid={error ? true : undefined} {...rest} />;
  const wrapped = prefix ? (
    <div className={s.prefixWrap}>
      <span className={s.prefix}>{prefix}</span>
      {input}
    </div>
  ) : (
    input
  );
  if (!label) return wrapped;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      {wrapped}
    </Field>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label, disabled, scroll }: { options: { value: T; label: ReactNode; disabled?: boolean }[]; value: T; onChange: (v: T) => void; label: string; disabled?: boolean; scroll?: boolean }) {
  return (
    <div className={cx(s.seg, scroll && s.segScroll)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          className={s.segBtn}
          onClick={() => {
            audio.play('tap');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={s.toggle} disabled={disabled} onClick={() => { audio.play('tap'); onChange(!checked); }}>
      <span className={s.toggleText}>
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </span>
      <span className={s.switch} aria-hidden />
    </button>
  );
}

export function Stepper({ value, min, max, step = 1, onChange, unit, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; label: string }) {
  const set = (v: number) => {
    audio.play('tap');
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <div className={s.stepper} role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - step)}>
        <Icon name="minus" />
      </button>
      <output className={s.stepValue} aria-live="polite">
        <span>
          {value}
          {unit && <small> {unit}</small>}
        </span>
      </output>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => set(value + step)}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export const fieldStyles = s;
export { cx };
