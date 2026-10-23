import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import type { Editor, EditorState } from "../editor";
export interface PanelProps {
  editor: Editor;
  state: EditorState;
}
export function Button({
  action,
  onClick,
  children,
  disabled = false,
  ...props
}: { action?: string; onClick: () => void; children: ReactNode } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
>) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
export function Range({
  id,
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  disabled,
  format = String,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  format?: (n: number) => string;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span>
        {label}
        <output id={id + "Out"}>{format(value)}</output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </label>
  );
}
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 0.1,
  onCommit,
  disabled,
  onError,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (n: number) => void;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 10000) / 10000));
  const cancelled = useRef(false);
  useEffect(() => {
    setDraft(String(Math.round(value * 10000) / 10000));
  }, [value]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const number = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(number) ||
      number < min ||
      number > max
    ) {
      setDraft(String(value));
      onError(`${label}必须在 ${min}–${max} 之间`);
      return;
    }
    if (number !== value) onCommit(number);
  };
  return (
    <label className="number-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
