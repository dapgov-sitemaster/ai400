"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  createApplicationsCsv,
  formatApplicationFieldLabel,
} from "../../lib/application-csv";

type Upload = {
  id: string;
  kind: string;
  name: string;
  type: string;
};

type Application = {
  data: Record<string, unknown>;
  enrollmentStatus: "not_enrolled" | "enrolled";
  reference: string | null;
  submitted: string;
  uploads: Upload[];
};

type DashboardResponse = {
  applications: Application[];
  total: number;
  page: number;
  pageSize: number;
  adminEmail: string;
};

type Lockout = {
  id: string;
  key: string;
  failures: number;
  lastAttempt: string;
  lockedUntil: string;
};

function formatAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatAnswer).join(", ");
  if (typeof value === "string" || typeof value === "number") {
    return String(value) || "—";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return JSON.stringify(value);
  return "—";
}

function errorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

export default function Dashboard() {
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [lockouts, setLockouts] = useState<Lockout[]>([]);
  const [lockoutError, setLockoutError] = useState("");
  const [releasing, setReleasing] = useState<string | null>(null);
  const [updatingEnrollment, setUpdatingEnrollment] = useState<string | null>(null);
  const [deletingApplication, setDeletingApplication] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadLockouts = useCallback(async () => {
    const response = await fetch("/api/admin/lockouts", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(errorMessage(payload, "Unable to load blocked sign-ins."));
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("lockouts" in payload) ||
      !Array.isArray(payload.lockouts)
    ) {
      throw new Error("Invalid blocked sign-ins response.");
    }
    setLockouts(payload.lockouts as Lockout[]);
    setLockoutError("");
  }, []);

  const load = useCallback(async (nextPage: number, nextQuery: string) => {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (nextQuery) params.set("q", nextQuery);
    const response = await fetch(`/api/admin/applications?${params}`, {
      cache: "no-store",
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 401) setDashboard(null);
      throw new Error(errorMessage(payload, "Unable to load applications."));
    }
    setDashboard(payload as DashboardResponse);
    setPage(nextPage);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/applications?page=1", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return null;
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(errorMessage(payload, "Unable to load dashboard."));
        }
        return payload as DashboardResponse;
      })
      .then((payload) => {
        if (!active || !payload) return;
        setDashboard(payload);
        void loadLockouts().catch((reason: unknown) => {
          if (active) {
            setLockoutError(
              reason instanceof Error
                ? reason.message
                : "Unable to load blocked sign-ins.",
            );
          }
        });
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load dashboard.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [loadLockouts]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Unable to sign in."));
      }
      setLoginPassword("");
      setSearch("");
      setQuery("");
      await load(1, "");
      await loadLockouts();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to sign in.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function releaseLockout(key: string) {
    setReleasing(key);
    setLockoutError("");
    try {
      const response = await fetch("/api/admin/lockouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Unable to release this sign-in lockout."),
        );
      }
      await loadLockouts();
    } catch (reason) {
      setLockoutError(
        reason instanceof Error
          ? reason.message
          : "Unable to release this sign-in lockout.",
      );
    } finally {
      setReleasing(null);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/logout", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out.");
      setDashboard(null);
      setLoginPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    setBusy(true);
    setError("");
    try {
      setSearch(nextQuery);
      await load(1, nextQuery);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to search applications.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changePage(nextPage: number) {
    setBusy(true);
    setError("");
    try {
      await load(nextPage, search);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load applications.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateEnrollment(
    application: Application,
    enrollmentStatus: "not_enrolled" | "enrolled",
  ) {
    if (!application.reference) {
      setError("This application does not have a submission reference.");
      return;
    }

    setUpdatingEnrollment(application.reference);
    setError("");
    try {
      const response = await fetch("/api/admin/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: application.reference,
          enrollmentStatus,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Unable to update enrollment status."),
        );
      }
      setDashboard((current) =>
        current
          ? {
              ...current,
              applications: current.applications.map((item) =>
                item.reference === application.reference
                  ? { ...item, enrollmentStatus }
                  : item,
              ),
            }
          : current,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update enrollment status.",
      );
    } finally {
      setUpdatingEnrollment(null);
    }
  }

  async function deleteApplication(application: Application) {
    if (!application.reference) {
      setError("This application does not have a submission reference.");
      return;
    }

    const applicantName =
      formatAnswer(application.data.name) || "this applicant";
    const confirmed = window.confirm(
      `Permanently delete ${applicantName} (${application.reference}) and any uploaded documents? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingApplication(application.reference);
    setError("");
    try {
      const response = await fetch("/api/admin/applications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: application.reference }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Unable to delete this application."),
        );
      }

      const warning =
        payload &&
        typeof payload === "object" &&
        "warning" in payload &&
        typeof payload.warning === "string"
          ? payload.warning
          : "";
      const currentTotal = dashboard?.total ?? 0;
      const pageSize = dashboard?.pageSize ?? 25;
      const nextTotal = Math.max(0, currentTotal - 1);
      const nextPageCount = Math.max(
        1,
        Math.ceil(nextTotal / pageSize),
      );
      const nextPage = Math.min(page, nextPageCount);
      if (nextPage !== page) {
        await load(nextPage, search);
      } else {
        setDashboard((current) =>
          current
            ? {
                ...current,
                applications: current.applications.filter(
                  (item) => item.reference !== application.reference,
                ),
                total: nextTotal,
              }
            : current,
        );
      }
      if (warning) setError(warning);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to delete this application.",
      );
    } finally {
      setDeletingApplication(null);
    }
  }

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportApplication(application: Application) {
    const reference = application.reference ?? "submission";
    downloadCsv(
      createApplicationsCsv([application]),
      `ai402-${reference}.csv`,
    );
  }

  async function exportApplications(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (exportFrom) params.set("from", exportFrom);
      if (exportTo) params.set("to", exportTo);
      const response = await fetch(
        `/api/admin/applications/export?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const payload: unknown = await response.json();
        throw new Error(errorMessage(payload, "Unable to export applications."));
      }
      const blob = await response.blob();
      const period = [exportFrom, exportTo].filter(Boolean).join("-to-") || "all";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai402-applications-${period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to export applications.",
      );
    } finally {
      setExporting(false);
    }
  }

  const pageCount = dashboard
    ? Math.max(1, Math.ceil(dashboard.total / dashboard.pageSize))
    : 1;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link href="/" className="admin-brand">
          AI 402 <span>Application Portal</span>
        </Link>
        {dashboard && (
          <button
            className="admin-button admin-button-secondary"
            type="button"
            onClick={signOut}
            disabled={busy}
          >
            Sign out
          </button>
        )}
      </header>

      {!dashboard ? (
        <section className="admin-login">
          <p className="admin-eyebrow">STAFF ACCESS</p>
          <h1>Admin sign in</h1>
          <p>Sign in to review submitted AI 402 applications.</p>
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                maxLength={254}
                required
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
            </label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button
              className="admin-button"
              type="submit"
              disabled={busy}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      ) : (
        <section className="admin-content">
          <div className="admin-title-row">
            <div>
              <p className="admin-eyebrow">PRIVATE STAFF AREA</p>
              <h1>Applicant dashboard</h1>
              <p>Signed in as {dashboard.adminEmail}</p>
            </div>
            <div className="admin-total">
              <strong>{dashboard.total}</strong>
              <span>submitted applications</span>
            </div>
          </div>

          <section className="admin-lockouts" aria-labelledby="lockouts-heading">
            <div className="admin-lockouts-heading">
              <div>
                <h2 id="lockouts-heading">Blocked sign-ins</h2>
                <p>
                  Five failed attempts from the same network within one minute
                  trigger a one-minute lock. Entries expire automatically.
                </p>
              </div>
              <button
                className="admin-button admin-button-secondary"
                type="button"
                disabled={releasing !== null}
                onClick={() => {
                  void loadLockouts().catch((reason: unknown) => {
                    setLockoutError(
                      reason instanceof Error
                        ? reason.message
                        : "Unable to load blocked sign-ins.",
                    );
                  });
                }}
              >
                Refresh
              </button>
            </div>
            {lockoutError && (
              <p className="admin-error" role="alert">{lockoutError}</p>
            )}
            {lockouts.length === 0 ? (
              <p className="admin-lockouts-empty">No networks are currently locked out.</p>
            ) : (
              <div className="admin-lockouts-list">
                {lockouts.map((lockout) => (
                  <div className="admin-lockout-row" key={lockout.key}>
                    <div>
                      <strong>Network {lockout.id}</strong>
                      <span>
                        {lockout.failures} failed attempts · unlocks{" "}
                        {new Date(lockout.lockedUntil).toLocaleTimeString(
                          "en-PH",
                          { timeZone: "Asia/Manila" },
                        )}
                      </span>
                    </div>
                    <button
                      className="admin-button admin-button-secondary"
                      type="button"
                      disabled={releasing !== null}
                      onClick={() => void releaseLockout(lockout.key)}
                    >
                      {releasing === lockout.key ? "Releasing…" : "Release lock"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <form className="admin-export" onSubmit={exportApplications}>
            <div>
              <h2>Export submitted applications</h2>
              <p>Choose an optional submission-date range. Leave both dates blank to export all submissions.</p>
            </div>
            <div className="admin-export-controls">
              <label>
                From
                <input
                  type="date"
                  value={exportFrom}
                  max={exportTo || undefined}
                  onChange={(event) => setExportFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={exportTo}
                  min={exportFrom || undefined}
                  onChange={(event) => setExportTo(event.target.value)}
                />
              </label>
              <button
                className="admin-button"
                type="submit"
                disabled={exporting}
              >
                {exporting ? "Preparing CSV…" : "Export all to CSV"}
              </button>
            </div>
          </form>

          <form className="admin-search" onSubmit={submitSearch}>
            <label htmlFor="application-search">Search submissions</label>
            <div>
              <input
                id="application-search"
                type="search"
                maxLength={100}
                placeholder="Name, email, agency, or reference"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="admin-button" type="submit" disabled={busy}>
                Search
              </button>
            </div>
          </form>

          {error && <p className="admin-error" role="alert">{error}</p>}
          {dashboard.applications.length === 0 ? (
            <div className="admin-empty">
              {search
                ? "No submitted applications match that search."
                : "There are no submitted applications yet."}
            </div>
          ) : (
            <div className="admin-applications">
              {dashboard.applications.map((application) => (
                <article
                  className="admin-application"
                  key={application.reference ?? application.submitted}
                >
                  <div className="admin-application-heading">
                    <details className="admin-application-details">
                      <summary>
                        <span>
                          <strong>
                            {formatAnswer(application.data.name) ||
                              "Unnamed applicant"}
                          </strong>
                          <small>
                            {formatAnswer(application.data.agency)} ·{" "}
                            {formatAnswer(application.data.email)}
                          </small>
                        </span>
                        <span className="admin-reference">
                          {application.reference ?? "Submitted"}
                        </span>
                      </summary>
                    <p className="admin-submitted">
                      Submitted{" "}
                      {new Date(application.submitted).toLocaleString(
                        "en-PH",
                        { timeZone: "Asia/Manila" },
                      )}{" "}
                      (Philippine time)
                    </p>
                    <dl className="admin-answers">
                      {Object.entries(application.data).map(([key, value]) => (
                        <div key={key}>
                          <dt>{formatApplicationFieldLabel(key)}</dt>
                          <dd>{formatAnswer(value)}</dd>
                        </div>
                      ))}
                    </dl>
                      {application.uploads.length > 0 && (
                        <div className="admin-documents">
                          <h2>Supporting documents</h2>
                          {application.uploads.map((upload) => (
                            <a
                              key={upload.id}
                              href={`/api/admin/upload?id=${encodeURIComponent(upload.id)}`}
                            >
                              {upload.name} <span>Download</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </details>
                    <div className="admin-enrollment">
                      <span
                        className={`admin-enrollment-badge ${application.enrollmentStatus === "enrolled" ? "is-enrolled" : "is-not-enrolled"}`}
                        role="status"
                      >
                        {application.enrollmentStatus === "enrolled"
                          ? "Enrolled"
                          : "Not enrolled"}
                      </span>
                      <button
                        className={`admin-button ${application.enrollmentStatus === "enrolled" ? "admin-button-secondary" : "admin-button-enrolled"}`}
                        type="button"
                        disabled={
                          !application.reference ||
                          updatingEnrollment !== null
                        }
                        onClick={() =>
                          void updateEnrollment(
                            application,
                            application.enrollmentStatus === "enrolled"
                              ? "not_enrolled"
                              : "enrolled",
                          )
                        }
                      >
                        {updatingEnrollment === application.reference
                          ? "Updating…"
                          : application.enrollmentStatus === "enrolled"
                            ? "Mark not enrolled"
                            : "Mark enrolled"}
                      </button>
                      <button
                        className="admin-button admin-button-secondary"
                        type="button"
                        onClick={() => exportApplication(application)}
                      >
                        Export CSV
                      </button>
                      <button
                        className="admin-button admin-button-danger"
                        type="button"
                        disabled={
                          !application.reference ||
                          deletingApplication !== null
                        }
                        onClick={() => void deleteApplication(application)}
                      >
                        {deletingApplication === application.reference
                          ? "Deleting…"
                          : "Delete"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {pageCount > 1 && (
            <nav className="admin-pagination" aria-label="Application pages">
              <button
                className="admin-button admin-button-secondary"
                type="button"
                disabled={busy || page <= 1}
                onClick={() => changePage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {pageCount}
              </span>
              <button
                className="admin-button admin-button-secondary"
                type="button"
                disabled={busy || page >= pageCount}
                onClick={() => changePage(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </main>
  );
}
