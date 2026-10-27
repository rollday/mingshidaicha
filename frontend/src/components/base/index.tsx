/**
 * 基础件：Card / Button / Segmented / Tag / Field / Table
 * 依据：设计稿 v2.5 交接包 03-基础件规范.md + theme.css
 * 规则：不出现十六进制色值；圆角只用 rounded-sm/md/lg/full；字号只用 text-2xs/xs/sm/base/lg。
 *
 * 少量任意值说明（仅两处，均为描边/尺寸，无 token 可替代）：
 *   border-[1.5px]  稿件里上传区与“待确认”卡片的描边就是 1.5px
 *   其余尺寸一律换算成间距倍数（4px 基准）。
 */
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/* ────────────────────────────── Tag ────────────────────────────── */

export type Tone = "red" | "amber" | "green" | "blue" | "neutral" | "low";

const TAG_TONE: Record<Tone, string> = {
  red: "bg-red/10 text-red",
  amber: "bg-amber-bg text-amber",
  green: "bg-green/10 text-green",
  blue: "bg-blue/10 text-blue",
  neutral: "bg-canvas text-mute",
  low: "bg-low-bg text-low",
};

export function Tag({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-medium ${TAG_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ────────────────────────────── Card ───────────────────────────── */

type Padding = "none" | "md" | "lg" | "wide";
type CardVariant = "default" | "accordion" | "dropzone";

const PAD: Record<Padding, string> = {
  none: "",
  md: "p-6",
  lg: "p-7",
  wide: "px-7 py-6",
};

const INSET_TONE: Record<Tone, string> = {
  neutral: "bg-canvas px-4 py-3",
  amber: "border border-amber-line/50 bg-amber-bg/50 p-4",
  red: "border border-red/25 bg-red/5 px-3 py-3",
  green: "border border-green/25 bg-green/5 px-3 py-3",
  blue: "border border-blue/25 bg-blue/5 px-3 py-3",
  low: "border border-low/25 bg-low-bg px-3 py-3 text-low",
};

export function Card({
  as: As = "div",
  padding = "md",
  variant = "default",
  inset = false,
  tone = "neutral",
  overflowX = false,
  className = "",
  children,
  ...rest
}: {
  as?: ElementType;
  padding?: Padding;
  variant?: CardVariant;
  inset?: boolean;
  tone?: Tone;
  overflowX?: boolean;
  className?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<"div">) {
  if (inset) {
    return (
      <As className={`rounded-md ${INSET_TONE[tone]} ${className}`} {...rest}>
        {children}
      </As>
    );
  }

  const base =
    variant === "accordion"
      ? "bg-surface border border-line rounded-lg overflow-hidden"
      : variant === "dropzone"
        ? "rounded-lg border-[1.5px] border-dashed border-line-strong bg-canvas px-6 py-9"
        : `bg-surface border border-line rounded-lg ${PAD[padding]}`;

  return (
    <As
      className={`box-border ${base} ${overflowX ? "overflow-x-auto" : ""} ${className}`}
      {...rest}
    >
      {children}
    </As>
  );
}

/** 03 §1.3 的 accordion 变体：头是整行按钮，体用 unfold 动画展开 */
export function AccordionCard({
  title,
  open,
  onToggle,
  dense = false,
  children,
  className = "",
}: {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  dense?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card variant="accordion" padding="none" className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-3 border-0 bg-surface text-left ${
          dense ? "min-h-14 px-5 py-3" : "min-h-16 px-6 py-4"
        }`}
      >
        <span className="text-lg font-medium">{title}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`ml-auto shrink-0 transition-transform duration-300 ease-spring ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open ? <div className="animate-unfold px-5 pb-5">{children}</div> : null}
    </Card>
  );
}

/* ───────────────────────────── Button ──────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "sample" | "chip" | "seg" | "text";

const BTN: Record<ButtonVariant, string> = {
  primary: "min-h-12 px-7 rounded-md bg-ink text-surface text-base font-medium hover:bg-ink-soft",
  secondary:
    "min-h-11 px-5 rounded-md border border-line-strong bg-surface text-ink text-base hover:border-ink",
  sample:
    "flex flex-col items-start justify-start gap-0.5 text-left p-4 rounded-md border border-line bg-surface hover:border-blue hover:-translate-y-0.5 hover:shadow-lift duration-500",
  chip:
    "min-h-10 px-4 rounded-full border border-line-strong bg-surface text-ink text-sm hover:border-ink",
  seg: "min-h-9 min-w-18 px-4 rounded-full text-sm text-ink-soft",
  text: "inline p-0 border-0 bg-transparent text-inherit border-b border-dashed border-line-strong cursor-help",
};

const BTN_DISABLED: Record<ButtonVariant, string> = {
  primary: "bg-line text-mute",
  secondary: "border-line text-mute",
  sample: "border-line text-mute",
  chip: "border-line text-mute",
  seg: "text-mute",
  text: "",
};

export function Button({
  variant = "secondary",
  block = false,
  loading = false,
  pressed,
  disabled = false,
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  block?: boolean;
  loading?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"button">, "disabled">) {
  const active = !disabled && !loading && variant !== "text" ? "active:scale-[.96]" : "";
  const off = disabled || loading;

  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={off}
      className={[
        "inline-flex cursor-pointer items-center justify-center font-sans",
        "transition-transform duration-300 ease-spring",
        BTN[variant],
        off ? `${BTN_DISABLED[variant]} cursor-not-allowed` : active,
        pressed && (variant === "chip" || variant === "seg")
          ? "border-ink bg-ink font-medium text-surface"
          : "",
        block ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ───────────────────────────── Segmented ───────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const width = 100 / options.length;

  return (
    <div
      role="group"
      className={`relative inline-flex rounded-full bg-line p-1 ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full bg-surface shadow-thumb transition-transform duration-500 ease-thumb"
        style={{ width: `calc(${width}% - 4px)`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <Button
          key={o.value}
          variant="seg"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 min-w-18 ${o.value === value ? "font-medium text-ink" : ""}`}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/* ────────────────────────────── Field ─────────────────────────── */

export function Field({
  suffix,
  className = "",
  children,
}: {
  suffix?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 focus-within:border-blue focus-within:shadow-focus ${className}`}
    >
      {children}
      {suffix ? <span className="shrink-0 text-sm text-mute">{suffix}</span> : null}
    </label>
  );
}

export const fieldInputClass =
  "w-full border-0 bg-transparent text-base text-ink outline-none num";

/* ────────────────────────────── Table ─────────────────────────── */

export type Column = { key: string; label: string; align?: "left" | "right" };

type PlainRow = Record<string, ReactNode>;

export function Table({
  variant = "plain",
  label,
  columns = [],
  rows = [],
  className = "",
}: {
  variant?: "plain" | "kv" | "findings" | "source";
  label?: string;
  columns?: Column[];
  rows?: PlainRow[];
  className?: string;
}) {
  if (variant === "kv") {
    return (
      <dl className={`grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-base num ${className}`}>
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <dt className="text-mute">{r.label}</dt>
            <dd className="text-right font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (variant === "findings") {
    return (
      <div className={`text-sm ${className}`} aria-label={label}>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[26_1fr_auto] items-start gap-x-4 gap-y-1 border-t border-line py-3">
            <button type="button" className="text-left text-mute underline-offset-2 hover:underline">
              {r.source}
            </button>
            <span className="text-ink">{r.result}</span>
            <Tag tone={(r.tone as Tone) ?? "neutral"}>{r.status}</Tag>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "source") {
    return (
      <div className={`overflow-hidden rounded-md border border-line text-sm ${className}`}>
        <div className="bg-canvas px-4 py-3 font-medium">{label}</div>
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between gap-3 border-t border-line px-4 py-3">
            <span className={r.muted ? "text-mute" : "text-ink"}>{r.label}</span>
            <span className={r.muted ? "text-mute" : "text-ink"}>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <table className={`w-full border-collapse text-sm ${className}`} aria-label={label}>
      <thead>
        <tr className="text-left text-mute">
          {columns.map((c) => (
            <th key={c.key} className={`py-2 pr-4 font-normal ${c.align === "right" ? "text-right" : ""}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            {columns.map((c, ci) => (
              <td
                key={c.key}
                className={[
                  "py-3 text-ink",
                  ci === columns.length - 1 ? "pr-0" : "pr-4",
                  c.align === "right" ? "text-right num" : "",
                ].join(" ")}
              >
                {r[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type { Padding, CardVariant };
