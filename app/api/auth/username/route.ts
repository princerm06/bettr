import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const USERNAME_RE = /^[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Username authentication is not configured.' },
      { status: 500 }
    );
  }

  let body: {
    mode?: 'signin' | 'signup';
    username?: string;
    password?: string;
    displayName?: string;
    recoveryEmail?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const mode = body.mode;
  const username = (body.username || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

  const password = body.password || '';
  const displayName = (body.displayName || '').trim();
  const recoveryEmail = (body.recoveryEmail || '').trim().toLowerCase();

  if (mode !== 'signin' && mode !== 'signup') {
    return NextResponse.json(
      { error: 'Invalid authentication mode.' },
      { status: 400 }
    );
  }

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'Use a valid 3–30 character username.' },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters.' },
      { status: 400 }
    );
  }

  if (recoveryEmail && !EMAIL_RE.test(recoveryEmail)) {
    return NextResponse.json(
      { error: 'Enter a valid email address or leave it blank.' },
      { status: 400 }
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  if (mode === 'signup') {
    if (!displayName) {
      return NextResponse.json(
        { error: 'Add your name.' },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json(
        {
          error: `@${username} is already taken.`,
          code: 'username_taken',
        },
        { status: 409 }
      );
    }

    /*
      Supabase Auth still needs an email-shaped identifier internally.
      Himothy users never see or enter this address.
      No confirmation email is sent.
    */
    const internalEmail = `${randomUUID()}@accounts.himothy.invalid`;

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          username,
        },
      });

    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message || 'Could not create account.' },
        { status: 400 }
      );
    }

    const userId = created.user.id;

    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: userId,
        display_name: displayName,
        username,
        recovery_email: recoveryEmail || null,
        recovery_email_verified: false,
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      await admin.auth.admin.deleteUser(userId);

      if (profileError.code === '23505') {
        return NextResponse.json(
          {
            error: `@${username} is already taken.`,
            code: 'username_taken',
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: profileError.message },
        { status: 500 }
      );
    }

    const { data: sessionData, error: signInError } =
      await authClient.auth.signInWithPassword({
        email: internalEmail,
        password,
      });

    if (signInError || !sessionData.session) {
      return NextResponse.json(
        {
          error:
            signInError?.message ||
            'Account created, but sign in failed.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    });
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: profileError.message },
      { status: 500 }
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: 'Incorrect username or password.' },
      { status: 401 }
    );
  }

  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(profile.id);

  const internalEmail = userData.user?.email;

  if (userError || !internalEmail) {
    return NextResponse.json(
      { error: 'Incorrect username or password.' },
      { status: 401 }
    );
  }

  const { data: sessionData, error: signInError } =
    await authClient.auth.signInWithPassword({
      email: internalEmail,
      password,
    });

  if (signInError || !sessionData.session) {
    return NextResponse.json(
      { error: 'Incorrect username or password.' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  });
}
