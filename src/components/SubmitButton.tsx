"use client";

import { useFormStatus } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

/**
 * Issue 46 — Submit button with feedback. While the form's server action runs it
 * disables itself (no double submit) and shows a "working…" label, so an action
 * no longer looks like "nothing happened". Drop it inside any `<form action={…}>`
 * in place of a plain submit button; it reads the form's pending state via
 * `useFormStatus`.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "primary",
  style,
}: {
  children: ReactNode;
  /** Label shown while pending; falls back to the normal children. */
  pendingLabel?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} style={style}>
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
