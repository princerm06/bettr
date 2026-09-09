import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Account security is not configured.' },
      { status: 500 }
    );
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';

  if (!token) {
    return NextResponse.json(
      { error: 'Not authenticated.' },
      { status: 401 }
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } =
    await admin.auth.getUser(token);

  const user = userData.user;

  if (userError || !user) {
    return NextResponse.json(
      { error: 'Your session is no longer valid.' },
      { status: 401 }
    );
  }

  let body: { recoveryEmail?: string | null };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request.' },
      { status: 400 }
    );
  }

  const email =
    typeof body.recoveryEmail === 'string'
      ? body.recoveryEmail.trim().toLowerCase()
      : '';

  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address.' },
      { status: 400 }
    );
  }

  if (email) {
    const { data: existing, error: existingError } = await admin
      .from('profiles')
      .select('id')
      .ilike('recovery_email', email)
      .neq('id', user.id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json(
        { error: 'That email is already connected to another Bettr account.' },
        { status: 409 }
      );
    }
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({
      recovery_email: email || null,
      recovery_email_verified: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    recoveryEmail: email || '',
    verified: false,
  });
}
