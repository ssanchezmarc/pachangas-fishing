"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Issue 45 — "Type your access code" form on the home: navigates to /c/{code},
 * which resolves the code to its private competition. Complements the shareable
 * /c/{code} link.
 */
export function AccessCodeForm({
  labels,
}: {
  labels: { placeholder: string; submit: string };
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim();
        if (c) router.push(`/c/${encodeURIComponent(c)}`);
      }}
      style={{ display: "flex", gap: "0.5rem", maxWidth: 360 }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={labels.placeholder}
        style={{ flex: 1 }}
      />
      <button className="tab" type="submit">
        {labels.submit}
      </button>
    </form>
  );
}
