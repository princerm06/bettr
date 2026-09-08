from pathlib import Path
import re

page = Path("app/page.tsx")
css = Path("app/globals.css")
migration = Path("supabase/v6_4_social_threads.sql")

if not page.exists():
    raise SystemExit("Run this from the himothy-app project root. app/page.tsx was not found.")

s = page.read_text()

# 1) Extend comment + notification types
s = re.sub(
    r"type SocialComment = \{[^;]*?id: string;[^}]*?\};",
    '''type SocialComment = {
  id: string;
  log_id: string;
  user_id: string;
  body: string | null;
  parent_comment_id: string | null;
  image_path: string | null;
  created_at: string;
};''',
    s,
    count=1,
    flags=re.S,
)

s = s.replace(
    "type: 'friend_request' | 'comment';",
    "type: 'friend_request' | 'comment' | 'reply';",
    1,
)

# 2) Notification panel state
anchor = "  const [unreadNotifications, setUnreadNotifications] = useState(0);"
if anchor not in s:
    raise SystemExit("Could not find v6.3 unreadNotifications state. Make sure v6.3 is applied first.")
s = s.replace(
    anchor,
    anchor + "\n  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);",
    1,
)

# 3) Replace bell behavior with dropdown
bell_pattern = re.compile(
    r'''\{supabaseConfigured && user && \(
\s*<button
\s*className="notificationBell"
\s*aria-label="Activity"
\s*title="Activity"
\s*onClick=\{\(\) => \{
\s*setAccountOpen\(false\);
\s*setTab\('activity'\);
\s*\}\}
\s*>
\s*<Bell size=\{18\}/>
\s*\{unreadNotifications > 0 && \(
\s*<span>\{unreadNotifications > 99 \? '99\+' : unreadNotifications\}</span>
\s*\)\}
\s*</button>
\s*\)\}''',
    re.S,
)

bell_replacement = '''{supabaseConfigured && user && (
            <div className="notificationControl">
              <button
                className={`notificationBell ${notificationPanelOpen ? 'open' : ''}`}
                aria-label="Notifications"
                title="Notifications"
                onClick={() => {
                  setAccountOpen(false);
                  setNotificationPanelOpen((open) => !open);
                }}
              >
                <Bell size={18}/>
                {unreadNotifications > 0 && (
                  <span>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>
                )}
              </button>

              {notificationPanelOpen && (
                <NotificationPanel
                  user={user}
                  onUnreadChange={setUnreadNotifications}
                  onClose={() => setNotificationPanelOpen(false)}
                  onViewAll={() => {
                    setNotificationPanelOpen(false);
                    setTab('activity');
                  }}
                  onOpenFriends={() => {
                    setNotificationPanelOpen(false);
                    setTab('friends');
                  }}
                />
              )}
            </div>
          )}'''

s, n = bell_pattern.subn(bell_replacement, s, count=1)
if n != 1:
    raise SystemExit("Could not replace the v6.3 notification bell block.")

s = s.replace(
    'onClick={() => setAccountOpen((value) => !value)}',
    'onClick={() => { setNotificationPanelOpen(false); setAccountOpen((value) => !value); }}',
    1,
)

# 4) Replace ActivityView with threaded version
activity_start = s.find("function ActivityView(")
friends_start = s.find("function FriendsView(")

if activity_start == -1 or friends_start == -1 or friends_start <= activity_start:
    raise SystemExit("Could not locate ActivityView/FriendsView boundaries.")

activity_component = r'''function ActivityView({
  user,
  onUnreadChange,
  onOpenFriends,
}: {
  user: User;
  onUnreadChange: (count: number) => void;
  onOpenFriends: () => void;
}) {
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [visibleLogs, setVisibleLogs] = useState<FeedLog[]>([]);
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [notifications, setNotifications] = useState<HimothyNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshActivity() {
    if (!supabase) return;

    const client = supabase;
    setLoading(true);

    const [
      { data: profileRows, error: profileError },
      { data: logRows, error: logError },
      { data: notificationRows, error: notificationError },
    ] = await Promise.all([
      client.from('profiles').select('id,display_name,username,avatar_url').order('display_name'),
      client.from('logs').select('*').order('created_at', { ascending: false }).limit(100),
      client.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    ]);

    if (profileError || logError || notificationError) {
      setNotice(
        profileError?.message ||
        logError?.message ||
        notificationError?.message ||
        'Could not load activity.'
      );
      setLoading(false);
      return;
    }

    const logs = (logRows || []) as FeedLog[];
    const ids = logs.map((log) => log.id);
    let commentRows: SocialComment[] = [];

    if (ids.length) {
      const { data, error } = await client
        .from('log_comments')
        .select('*')
        .in('log_id', ids)
        .order('created_at', { ascending: true });

      if (error) setNotice(error.message);
      else commentRows = (data || []) as SocialComment[];
    }

    const ns = (notificationRows || []) as HimothyNotification[];

    setProfiles((profileRows || []) as SocialProfile[]);
    setVisibleLogs(logs);
    setComments(commentRows);
    setNotifications(ns);
    onUnreadChange(ns.filter((n) => !n.read_at).length);
    setLoading(false);
  }

  useEffect(() => {
    refreshActivity();
  }, [user.id]);

  const profileFor = (id: string | null) =>
    profiles.find((profile) => profile.id === id);

  const myLogsWithConversation = visibleLogs.filter((log) =>
    log.user_id === user.id && comments.some((comment) => comment.log_id === log.id)
  );

  const commentedLogIds = new Set(
    comments
      .filter((comment) => comment.user_id === user.id)
      .map((comment) => comment.log_id)
  );

  const myCommentedLogs = visibleLogs.filter(
    (log) => log.user_id !== user.id && commentedLogIds.has(log.id)
  );

  async function markNotificationRead(notification: HimothyNotification) {
    if (!supabase || notification.read_at) return;
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notification.id)
      .eq('user_id', user.id);

    if (!error) await refreshActivity();
  }

  async function openNotification(notification: HimothyNotification) {
    await markNotificationRead(notification);
    if (notification.type === 'friend_request') onOpenFriends();
  }

  async function markAllRead() {
    if (!supabase) return;

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null);

    if (error) {
      setNotice(error.message);
      return;
    }

    await refreshActivity();
  }

  function renderThread(log: FeedLog, context: 'mine' | 'commented') {
    const cat = categoryFor(log.category);
    const owner = profileFor(log.user_id);
    const threadComments = comments.filter((comment) => comment.log_id === log.id);

    return (
      <article className="card activityThread" key={`${context}-${log.id}`}>
        <div className="socialFeedTop">
          <div className="feedIcon">{cat.emoji}</div>
          <div>
            <div className="feedHeadline">
              <strong>
                {log.user_id === user.id
                  ? 'You'
                  : owner?.display_name || owner?.username || 'Friend'}
              </strong>
              <span>{cat.short}</span>
            </div>
            <small>{timeAgo(log.created_at)}</small>
          </div>
        </div>

        <h3>{log.activity}</h3>
        {log.details && <p>{log.details}</p>}

        <ThreadedComments
          logId={log.id}
          user={user}
          profiles={profiles}
          comments={threadComments}
          onRefresh={refreshActivity}
        />
      </article>
    );
  }

  return (
    <section className="pageSection activityPage">
      <div className="activityPageHead">
        <div>
          <p className="eyebrow">SOCIAL ACTIVITY</p>
          <h2>Keep up with your circle.</h2>
          <p className="subtitle">
            Comments, replies, photos, and requests without digging through the feed.
          </p>
        </div>

        <button className="textButton" onClick={refreshActivity}>
          Refresh
        </button>
      </div>

      {notice && (
        <div className="socialNotice">
          {notice}
          <button onClick={() => setNotice(null)}>
            <X size={14}/>
          </button>
        </div>
      )}

      <section className="activityNotifications">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">NOTIFICATIONS</p>
            <h2>What needs your attention.</h2>
          </div>

          {notifications.some((n) => !n.read_at) && (
            <button className="textButton" onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>

        <div className="notificationList">
          {notifications.map((notification) => {
            const actor = profileFor(notification.actor_id);
            const actorName =
              actor?.display_name ||
              (actor?.username ? `@${actor.username}` : 'Someone');

            const log = notification.log_id
              ? visibleLogs.find((item) => item.id === notification.log_id)
              : null;

            const label =
              notification.type === 'friend_request'
                ? `${actorName} sent you a friend request`
                : notification.type === 'reply'
                  ? `${actorName} replied to your comment`
                  : `${actorName} commented on your log`;

            return (
              <button
                key={notification.id}
                className={`notificationRow ${notification.read_at ? '' : 'unread'}`}
                onClick={() => openNotification(notification)}
              >
                <div className="notificationIcon">
                  {notification.type === 'friend_request'
                    ? <Users size={17}/>
                    : <MessageCircle size={17}/>}
                </div>

                <div>
                  <strong>{label}</strong>
                  {log && <span>“{log.activity}”</span>}
                  <small>{timeAgo(notification.created_at)}</small>
                </div>

                {!notification.read_at && <i/>}
              </button>
            );
          })}

          {!loading && !notifications.length && (
            <div className="card emptyActivityState">
              <Bell size={21}/>
              <strong>Nothing new.</strong>
              <span>You&apos;re caught up.</span>
            </div>
          )}
        </div>
      </section>

      <div className="activityColumns">
        <section>
          <div className="sectionHead">
            <div>
              <p className="eyebrow">MY LOGS</p>
              <h2>Conversations on your progress.</h2>
              <p>Any of your logs that have comments.</p>
            </div>
          </div>

          <div className="feed">
            {myLogsWithConversation.map((log) => renderThread(log, 'mine'))}

            {!loading && !myLogsWithConversation.length && (
              <div className="card emptyActivityState">
                <MessageCircle size={21}/>
                <strong>No comments yet.</strong>
                <span>Comments on your shared logs will show up here.</span>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="sectionHead">
            <div>
              <p className="eyebrow">MY COMMENTS</p>
              <h2>Threads you joined.</h2>
              <p>Jump back into logs you&apos;ve commented on.</p>
            </div>
          </div>

          <div className="feed">
            {myCommentedLogs.map((log) => renderThread(log, 'commented'))}

            {!loading && !myCommentedLogs.length && (
              <div className="card emptyActivityState">
                <Send size={21}/>
                <strong>No conversations yet.</strong>
                <span>Comment on a friend&apos;s log and it will stay easy to find here.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}


'''

s = s[:activity_start] + activity_component + s[friends_start:]

# 5) Add shared helper + panel + threaded comments before ActivityView
activity_start = s.find("function ActivityView(")

shared_components = r'''function timeAgo(value: string) {
  const then = new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function NotificationPanel({
  user,
  onUnreadChange,
  onClose,
  onViewAll,
  onOpenFriends,
}: {
  user: User;
  onUnreadChange: (count: number) => void;
  onClose: () => void;
  onViewAll: () => void;
  onOpenFriends: () => void;
}) {
  const [items, setItems] = useState<HimothyNotification[]>([]);
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [logs, setLogs] = useState<FeedLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshPanel() {
    if (!supabase) return;

    const [{ data: notifications }, { data: profileRows }, { data: logRows }] =
      await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(8),
        supabase.from('profiles').select('id,display_name,username,avatar_url'),
        supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(100),
      ]);

    const ns = (notifications || []) as HimothyNotification[];
    setItems(ns);
    setProfiles((profileRows || []) as SocialProfile[]);
    setLogs((logRows || []) as FeedLog[]);
    onUnreadChange(ns.filter((item) => !item.read_at).length);
    setLoading(false);
  }

  useEffect(() => {
    refreshPanel();
  }, [user.id]);

  async function markRead(item: HimothyNotification) {
    if (!supabase || item.read_at) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id).eq('user_id', user.id);
  }

  async function markAllRead() {
    if (!supabase) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
    await refreshPanel();
  }

  async function acceptRequest(item: HimothyNotification) {
    if (!supabase || !item.friendship_id) return;
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', item.friendship_id);
    if (!error) {
      await markRead(item);
      await refreshPanel();
    }
  }

  async function declineRequest(item: HimothyNotification) {
    if (!supabase || !item.friendship_id) return;
    const { error } = await supabase.from('friendships').delete().eq('id', item.friendship_id);
    if (!error) {
      await markRead(item);
      await refreshPanel();
    }
  }

  async function openItem(item: HimothyNotification) {
    await markRead(item);
    if (item.type === 'friend_request') onOpenFriends();
    else onViewAll();
  }

  function actorName(id: string | null) {
    const actor = profiles.find((profile) => profile.id === id);
    return actor?.display_name || (actor?.username ? `@${actor.username}` : 'Someone');
  }

  return (
    <div className="notificationPanel card" onClick={(event) => event.stopPropagation()}>
      <div className="notificationPanelHead">
        <div>
          <p className="eyebrow">NOTIFICATIONS</p>
          <h3>What&apos;s new</h3>
        </div>

        <div className="notificationPanelActions">
          {items.some((item) => !item.read_at) && <button onClick={markAllRead}>Mark all read</button>}
          <button className="notificationPanelClose" onClick={onClose} aria-label="Close notifications">
            <X size={15}/>
          </button>
        </div>
      </div>

      <div className="notificationPanelList">
        {items.map((item) => {
          const log = item.log_id ? logs.find((entry) => entry.id === item.log_id) : null;
          const label =
            item.type === 'friend_request'
              ? `${actorName(item.actor_id)} sent you a friend request`
              : item.type === 'reply'
                ? `${actorName(item.actor_id)} replied to your comment`
                : `${actorName(item.actor_id)} commented on your log`;

          return (
            <div className={`notificationPanelRow ${item.read_at ? '' : 'unread'}`} key={item.id}>
              <button className="notificationPanelMain" onClick={() => openItem(item)}>
                <span className="notificationMiniIcon">
                  {item.type === 'friend_request' ? <Users size={15}/> : <MessageCircle size={15}/>}
                </span>
                <span className="notificationPanelCopy">
                  <strong>{label}</strong>
                  {log && <span>“{log.activity}”</span>}
                  <small>{timeAgo(item.created_at)}</small>
                </span>
                {!item.read_at && <i className="notificationUnreadDot"/>}
              </button>

              {item.type === 'friend_request' && item.friendship_id && (
                <div className="notificationRequestActions">
                  <button className="accept" onClick={() => acceptRequest(item)}>Accept</button>
                  <button onClick={() => declineRequest(item)}>Decline</button>
                </div>
              )}
            </div>
          );
        })}

        {!loading && !items.length && (
          <div className="notificationPanelEmpty">
            <Bell size={19}/>
            <strong>You&apos;re caught up.</strong>
            <span>No new notifications.</span>
          </div>
        )}
      </div>

      <button className="notificationViewAll" onClick={onViewAll}>
        View all activity <ChevronRight size={15}/>
      </button>
    </div>
  );
}

function SignedCommentImage({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!supabase) return;
      const { data } = await supabase.storage.from('comment-images').createSignedUrl(path, 60 * 30);
      if (alive) setSrc(data?.signedUrl || null);
    }

    load();
    return () => { alive = false; };
  }, [path]);

  if (!src) return <div className="commentImageLoading">Loading photo…</div>;
  return <img className="commentPhoto" src={src} alt="Comment attachment"/>;
}

function ThreadedComments({
  logId,
  user,
  profiles,
  comments,
  onRefresh,
}: {
  logId: string;
  user: User;
  profiles: SocialProfile[];
  comments: SocialComment[];
  onRefresh: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<SocialComment | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const roots = comments.filter((comment) => !comment.parent_comment_id);

  function profileName(id: string) {
    const profile = profiles.find((item) => item.id === id);
    return profile?.display_name || (profile?.username ? `@${profile.username}` : 'Friend');
  }

  function childrenOf(parentId: string) {
    return comments.filter((comment) => comment.parent_comment_id === parentId);
  }

  async function submit() {
    if (!supabase || posting) return;

    const body = draft.trim();
    if (!body && !imageFile) return;

    setPosting(true);
    let imagePath: string | null = null;

    try {
      if (imageFile) {
        if (!imageFile.type.startsWith('image/')) throw new Error('Please choose an image file.');
        if (imageFile.size > 5 * 1024 * 1024) throw new Error('Comment photos must be 5 MB or smaller.');

        const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        imagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('comment-images')
          .upload(imagePath, imageFile, {
            cacheControl: '3600',
            upsert: false,
            contentType: imageFile.type,
          });

        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.from('log_comments').insert({
        log_id: logId,
        user_id: user.id,
        body: body || null,
        parent_comment_id: replyTo?.id || null,
        image_path: imagePath,
      });

      if (error) {
        if (imagePath) await supabase.storage.from('comment-images').remove([imagePath]);
        throw error;
      }

      setDraft('');
      setReplyTo(null);
      setImageFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not post comment.');
    } finally {
      setPosting(false);
    }
  }

  function renderComment(comment: SocialComment, nested = false) {
    return (
      <div className={`threadComment ${nested ? 'threadReply' : ''}`} key={comment.id}>
        <div className="commentAvatar">
          {(profileName(comment.user_id).replace('@', '').slice(0, 1) || '?').toUpperCase()}
        </div>

        <div className="threadCommentBody">
          <div className="threadCommentMeta">
            <strong>{comment.user_id === user.id ? 'You' : profileName(comment.user_id)}</strong>
            <span>{timeAgo(comment.created_at)}</span>
          </div>

          {comment.body && <p>{comment.body}</p>}
          {comment.image_path && <SignedCommentImage path={comment.image_path}/>}

          <button className="replyButton" onClick={() => setReplyTo(comment)}>Reply</button>

          {childrenOf(comment.id).map((child) => renderComment(child, true))}
        </div>
      </div>
    );
  }

  return (
    <div className="threadedComments">
      <div className="threadedCommentsHead">
        <div>
          <MessageCircle size={14}/>
          <strong>{comments.length}</strong>
          <span>{comments.length === 1 ? 'comment' : 'comments'}</span>
        </div>
      </div>

      <div className="threadCommentList">
        {roots.map((comment) => renderComment(comment))}
      </div>

      {replyTo && (
        <div className="replyingTo">
          <span>Replying to <strong>{replyTo.user_id === user.id ? 'yourself' : profileName(replyTo.user_id)}</strong></span>
          <button onClick={() => setReplyTo(null)}><X size={13}/></button>
        </div>
      )}

      {imageFile && (
        <div className="commentPhotoPreview">
          <ImageIcon size={15}/>
          <span>{imageFile.name}</span>
          <button onClick={() => {
            setImageFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}>
            <X size={13}/>
          </button>
        </div>
      )}

      <div className="threadComposer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => setImageFile(event.target.files?.[0] || null)}
        />

        <button className="commentPhotoButton" onClick={() => fileInputRef.current?.click()} aria-label="Add photo" title="Add photo">
          <ImageIcon size={17}/>
        </button>

        <input
          className="textInput"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={replyTo ? 'Write a reply…' : 'Write a comment…'}
          maxLength={500}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />

        <button className="threadPostButton" onClick={submit} disabled={posting || (!draft.trim() && !imageFile)}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}


'''

s = s[:activity_start] + shared_components + s[activity_start:]

# 6) Replace Friends feed flat comments/composer with threaded component
old_block_pattern = re.compile(
    r'''<div className="commentList">\{logComments\.map\(\(c\)=>\{const author=profiles\.find\(\(p\)=>p\.id===c\.user_id\);return <div key=\{c\.id\}><strong>\{author\?\.display_name\|\|'Friend'\}</strong><span>\{c\.body\}</span></div>\}\)\}</div>
\s*<div className="commentComposer"><input className="textInput" value=\{commentDrafts\[entry\.id\]\|\|''\} onChange=\{\(e\)=>setCommentDrafts\(\(d\)=>\(\{\.\.\.d,\[entry\.id\]:e\.target\.value\}\)\)\} placeholder="Leave some encouragement…" maxLength=\{500\} onKeyDown=\{\(e\)=>\{if\(e\.key==='Enter'\)addComment\(entry\.id\)\}\}/><button onClick=\{\(\)=>addComment\(entry\.id\)\}><Send size=\{16\}/></button></div>''',
    re.S,
)

thread_block = '''<ThreadedComments
          logId={entry.id}
          user={user}
          profiles={profiles}
          comments={logComments}
          onRefresh={refreshSocial}
        />'''

s, n = old_block_pattern.subn(thread_block, s, count=1)
if n != 1:
    raise SystemExit("Could not replace the Friends feed comment block.")

page.write_text(s)

# 7) CSS
styles = r'''
/* v6.4 Social Threads */
.accountCluster{align-items:center}
.cloudBadge{height:42px;min-height:42px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;padding:0 17px;border-radius:999px}
.notificationControl{position:relative;display:flex;align-items:center}
.notificationBell,.avatar{width:42px!important;min-width:42px;height:42px!important;min-height:42px;box-sizing:border-box;border-radius:50%!important}
.notificationBell{border:1px solid #4d5833;background:#1c2117;color:var(--accent)}
.notificationBell:hover,.notificationBell.open{border-color:#758748;background:#242b1b;color:var(--accent)}
.avatar{border:1px solid #4d5833!important;background:#1c2117!important;color:var(--accent)!important}
.notificationPanel{position:absolute;z-index:80;top:52px;right:0;width:min(420px,calc(100vw - 28px));overflow:hidden;padding:0;border-color:#343b2b;box-shadow:0 22px 65px rgba(0,0,0,.48)}
.notificationPanelHead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:17px 17px 13px;border-bottom:1px solid var(--line)}
.notificationPanelHead h3{margin:2px 0 0;font-size:17px}
.notificationPanelActions{display:flex;align-items:center;gap:8px}
.notificationPanelActions>button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:10px;font-weight:800;cursor:pointer}
.notificationPanelClose{width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line)!important;border-radius:8px}
.notificationPanelList{max-height:430px;overflow:auto}
.notificationPanelRow{border-bottom:1px solid var(--line)}
.notificationPanelRow.unread{background:rgba(205,255,57,.025)}
.notificationPanelMain{width:100%;display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:13px 15px;border:0;background:transparent;color:var(--text);text-align:left;cursor:pointer}
.notificationPanelMain:hover{background:#191d19}
.notificationMiniIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#22291c;color:var(--accent)}
.notificationPanelCopy strong,.notificationPanelCopy span,.notificationPanelCopy small{display:block}
.notificationPanelCopy strong{font-size:11px;line-height:1.35}
.notificationPanelCopy span{margin-top:3px;color:#c8cdc3;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notificationPanelCopy small{margin-top:4px;color:var(--muted);font-size:9px}
.notificationUnreadDot{width:7px;height:7px;border-radius:50%;background:#ff5555}
.notificationRequestActions{display:flex;gap:7px;padding:0 15px 12px 59px}
.notificationRequestActions button{border:1px solid var(--line);background:#24282d;color:var(--text);border-radius:8px;padding:6px 10px;font:inherit;font-size:10px;font-weight:800;cursor:pointer}
.notificationRequestActions .accept{border-color:rgba(205,255,57,.36);background:rgba(205,255,57,.10);color:var(--accent)}
.notificationPanelEmpty{display:grid;justify-items:center;padding:27px 16px;color:var(--muted);text-align:center}
.notificationPanelEmpty svg{color:var(--accent);margin-bottom:8px}
.notificationPanelEmpty strong{color:var(--text);font-size:12px}
.notificationPanelEmpty span{margin-top:4px;font-size:10px}
.notificationViewAll{width:100%;display:flex;align-items:center;justify-content:center;gap:5px;padding:13px;border:0;border-top:1px solid var(--line);background:#171b17;color:var(--text);font:inherit;font-size:11px;font-weight:850;cursor:pointer}
.notificationViewAll:hover{color:var(--accent)}
.threadedComments{margin-top:14px;padding-top:13px;border-top:1px solid var(--line)}
.threadedCommentsHead>div{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:10px}
.threadedCommentsHead strong{color:var(--text)}
.threadCommentList{display:grid;gap:11px;margin-top:12px}
.threadComment{display:grid;grid-template-columns:30px 1fr;gap:9px;min-width:0}
.commentAvatar{width:30px;height:30px;display:grid;place-items:center;border:1px solid #48523a;border-radius:50%;background:#1b201a;color:var(--accent);font-size:10px;font-weight:900}
.threadCommentBody{min-width:0}
.threadCommentMeta{display:flex;align-items:center;gap:7px}
.threadCommentMeta strong{font-size:11px}
.threadCommentMeta span{color:var(--muted);font-size:9px}
.threadCommentBody>p{margin:4px 0 0;color:#d3d6d0;font-size:11px;line-height:1.5}
.replyButton{margin-top:5px;padding:0;border:0;background:transparent;color:var(--muted);font:inherit;font-size:9px;font-weight:800;cursor:pointer}
.replyButton:hover{color:var(--accent)}
.threadReply{margin-top:10px;padding-left:11px;border-left:1px solid #343b31}
.commentPhoto{display:block;width:min(260px,100%);max-height:240px;object-fit:cover;margin-top:8px;border:1px solid var(--line);border-radius:11px}
.commentImageLoading{margin-top:7px;color:var(--muted);font-size:9px}
.replyingTo,.commentPhotoPreview{display:flex;align-items:center;gap:7px;margin-top:10px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#151915;color:var(--muted);font-size:9px}
.replyingTo span,.commentPhotoPreview span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.replyingTo strong{color:var(--text)}
.replyingTo button,.commentPhotoPreview button{border:0;background:transparent;color:var(--muted);cursor:pointer}
.threadComposer{display:grid;grid-template-columns:auto 1fr auto;gap:7px;align-items:center;margin-top:10px}
.threadComposer .textInput{min-width:0;padding:10px 11px;font-size:11px}
.commentPhotoButton,.threadPostButton{height:38px;border:1px solid var(--line);border-radius:9px;background:#22262c;color:var(--text);cursor:pointer}
.commentPhotoButton{width:38px;display:grid;place-items:center;color:var(--muted)}
.commentPhotoButton:hover{color:var(--accent)}
.threadPostButton{padding:0 12px;color:var(--accent);font:inherit;font-size:10px;font-weight:900}
.threadPostButton:disabled{opacity:.45;cursor:not-allowed}
@media(max-width:600px){.notificationPanel{position:fixed;top:74px;right:12px;left:12px;width:auto}.threadComposer{grid-template-columns:auto 1fr}.threadPostButton{grid-column:2;justify-self:end}}
'''

existing_css = css.read_text()
if "/* v6.4 Social Threads */" not in existing_css:
    css.write_text(existing_css.rstrip() + "\n" + styles)

# 8) SQL migration
migration.write_text(r'''-- Himothy v6.4 — Social Threads
alter table public.log_comments
  add column if not exists parent_comment_id uuid references public.log_comments(id) on delete cascade;

alter table public.log_comments
  add column if not exists image_path text;

alter table public.log_comments
  drop constraint if exists log_comments_body_check;

alter table public.log_comments
  alter column body drop not null;

alter table public.log_comments
  drop constraint if exists log_comments_content_check;

alter table public.log_comments
  add constraint log_comments_content_check
  check (
    (body is not null and char_length(trim(body)) between 1 and 500)
    or image_path is not null
  );

create index if not exists log_comments_parent_idx
  on public.log_comments(parent_comment_id, created_at);

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('friend_request', 'comment', 'reply'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comment-images',
  'comment-images',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];

drop policy if exists "comment_images_insert_own" on storage.objects;
create policy "comment_images_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'comment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "comment_images_select_friend" on storage.objects;
create policy "comment_images_select_friend"
on storage.objects for select to authenticated
using (
  bucket_id = 'comment-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = (select auth.uid()) and f.addressee_id::text = (storage.foldername(name))[1])
          or
          (f.addressee_id = (select auth.uid()) and f.requester_id::text = (storage.foldername(name))[1])
        )
    )
  )
);

drop policy if exists "comment_images_delete_own" on storage.objects;
create policy "comment_images_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'comment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.notify_log_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  log_owner uuid;
  parent_author uuid;
begin
  select user_id into log_owner from public.logs where id = new.log_id;

  if new.parent_comment_id is not null then
    select user_id into parent_author
    from public.log_comments
    where id = new.parent_comment_id;

    if parent_author is not null and parent_author <> new.user_id then
      insert into public.notifications (user_id, actor_id, type, log_id)
      values (parent_author, new.user_id, 'reply', new.log_id);
    end if;

    if log_owner is not null
       and log_owner <> new.user_id
       and log_owner is distinct from parent_author then
      insert into public.notifications (user_id, actor_id, type, log_id)
      values (log_owner, new.user_id, 'comment', new.log_id);
    end if;

  elsif log_owner is not null and log_owner <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, log_id)
    values (log_owner, new.user_id, 'comment', new.log_id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_log_comment_notification on public.log_comments;

create trigger on_log_comment_notification
after insert on public.log_comments
for each row
execute function public.notify_log_comment();
''')

print("✅ v6.4 patch applied")
print("✅ Bell dropdown panel")
print("✅ Cloud / Bell / Profile aligned")
print("✅ Threaded replies + timestamps")
print("✅ Photo comments")
print("✅ Reply notifications")
print("✅ Created supabase/v6_4_social_threads.sql")
print()
print("NEXT:")
print("1) Run supabase/v6_4_social_threads.sql in Supabase SQL Editor")
print("2) npm run build")
