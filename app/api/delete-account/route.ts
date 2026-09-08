import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Account deletion is not configured.' }, { status: 500 });
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return NextResponse.json({ error: 'Your session is no longer valid.' }, { status: 401 });

  // Storage objects do not automatically cascade when an auth user is deleted.
  // Himothy stores log photos as <user-id>/<log-id>.<ext>, so remove that folder first.
  const { data: objects, error: listError } = await admin.storage.from('log-images').list(user.id, { limit: 1000 });
  if (listError) return NextResponse.json({ error: `Could not remove account photos: ${listError.message}` }, { status: 500 });

  if (objects?.length) {
    const paths = objects.filter((object) => object.name).map((object) => `${user.id}/${object.name}`);
    if (paths.length) {
      const { error: removeError } = await admin.storage.from('log-images').remove(paths);
      if (removeError) return NextResponse.json({ error: `Could not remove account photos: ${removeError.message}` }, { status: 500 });
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
