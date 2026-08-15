import { useState } from "react";

/** Where the token is remembered between visits. */
const STORAGE_KEY = "stl-manager-token";

/** Reads a previously accepted token, if there is one. */
export function readStoredToken(): string | undefined {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === null || stored === "" ? undefined : stored;
}

/** Forgets the stored token. */
export function clearStoredToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Asks for the server's access token.
 *
 * Deliberately not a login: there are no accounts. The token is printed once
 * in the server's log on first start, and clearing this field is how you log
 * out.
 */
export function TokenGate({ onAccepted }: { onAccepted: (token: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async (): Promise<void> => {
    const token = value.trim();
    if (token === "") {
      setError("Paste the token from the server's log.");
      return;
    }
    const response = await fetch("/api/roots", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setError("That token was not accepted.");
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, token);
    onAccepted(token);
  };

  const errorNote = error === undefined ? null : <p className="text-accent mt-4 text-sm">{error}</p>;

  return (
    <div className="mx-auto max-w-2xl px-10 pt-24">
      <p className="text-muted text-xs tracking-[0.2em] uppercase">STL Manager</p>
      <h1 className="font-serif mt-3 text-5xl leading-tight">Access token</h1>
      <p className="text-muted mt-4 max-w-prose">
        The server printed a token to its log when it first started. Paste it here once and this
        browser will remember it.
      </p>
      <input
        value={value}
        autoFocus
        aria-label="Access token"
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void submit();
          }
        }}
        className="border-border focus:border-accent mt-8 w-full border-b bg-transparent pb-2 font-mono text-sm focus:outline-none"
      />
      {errorNote}
      <button
        type="button"
        onClick={() => void submit()}
        className="bg-primary text-background hover:bg-text mt-8 rounded-md px-4 py-2 text-sm"
      >
        Continue
      </button>
    </div>
  );
}
