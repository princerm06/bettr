'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type CalendarStatus = {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  syncEnabled: boolean;
  hasDedicatedCalendar: boolean;
  lastError: string | null;
};

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function GoogleCalendarSettings() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testOccurrenceId, setTestOccurrenceId] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState('');

  async function refresh() {
    const token = await accessToken();
    if (!token) return;
    const response = await fetch('/api/calendar/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as CalendarStatus & {
      error?: string;
    };
    if (!response.ok) {
      setError(payload.error || 'Could not load calendar status.');
      return;
    }
    setStatus({
      configured: Boolean(payload.configured),
      connected: Boolean(payload.connected),
      googleEmail: payload.googleEmail ?? null,
      syncEnabled: Boolean(payload.syncEnabled),
      hasDedicatedCalendar: Boolean(payload.hasDedicatedCalendar),
      lastError: payload.lastError ?? null,
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const token = await accessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch('/api/calendar/google/start', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Could not start Google Calendar connect.');
      }
      window.location.href = payload.url;
    } catch (caught) {
      setBusy(false);
      setError(
        caught instanceof Error ? caught.message : 'Could not start Google Calendar connect.'
      );
    }
  }

  async function projectTestOccurrence() {
    setTestBusy(true);
    setTestResult('');
    try {
      const token = await accessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch('/api/calendar/project-occurrence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ occurrenceId: testOccurrenceId.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        result?: string;
        googleEventId?: string | null;
        reason?: string | null;
        error?: string;
      };
      const result = payload.result || payload.error || 'error';
      const parts = [result];
      if (payload.googleEventId) parts.push(payload.googleEventId);
      if (payload.reason) parts.push(payload.reason);
      setTestResult(parts.join(' · '));
    } catch (caught) {
      setTestResult(
        caught instanceof Error ? caught.message : 'error'
      );
    } finally {
      setTestBusy(false);
    }
  }

  async function setSyncEnabled(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const token = await accessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reason?: string | null;
      };
      if (!response.ok) {
        throw new Error(
          payload.reason || payload.error || 'Could not update calendar sync.'
        );
      }
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not update calendar sync.'
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      const token = await accessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch('/api/calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Could not disconnect Google Calendar.');
      }
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not disconnect Google Calendar.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="securitySettingCard">
      <div className="securitySettingTop">
        <div>
          <strong>Google Calendar</strong>
          <p>
            Optional copy of your Bettr plan. Google does not create Logs, award
            XP, or change your plan.
          </p>
        </div>
        <span
          className={`emailStatus ${
            status?.connected ? 'verified' : 'empty'
          }`}
        >
          {status?.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {status?.connected ? (
        <>
          <p className="calendarConnectCopy">
            Google Calendar connected
            {status.googleEmail ? ` · ${status.googleEmail}` : ''}
          </p>
          {status.syncEnabled ? (
            <p className="calendarConnectCopy">
              Automatic copy is on. Your plan appears on a Bettr calendar in
              Google Calendar.
            </p>
          ) : null}
          <p className="calendarConnectCopy">
            Sync: {status.syncEnabled ? 'On' : 'Off'}
          </p>
          {status.lastError ? (
            <p className="calendarConnectCopy">{status.lastError}</p>
          ) : null}
          <div className="securityActions">
            {status.syncEnabled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setSyncEnabled(false)}
              >
                {busy ? 'Updating…' : 'Turn off'}
              </button>
            ) : (
              <button
                type="button"
                className="primaryButton"
                disabled={busy}
                onClick={() => void setSyncEnabled(true)}
              >
                {busy ? 'Updating…' : 'Turn on'}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <div className="securityActions">
          <button
            type="button"
            className="primaryButton"
            disabled={busy || !status || status.configured === false}
            onClick={() => void connect()}
          >
            {busy ? 'Connecting…' : 'Connect Google Calendar'}
          </button>
        </div>
      )}

      {status?.configured === false && (
        <p className="calendarConnectCopy">
          Calendar connect is not configured on this server.
        </p>
      )}

      {error && <div className="securityError">{error}</div>}

      {process.env.NODE_ENV !== 'production' && (
        <div className="securityEmailField">
          Development test — not shown in production
          <strong>Test occurrence projection</strong>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Occurrence UUID"
            value={testOccurrenceId}
            onChange={(event) => setTestOccurrenceId(event.target.value)}
            disabled={testBusy}
          />
          <div className="securityActions">
            <button
              type="button"
              disabled={testBusy || !testOccurrenceId.trim()}
              onClick={() => void projectTestOccurrence()}
            >
              {testBusy ? 'Projecting…' : 'Project occurrence'}
            </button>
          </div>
          {testResult && (
            <p className="calendarConnectCopy">{testResult}</p>
          )}
        </div>
      )}
    </section>
  );
}
