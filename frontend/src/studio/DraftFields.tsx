import {
  useLayoutEffect,
  useState,
  type ComponentPropsWithRef,
  type TextareaHTMLAttributes,
} from "react";

/** Keep intermediate typing local; validated project snapshots never contain partial numbers. */
export function DraftInput(props: ComponentPropsWithRef<"input">) {
  const [draft, setDraft] = useState(String(props.value ?? ""));
  useLayoutEffect(() => setDraft(String(props.value ?? "")), [props.value]);
  if (
    props.value === undefined ||
    ["file", "range", "checkbox", "color"].includes(props.type ?? "")
  )
    return <input {...props} />;
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() !== "") props.onChange?.(e);
      }}
      onBlur={(e) => {
        setDraft(String(props.value ?? ""));
        props.onBlur?.(e);
      }}
    />
  );
}
export function DraftTextarea({
  allowEmpty = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { allowEmpty?: boolean }) {
  const [draft, setDraft] = useState(String(props.value ?? ""));
  useLayoutEffect(() => setDraft(String(props.value ?? "")), [props.value]);
  return (
    <textarea
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (allowEmpty || e.target.value.trim() !== "") props.onChange?.(e);
      }}
      onBlur={(e) => {
        setDraft(String(props.value ?? ""));
        props.onBlur?.(e);
      }}
    />
  );
}
