export function googleCalendarOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() &&
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()
  );
}

export function googleCalendarOAuthSettings(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null {
  if (!googleCalendarOAuthConfigured()) return null;
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!.trim(),
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI!.trim(),
  };
}
