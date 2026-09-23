'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type CalendarStatus = {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  syncEnabled: boolean;
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
          <p className="calendarConnectCopy">Sync: Off</p>
          <div className="securityActions">
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
    </section>
  );
}
