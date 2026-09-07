'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Image as ImageIcon,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';

type CategoryKey =
  | 'appearance'
  | 'fashion'
  | 'academics'
  | 'career'
  | 'finance'
  | 'nutrition'
  | 'social'
  | 'physical'
  | 'mind'
  | 'spirituality';

type Category = {
  key: CategoryKey;
  label: string;
  short: string;
  emoji: string;
  description: string;
};

type Priority = 'critical' | 'high' | 'normal' | 'maintenance';

type Log = {
  id: string;
  category: CategoryKey;
  activity: string;
  details?: string;
  date: string;
  timestamp: number;
  points: number;
  image?: string;
  aiInsight?: string;
  custom?: boolean;
};

type ReactionMap = Record<string, number>;

const categories: Category[] = [
  { key: 'appearance', label: 'Appearance & Self-Care', short: 'Appearance', emoji: '🧴', description: 'Skin, hair, grooming, hygiene' },
  { key: 'fashion', label: 'Fashion & Accessories', short: 'Fashion', emoji: '👔', description: 'Wardrobe, outfits, accessories, fragrance' },
  { key: 'academics', label: 'Academics', short: 'Academics', emoji: '🎓', description: 'Studying, assignments, tests, grades' },
  { key: 'career', label: 'Career', short: 'Career', emoji: '💼', description: 'Applications, résumé, interviews, research' },
  { key: 'finance', label: 'Finance', short: 'Finance', emoji: '💰', description: 'Spending, budgeting, saving, investing, income' },
  { key: 'nutrition', label: 'Nutrition & Cooking', short: 'Nutrition', emoji: '🥗', description: 'Cooking, meal prep, nutrition, hydration' },
  { key: 'social', label: 'Socialization', short: 'Social', emoji: '🗣️', description: 'Initiation, new connections, relationships' },
  { key: 'physical', label: 'Physical Prowess', short: 'Physical', emoji: '🏋️', description: 'Running, lifting, athletics, martial arts' },
  { key: 'mind', label: 'Mind & Craft', short: 'Mind & Craft', emoji: '🧠', description: 'Reading, journaling, instruments, philosophy' },
  { key: 'spirituality', label: 'Spirituality & Faith', short: 'Spirituality', emoji: '🙏', description: 'Prayer, worship, reflection, spiritual practice' },
];

const quickActivities: Record<CategoryKey, string[]> = {
  appearance: ['Skincare routine', 'Hair / grooming', 'Full reset'],
  fashion: ['Put together a fit', 'Wardrobe cleanup', 'Accessory / fragrance'],
  academics: ['Study session', 'Assignment progress', 'Exam prep'],
  career: ['Applied to a role', 'Résumé / portfolio', 'Interview prep'],
  finance: ['Tracked spending', 'Budget check', 'Invested / saved'],
  nutrition: ['Cooked a meal', 'Meal prep', 'Grocery planning'],
  social: ['Started a conversation', 'Met someone new', 'Made plans'],
  physical: ['Lifted', 'Ran', 'Athletic training'],
  mind: ['Read', 'Journaled', 'Practiced a craft'],
  spirituality: ['Prayer / reflection', 'Religious study', 'Service / worship'],
};

const priorityWeights: Record<Priority, number> = { critical: 4, high: 3, normal: 2, maintenance: 1 };
const priorityTargets: Record<Priority, number> = { critical: 5, high: 3, normal: 2, maintenance: 1 };

const demoFriend = [
  { id: 'f1', name: 'Jordan', category: 'career' as CategoryKey, activity: 'Interview prep', detail: 'Behavioral questions + company research', time: '42m ago' },
  { id: 'f2', name: 'Jordan', category: 'physical' as CategoryKey, activity: 'Pull day', detail: 'Hit a rep PR on weighted pull-ups', time: '2h ago' },
  { id: 'f3', name: 'Jordan', category: 'nutrition' as CategoryKey, activity: 'Cooked dinner instead of ordering', detail: 'Chicken, rice, vegetables', time: 'Yesterday' },
];

const dailyQuotes = [
  { text: 'Waste no more time arguing what a good man should be. Be one.', author: 'Marcus Aurelius', source: 'Meditations' },
  { text: 'The chief task in life is simply this: to identify and separate matters.', author: 'Epictetus', source: 'Discourses' },
  { text: 'It is not that we have a short time to live, but that we waste much of it.', author: 'Seneca', source: 'On the Shortness of Life' },
  { text: 'The unexamined life is not worth living.', author: 'Socrates', source: 'Plato, Apology' },
  { text: 'He who has a why to live can bear almost any how.', author: 'Friedrich Nietzsche', source: 'Twilight of the Idols' },
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius', source: 'Meditations' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus', source: 'Discourses' },
  { text: 'While we are postponing, life speeds by.', author: 'Seneca', source: 'Letters to Lucilius' },
  { text: 'No great thing is created suddenly.', author: 'Epictetus', source: 'Discourses' },
  { text: 'Difficulties strengthen the mind, as labor does the body.', author: 'Seneca', source: 'On Providence' },
];

function quoteForDate(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return dailyQuotes[day % dailyQuotes.length];
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function dayISO(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function seedLogs(): Log[] {
  const seeds: Omit<Log, 'timestamp'>[] = [
    { id: '1', category: 'physical', activity: 'Interval run', details: '8 × 400m, controlled effort.', date: dayISO(0), points: 8 },
    { id: '2', category: 'academics', activity: 'Study session', details: 'Focused review before the quiz.', date: dayISO(0), points: 7 },
    { id: '3', category: 'nutrition', activity: 'Cooked dinner', date: dayISO(-1), points: 5 },
    { id: '4', category: 'mind', activity: 'Read', details: '21 pages.', date: dayISO(-1), points: 5 },
    { id: '5', category: 'career', activity: 'Résumé refinement', date: dayISO(-2), points: 6 },
    { id: '6', category: 'social', activity: 'Started a conversation', details: 'Introduced myself instead of waiting.', date: dayISO(-3), points: 5 },
    { id: '7', category: 'appearance', activity: 'Full skincare routine', date: dayISO(-3), points: 4 },
    { id: '8', category: 'spirituality', activity: 'Prayer / reflection', date: dayISO(-4), points: 5 },
  ];
  return seeds.map((log, index) => ({ ...log, timestamp: Date.now() - index * 43_200_000 }));
}

function categoryFor(key: CategoryKey) {
  return categories.find((category) => category.key === key)!;
}

function prototypeInsight(category: CategoryKey, activity: string, details: string, hasImage: boolean) {
  const c = categoryFor(category);
  const detail = details.trim();
  const imageLine = hasImage ? ' The photo gives useful context for a future multimodal check.' : '';
  const prompts: Record<CategoryKey, string> = {
    appearance: 'Consistency matters more than adding more products. Track what changed and how your skin/hair responds over time.',
    fashion: 'A useful next step is noting what worked about the fit—silhouette, color balance, accessories, or confidence.',
    academics: 'Turn the effort into evidence: record the topic covered and one thing you can now recall without notes.',
    career: 'Favor concrete outputs. Applications sent, revisions made, contacts reached, or interview weaknesses addressed all compound.',
    finance: 'Connect this entry to a number when possible—amount spent, saved, invested, earned, or avoided.',
    nutrition: 'A strong nutrition log captures repeatability: what you ate, how easy it was to make, and whether it supports your current goals.',
    social: 'Initiation is a meaningful win. Note whether you started the interaction, deepened it, or created a clear next touchpoint.',
    physical: 'Record a performance marker when possible—weight, reps, distance, pace, rounds, or perceived effort—so progress is measurable.',
    mind: 'Capture one takeaway or skill cue. That makes the log evidence of learning rather than just time spent.',
    spirituality: 'Focus on sincerity and consistency rather than scoring the experience. A short reflection can preserve what was meaningful.',
  };
  return `${c.short}: “${activity}” is a solid entry.${detail ? ` Your note adds ${Math.min(3, Math.max(1, Math.ceil(detail.length / 80)))} layer${detail.length > 80 ? 's' : ''} of context.` : ''}${imageLine} ${prompts[category]}`;
}

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Could not decode image'));
      image.onload = () => {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas unavailable'));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.76));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [priorities, setPriorities] = useState<Record<CategoryKey, Priority>>({
    appearance: 'normal', fashion: 'maintenance', academics: 'critical', career: 'high', finance: 'normal',
    nutrition: 'high', social: 'maintenance', physical: 'high', mind: 'normal', spirituality: 'normal',
  });
  const [tab, setTab] = useState<'dashboard' | 'history' | 'analytics' | 'friends'>('dashboard');
  const [quickCategory, setQuickCategory] = useState<Category | null>(null);
  const [composerCategory, setComposerCategory] = useState<CategoryKey>('academics');
  const [showComposer, setShowComposer] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  const [recentLogId, setRecentLogId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const savedLogs = localStorage.getItem('himothy.logs.v2');
    const oldLogs = localStorage.getItem('himothy.logs');
    const savedPriorities = localStorage.getItem('himothy.priorities');
    if (savedLogs) {
      setLogs(JSON.parse(savedLogs));
    } else if (oldLogs) {
      const migrated = (JSON.parse(oldLogs) as Partial<Log>[]).map((log, index) => ({
        id: log.id || crypto.randomUUID(),
        category: log.category || 'mind',
        activity: log.activity || 'Progress log',
        details: log.details || '',
        date: log.date || todayISO(),
        timestamp: log.timestamp || Date.now() - index,
        points: log.points || 5,
      })) as Log[];
      setLogs(migrated);
    } else {
      setLogs(seedLogs());
    }
    if (savedPriorities) setPriorities(JSON.parse(savedPriorities));
  }, []);

  useEffect(() => {
    if (logs.length) {
      try {
        localStorage.setItem('himothy.logs.v2', JSON.stringify(logs));
      } catch {
        setToast('Photo storage is full. Future builds will use cloud storage.');
      }
    }
  }, [logs]);
  useEffect(() => { localStorage.setItem('himothy.priorities', JSON.stringify(priorities)); }, [priorities]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const categoryScores = useMemo(() => {
    const result = {} as Record<CategoryKey, number>;
    categories.forEach((c, i) => {
      const earned = logs.filter((log) => log.category === c.key).reduce((sum, log) => sum + log.points, 0);
      result[c.key] = Math.min(99, 34 + i * 2 + earned);
    });
    return result;
  }, [logs]);

  const discipline = useMemo(() => {
    const week = new Date();
    week.setHours(0, 0, 0, 0);
    week.setDate(week.getDate() - 6);
    const recent = logs.filter((log) => new Date(`${log.date}T12:00:00`) >= week);
    const totalWeight = categories.reduce((sum, category) => sum + priorityWeights[priorities[category.key]], 0);
    const earned = categories.reduce((sum, category) => {
      const count = recent.filter((log) => log.category === category.key).length;
      const priority = priorities[category.key];
      return sum + Math.min(1, count / priorityTargets[priority]) * priorityWeights[priority];
    }, 0);
    return Math.round((earned / totalWeight) * 100);
  }, [logs, priorities]);

  const todayLogs = logs.filter((log) => log.date === todayISO());
  const activeDays = new Set(logs.filter((log) => log.date >= dayISO(-6)).map((log) => log.date)).size;
  const level = Math.max(1, Math.floor(logs.reduce((sum, log) => sum + log.points, 0) / 28) + 14);
  const primaryPriority = categories.find((category) => priorities[category.key] === 'critical') || categories[0];

  function claimLog(category: CategoryKey, activity: string) {
    const id = crypto.randomUUID();
    setLogs((prev) => [{ id, category, activity, date: todayISO(), timestamp: Date.now(), points: 5 }, ...prev]);
    setQuickCategory(null);
    setRecentLogId(id);
    setToast(`+5 ${categoryFor(category).short} · claimed`);
    window.setTimeout(() => setRecentLogId(null), 1200);
  }

  function openComposer(category?: CategoryKey) {
    if (category) setComposerCategory(category);
    setQuickCategory(null);
    setShowComposer(true);
  }

  function saveCustomLog(log: Omit<Log, 'id' | 'timestamp'>) {
    const id = crypto.randomUUID();
    setLogs((prev) => [{ ...log, id, timestamp: Date.now(), custom: true }, ...prev]);
    setShowComposer(false);
    setRecentLogId(id);
    setToast(`${categoryFor(log.category).emoji} Custom entry added`);
    window.setTimeout(() => setRecentLogId(null), 1200);
  }

  function deleteLog(id: string) {
    setLogs((prev) => prev.filter((log) => log.id !== id));
    setToast('Entry removed');
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PRIVATE BETA</p>
          <h1>HIMOTHY</h1>
          <p className="subtitle">Become more capable. Together.</p>
        </div>
        <button className="avatar" aria-label="Profile">P</button>
      </header>

      <nav className="tabs desktopTabs">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><BarChart3 size={17}/> Dashboard</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><CalendarDays size={17}/> History</button>
        <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}><Sparkles size={17}/> Analytics</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}><Users size={17}/> Friends</button>
      </nav>

      {tab === 'dashboard' && (
        <>
          <section className="hero card">
            <div className="heroCopy">
              <p className="eyebrow">YOUR HIMOTHY</p>
              <div className="levelRow">
                <span className="level">LEVEL {level}</span>
                <span className="streak"><Flame size={16}/> {activeDays} active days</span>
              </div>
              <h2>Strong week. <span>{primaryPriority.short} is the mission.</span></h2>
              <p className="heroNote">Discipline rewards alignment with this week’s priorities, not checking every box.</p>
            </div>
            <div className="heroMetrics">
              <div className="disciplineRing" style={{ '--score': `${discipline * 3.6}deg` } as React.CSSProperties}>
                <div><strong>{discipline}</strong><small>DISCIPLINE</small></div>
              </div>
              <button className="miniPriority" onClick={() => setShowPriority(true)}>Tune priorities <ChevronRight size={14}/></button>
            </div>
          </section>

          <section className="sectionHead">
            <div><p className="eyebrow">TODAY</p><h2>Claim your progress.</h2><p>Two taps for normal stuff. Custom entry when it’s worth remembering.</p></div>
            <span>{todayLogs.length} logs today</span>
          </section>

          <div className="quickGrid">
            {categories.map((category) => (
              <button key={category.key} className="quick" onClick={() => setQuickCategory(category)}>
                <span>{category.emoji}</span>
                <div><strong>{category.short}</strong><small>{category.description}</small></div>
                <Plus size={18}/>
              </button>
            ))}
          </div>

          <button className="customCallout card" onClick={() => openComposer()}>
            <div className="customIcon"><Camera size={21}/></div>
            <div><p className="eyebrow">MEMORY LOG</p><strong>Write your own entry + add a photo</strong><small>For a PR, fit check, meal, project screenshot, social win, reflection, or anything else.</small></div>
            <Sparkles size={20}/>
          </button>

          <section className="sectionHead">
            <div><p className="eyebrow">LIFE STATS</p><h2>Your build.</h2><p>Progress reflects accumulated evidence, not perfection.</p></div>
            <button className="textButton" onClick={() => setShowPriority(true)}>Edit priorities</button>
          </section>

          <div className="statsGrid">
            {categories.map((category) => {
              const hasRecent = logs.some((log) => log.category === category.key && log.id === recentLogId);
              return (
                <article className={`stat card ${hasRecent ? 'pulseStat' : ''}`} key={category.key}>
                  <div className="statTop"><span>{category.emoji}</span><div><strong>{category.short}</strong><small>{priorities[category.key]}</small></div><b>{categoryScores[category.key]}</b></div>
                  <div className="bar"><i style={{ width: `${categoryScores[category.key]}%` }}/></div>
                  <div className="statMeta"><span>{logs.filter((log) => log.category === category.key && log.date >= dayISO(-6)).length} logs this week</span><span>→</span></div>
                </article>
              );
            })}
          </div>

          <section className="card priorityCard">
            <div><p className="eyebrow">PRIORITY MODE</p><h2>Discipline follows context.</h2><p>Finals week can be Academics-heavy. Recruiting season can be Career-heavy. Himothy scores whether your effort matches what you said matters.</p></div>
            <div className="priorityStack">
              {categories.filter((category) => priorities[category.key] === 'critical' || priorities[category.key] === 'high').map((category) => (
                <span key={category.key} className={priorities[category.key]}>{category.emoji} {category.short} · {priorities[category.key]}</span>
              ))}
            </div>
          </section>

          <RecentMemories logs={logs.slice(0, 4)} onDelete={deleteLog}/>
        </>
      )}

      {tab === 'history' && <HistoryView logs={logs} onDelete={deleteLog}/>}
      {tab === 'analytics' && <AnalyticsView logs={logs}/>}
      {tab === 'friends' && <FriendsView/>}

      <button className="floating" onClick={() => openComposer()}><Plus size={25}/> Log</button>

      <nav className="mobileNav">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><BarChart3 size={19}/><span>Build</span></button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><CalendarDays size={19}/><span>History</span></button>
        <button className="mobilePlus" onClick={() => openComposer()}><Plus size={23}/></button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}><Users size={19}/><span>Friends</span></button>
        <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}><Sparkles size={19}/><span>Stats</span></button>
      </nav>

      {quickCategory && (
        <div className="overlay" onClick={() => setQuickCategory(null)}>
          <div className="modal quickModal" onClick={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setQuickCategory(null)}><X/></button>
            <span className="modalEmoji">{quickCategory.emoji}</span>
            <p className="eyebrow">QUICK LOG</p>
            <h2>{quickCategory.label}</h2>
            <p>Claim a common activity instantly, or make this one memorable.</p>
            <div className="activityChoices">
              {quickActivities[quickCategory.key].map((activity) => (
                <button key={activity} onClick={() => claimLog(quickCategory.key, activity)}><Check size={17}/>{activity}</button>
              ))}
            </div>
            <button className="customEntryButton" onClick={() => openComposer(quickCategory.key)}><Camera size={17}/> Custom entry + photo <ChevronRight size={16}/></button>
          </div>
        </div>
      )}

      {showComposer && (
        <CustomComposer initialCategory={composerCategory} onClose={() => setShowComposer(false)} onSave={saveCustomLog}/>
      )}

      {showPriority && (
        <div className="overlay" onClick={() => setShowPriority(false)}>
          <div className="modal wide" onClick={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setShowPriority(false)}><X/></button>
            <p className="eyebrow">WEEKLY PRIORITIES</p>
            <h2>What matters right now?</h2>
            <p>Critical categories carry more weight in Discipline. Maintenance means “keep it alive without stealing focus.”</p>
            <div className="priorityEditor">
              {categories.map((category) => (
                <div key={category.key}>
                  <span>{category.emoji} {category.short}</span>
                  <select value={priorities[category.key]} onChange={(event) => setPriorities((prev) => ({ ...prev, [category.key]: event.target.value as Priority }))}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              ))}
            </div>
            <button className="primaryButton" onClick={() => setShowPriority(false)}>Save priority mode</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function CustomComposer({ initialCategory, onClose, onSave }: {
  initialCategory: CategoryKey;
  onClose: () => void;
  onSave: (log: Omit<Log, 'id' | 'timestamp'>) => void;
}) {
  const [category, setCategory] = useState<CategoryKey>(initialCategory);
  const [activity, setActivity] = useState('');
  const [details, setDetails] = useState('');
  const [image, setImage] = useState<string | undefined>();
  const [analyze, setAnalyze] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      setImage(await compressImage(file));
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const cleanActivity = activity.trim();
    if (!cleanActivity) return;
    onSave({
      category,
      activity: cleanActivity,
      details: details.trim(),
      image,
      aiInsight: analyze ? prototypeInsight(category, cleanActivity, details, Boolean(image)) : undefined,
      date: todayISO(),
      points: details.trim() || image ? 7 : 5,
      custom: true,
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal composer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}><X/></button>
        <p className="eyebrow">CUSTOM LOG</p>
        <h2>What did you do?</h2>
        <p>Write as much or as little as you want. Photos are optional.</p>

        <label className="fieldLabel">Category</label>
        <div className="categoryPicker">
          {categories.map((item) => <button key={item.key} className={category === item.key ? 'selected' : ''} onClick={() => setCategory(item.key)} title={item.label}>{item.emoji}<span>{item.short}</span></button>)}
        </div>

        <label className="fieldLabel" htmlFor="activity">Entry</label>
        <input id="activity" className="textInput" autoFocus value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="e.g. Hit a new squat PR, cooked salmon bowls, talked to someone new…"/>

        <label className="fieldLabel" htmlFor="details">Details <span>optional</span></label>
        <textarea id="details" className="textArea" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Numbers, context, what went well, what you learned, what you want to improve…"/>

        <input ref={fileRef} className="hiddenInput" type="file" accept="image/*" onChange={handleImage}/>
        {!image ? (
          <button className="photoDrop" onClick={() => fileRef.current?.click()} disabled={busy}><ImageIcon size={22}/><div><strong>{busy ? 'Preparing photo…' : 'Add a photo'}</strong><small>Fit check, meal, gym PR, project screenshot, book, anything.</small></div></button>
        ) : (
          <div className="photoPreview"><img src={image} alt="Custom log preview"/><button onClick={() => setImage(undefined)}><Trash2 size={16}/> Remove</button></div>
        )}

        <label className="aiToggle">
          <input type="checkbox" checked={analyze} onChange={(event) => setAnalyze(event.target.checked)}/>
          <span className="toggleTrack"><i/></span>
          <div><strong><Sparkles size={15}/> AI insight</strong><small>Prototype analysis for now. Real multimodal AI comes with the backend.</small></div>
        </label>

        <button className="primaryButton submitLog" onClick={submit} disabled={!activity.trim() || busy}><Send size={17}/> Claim this progress</button>
      </div>
    </div>
  );
}

function RecentMemories({ logs, onDelete }: { logs: Log[]; onDelete: (id: string) => void }) {
  return (
    <section className="memoriesSection">
      <div className="sectionHead"><div><p className="eyebrow">RECENT</p><h2>What you actually did.</h2><p>Entries become a private timeline of your progress.</p></div></div>
      <div className="memoryGrid">
        {logs.map((log) => <LogCard key={log.id} log={log} onDelete={onDelete}/>) }
      </div>
    </section>
  );
}

function LogCard({ log, onDelete }: { log: Log; onDelete: (id: string) => void }) {
  const category = categoryFor(log.category);
  return (
    <article className={`memory card ${log.image ? 'withImage' : ''}`}>
      {log.image && <img className="memoryPhoto" src={log.image} alt="Log attachment"/>}
      <div className="memoryBody">
        <div className="memoryTop"><span className="memoryCategory">{category.emoji} {category.short}</span><button className="iconButton" title="Delete entry" onClick={() => onDelete(log.id)}><Trash2 size={14}/></button></div>
        <h3>{log.activity}</h3>
        {log.details && <p>{log.details}</p>}
        {log.aiInsight && <div className="aiInsight"><span><Sparkles size={14}/> AI INSIGHT · PROTOTYPE</span><p>{log.aiInsight}</p></div>}
        <footer><span>{new Date(`${log.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><b>+{log.points}</b></footer>
      </div>
    </article>
  );
}

function HistoryView({ logs, onDelete }: { logs: Log[]; onDelete: (id: string) => void }) {
  type CalendarMode = 'month' | 'week' | 'year';
  const [mode, setMode] = useState<CalendarMode>('month');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const grouped = useMemo(() => {
    return logs.reduce((acc, log) => {
      (acc[log.date] ||= []).push(log);
      return acc;
    }, {} as Record<string, Log[]>);
  }, [logs]);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const monthPrefix = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  const monthLogs = logs.filter((log) => log.date.startsWith(monthPrefix));
  const activeCategories = new Set(monthLogs.map((log) => log.category)).size;
  const activeDates = new Set(monthLogs.map((log) => log.date)).size;

  const currentStreak = (() => {
    let streak = 0;
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    while (true) {
      const iso = day.toISOString().slice(0, 10);
      if (!grouped[iso]?.length) break;
      streak += 1;
      day.setDate(day.getDate() - 1);
    }
    return streak;
  })();

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [cursor]);

  const categoryTotals = categories
    .map((category) => ({ category, count: monthLogs.filter((log) => log.category === category.key).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const recentHighlights = monthLogs
    .filter((log) => log.image || log.custom || log.points >= 7)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 4);

  const selectedLogs = grouped[selectedDate] || [];
  const maxDayCount = Math.max(1, ...monthCells.map((date) => grouped[date.toISOString().slice(0, 10)]?.length || 0));

  function shiftPeriod(direction: number) {
    if (mode === 'year') {
      setCursor((prev) => new Date(prev.getFullYear() + direction, prev.getMonth(), 1));
    } else if (mode === 'week') {
      setCursor((prev) => {
        const next = new Date(prev);
        next.setDate(next.getDate() + direction * 7);
        return next;
      });
    } else {
      setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
    }
  }

  function jumpToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(todayISO());
  }

  function renderMonth() {
    return (
      <div className="calendarPanel card">
        <div className="weekdayRow">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="monthGrid">
          {monthCells.map((date) => {
            const iso = date.toISOString().slice(0, 10);
            const dayLogs = grouped[iso] || [];
            const inMonth = date.getMonth() === cursor.getMonth();
            const isToday = iso === todayISO();
            const selected = iso === selectedDate;
            const intensity = dayLogs.length ? Math.max(.18, Math.min(1, dayLogs.length / maxDayCount)) : 0;
            const photo = dayLogs.find((log) => log.image)?.image;
            const icons = Array.from(new Set(dayLogs.map((log) => categoryFor(log.category).emoji))).slice(0, 4);
            return (
              <button
                key={iso}
                className={`calendarDay ${!inMonth ? 'outsideMonth' : ''} ${dayLogs.length ? 'hasActivity' : ''} ${selected ? 'selectedDay' : ''} ${isToday ? 'todayDay' : ''}`}
                style={dayLogs.length ? { '--dayHeat': intensity } as React.CSSProperties : undefined}
                onClick={() => setSelectedDate(iso)}
              >
                <span className="dayNumber">{date.getDate()}</span>
                {photo && <img className="dayThumb" src={photo} alt=""/>}
                {dayLogs.length > 0 && (
                  <div className="dayBottom">
                    <div className="dayDots">{icons.map((icon, index) => <span key={`${icon}-${index}`}>{icon}</span>)}</div>
                    <b>{dayLogs.length}</b>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderWeek() {
    const anchor = new Date(cursor);
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - anchor.getDay());
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
    return (
      <div className="weekCalendar card">
        {days.map((date) => {
          const iso = date.toISOString().slice(0, 10);
          const items = grouped[iso] || [];
          return (
            <button key={iso} className={`weekDay ${iso === selectedDate ? 'selectedDay' : ''}`} onClick={() => setSelectedDate(iso)}>
              <span>{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <strong>{date.getDate()}</strong>
              <small>{items.length} {items.length === 1 ? 'entry' : 'entries'}</small>
              <div className="weekIcons">{items.slice(0, 5).map((log) => <i key={log.id}>{categoryFor(log.category).emoji}</i>)}</div>
            </button>
          );
        })}
      </div>
    );
  }

  function renderYear() {
    const year = cursor.getFullYear();
    return (
      <div className="yearGrid">
        {Array.from({ length: 12 }, (_, month) => {
          const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
          const count = logs.filter((log) => log.date.startsWith(prefix)).length;
          const active = new Set(logs.filter((log) => log.date.startsWith(prefix)).map((log) => log.date)).size;
          return (
            <button key={month} className="yearMonth card" onClick={() => { setCursor(new Date(year, month, 1)); setMode('month'); }}>
              <span>{new Date(year, month, 1).toLocaleDateString(undefined, { month: 'short' })}</span>
              <strong>{count}</strong>
              <small>{active} active days</small>
              <div className="yearBar"><i style={{ width: `${Math.min(100, count * 5)}%` }}/></div>
            </button>
          );
        })}
      </div>
    );
  }

  const periodLabel = mode === 'year'
    ? String(cursor.getFullYear())
    : mode === 'week'
      ? `Week of ${new Date(cursor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <section className="pageSection calendarPage">
      <div className="calendarTitleRow">
        <div>
          <p className="eyebrow">ACTIVITY CALENDAR</p>
          <h2>Your progress, at a glance.</h2>
          <p className="subtitle">A visual record of what you actually did—not a guilt grid.</p>
        </div>
        <div className="calendarControls">
          <button className="calendarArrow" onClick={() => shiftPeriod(-1)}><ChevronLeft size={18}/></button>
          <strong>{periodLabel}</strong>
          <button className="calendarArrow" onClick={() => shiftPeriod(1)}><ChevronRight size={18}/></button>
          <button className="todayButton" onClick={jumpToday}>Today</button>
          <div className="viewSwitch">
            {(['month','week','year'] as CalendarMode[]).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
          </div>
        </div>
      </div>

      <div className="calendarSummary">
        <article className="calendarMetric card"><span className="metricIcon">🔥</span><div><strong>{currentStreak}</strong><small>Day streak</small></div></article>
        <article className="calendarMetric card"><span className="metricIcon">📊</span><div><strong>{monthLogs.length}</strong><small>Entries this month</small></div></article>
        <article className="calendarMetric card"><span className="metricIcon">🏆</span><div><strong>{activeCategories}/10</strong><small>Areas active</small></div></article>
        <article className="calendarMetric card"><span className="metricIcon">⭐</span><div><strong>{activeDates}</strong><small>Active days</small></div></article>
        <article className="intensityLegend card"><span>Activity intensity</span><div>{[0,.25,.45,.7,1].map((strength, i) => <i key={i} style={{ '--legendHeat': strength } as React.CSSProperties}/>)}</div><small><span>None</span><span>High</span></small></article>
      </div>

      <div className="calendarBody">
        <div className="calendarMain">
          {mode === 'month' ? renderMonth() : mode === 'week' ? renderWeek() : renderYear()}

          <article className="selectedDayCard card">
            <div className="selectedDayHead">
              <div><p className="eyebrow">SELECTED DAY</p><h3>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3></div>
              <span>{selectedLogs.length} {selectedLogs.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            {selectedLogs.length ? (
              <div className="selectedDayLogs">
                {selectedLogs.map((log) => {
                  const category = categoryFor(log.category);
                  return (
                    <div className="selectedLog" key={log.id}>
                      {log.image ? <img src={log.image} alt=""/> : <span>{category.emoji}</span>}
                      <div><strong>{log.activity}</strong><small>{category.short}{log.details ? ` · ${log.details}` : ''}</small></div>
                      <b>+{log.points}</b>
                      <button className="iconButton" onClick={() => onDelete(log.id)}><Trash2 size={14}/></button>
                    </div>
                  );
                })}
              </div>
            ) : <div className="emptyDay">Nothing logged here. Rest days and focused days both belong in the story.</div>}
          </article>
        </div>

        <aside className="calendarSidebar">
          <article className="sideCard card">
            <div className="sideHead"><strong>Most active areas</strong><span>{cursor.toLocaleDateString(undefined, { month: 'short' })}</span></div>
            <div className="activeAreas">
              {categoryTotals.length ? categoryTotals.map(({ category, count }) => (
                <div key={category.key}><span>{category.emoji}</span><strong>{category.short}</strong><b>{count}</b></div>
              )) : <p className="sideEmpty">Your category breakdown will appear here.</p>}
            </div>
          </article>

          <article className="sideCard card">
            <div className="sideHead"><strong>Recent highlights</strong><Sparkles size={15}/></div>
            <div className="highlightsList">
              {recentHighlights.length ? recentHighlights.map((log) => (
                <button key={log.id} onClick={() => setSelectedDate(log.date)}>
                  {log.image ? <img src={log.image} alt=""/> : <span>{categoryFor(log.category).emoji}</span>}
                  <div><strong>{log.activity}</strong><small>{categoryFor(log.category).short} · {new Date(`${log.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>
                </button>
              )) : <p className="sideEmpty">Photo logs, custom entries, and bigger wins will surface here.</p>}
            </div>
          </article>

          <DailyQuoteCard />
        </aside>
      </div>
    </section>
  );
}


function DailyQuoteCard() {
  const quote = quoteForDate();
  return (
    <article className="calendarQuote card">
      <span>“</span>
      <p>{quote.text}</p>
      <small>— {quote.author} · {quote.source}</small>
    </article>
  );
}

function AnalyticsView({ logs }: { logs: Log[] }) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 29);
  const recent = logs.filter((log) => new Date(`${log.date}T12:00:00`) >= cutoff);
  const priorCutoff = new Date(cutoff);
  priorCutoff.setDate(priorCutoff.getDate() - 30);
  const previous = logs.filter((log) => {
    const date = new Date(`${log.date}T12:00:00`);
    return date >= priorCutoff && date < cutoff;
  });
  const activeDays = new Set(recent.map((log) => log.date)).size;
  const points = recent.reduce((sum, log) => sum + log.points, 0);
  const previousPoints = previous.reduce((sum, log) => sum + log.points, 0);
  const delta = previousPoints ? Math.round(((points - previousPoints) / previousPoints) * 100) : 0;
  const totals = categories.map((category) => ({
    category,
    count: recent.filter((log) => log.category === category.key).length,
    points: recent.filter((log) => log.category === category.key).reduce((sum, log) => sum + log.points, 0),
  })).sort((a, b) => b.points - a.points);
  const maxPoints = Math.max(1, ...totals.map((item) => item.points));
  const activeAreas = totals.filter((item) => item.count > 0).length;
  const balance = activeAreas ? Math.round((activeAreas / categories.length) * 100) : 0;
  const top = totals[0];
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (29 - index));
    const iso = date.toISOString().slice(0, 10);
    const dayLogs = recent.filter((log) => log.date === iso);
    return { iso, date, count: dayLogs.length, points: dayLogs.reduce((sum, log) => sum + log.points, 0) };
  });
  const maxDayPoints = Math.max(1, ...days.map((day) => day.points));
  const quote = quoteForDate();

  return (
    <section className="pageSection analyticsPage">
      <div className="analyticsTitle">
        <div>
          <p className="eyebrow">ANALYTICS</p>
          <h2>See what your effort is becoming.</h2>
          <p className="subtitle">Thirty-day patterns, category balance, and where your attention is actually going.</p>
        </div>
        <div className="quoteChip"><span>“</span><p>{quote.text}</p><small>— {quote.author}</small></div>
      </div>

      <div className="analyticsMetrics">
        <article className="analyticsMetric card"><small>30-DAY POINTS</small><strong>{points}</strong><span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs prior 30d</span></article>
        <article className="analyticsMetric card"><small>ACTIVE DAYS</small><strong>{activeDays}<i>/30</i></strong><span>{Math.round((activeDays / 30) * 100)}% consistency</span></article>
        <article className="analyticsMetric card"><small>AREAS ACTIVE</small><strong>{activeAreas}<i>/10</i></strong><span>{balance}% life coverage</span></article>
        <article className="analyticsMetric card"><small>TOP FOCUS</small><strong className="focusStat">{top.category.emoji} {top.category.short}</strong><span>{top.points} points · {top.count} logs</span></article>
      </div>

      <div className="analyticsGrid">
        <article className="card trendCard">
          <div className="analyticsCardHead"><div><p className="eyebrow">MOMENTUM</p><h3>Last 30 days</h3></div><span>{recent.length} entries</span></div>
          <div className="trendBars">
            {days.map((day) => <i key={day.iso} title={`${day.iso}: ${day.count} logs`} style={{ height: `${Math.max(5, (day.points / maxDayPoints) * 100)}%` }} className={day.count ? 'active' : ''}/>) }
          </div>
          <div className="trendAxis"><span>{days[0].date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><span>Today</span></div>
        </article>

        <article className="card balanceCard">
          <div className="analyticsCardHead"><div><p className="eyebrow">BALANCE</p><h3>Life coverage</h3></div><span>{balance}%</span></div>
          <div className="balanceRing" style={{ '--balance': `${balance * 3.6}deg` } as React.CSSProperties}><div><strong>{balance}</strong><small>BALANCE</small></div></div>
          <p>Balance is coverage, not a demand to split your time equally. Priorities can still dominate when they should.</p>
        </article>
      </div>

      <article className="card categoryAnalytics">
        <div className="analyticsCardHead"><div><p className="eyebrow">CATEGORY BREAKDOWN</p><h3>Where the work went</h3></div><span>30 days</span></div>
        <div className="categoryAnalyticsList">
          {totals.map(({ category, count, points: categoryPoints }) => (
            <div className="categoryAnalyticsRow" key={category.key}>
              <span className="analyticsEmoji">{category.emoji}</span>
              <div className="analyticsLabel"><strong>{category.short}</strong><small>{count} {count === 1 ? 'log' : 'logs'}</small></div>
              <div className="analyticsBar"><i style={{ width: `${(categoryPoints / maxPoints) * 100}%` }}/></div>
              <b>{categoryPoints}</b>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function FriendsView() {
  const [reactions, setReactions] = useState<Record<string, ReactionMap>>({});
  function react(id: string, reaction: string) {
    setReactions((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [reaction]: (prev[id]?.[reaction] || 0) + 1 } }));
  }
  return (
    <section className="pageSection">
      <p className="eyebrow">THE BOYS</p>
      <h2>Private accountability.</h2>
      <p className="subtitle">No influencer feed. Just the people you chose to improve alongside.</p>
      <div className="friendHero card"><div className="friendAvatar">J</div><div><strong>Jordan</strong><p>Level 14 · Discipline 81</p></div><span className="online">● active today</span></div>
      <div className="feed">
        {demoFriend.map((entry) => {
          const category = categoryFor(entry.category);
          return (
            <article className="card feedItem" key={entry.id}>
              <div className="feedIcon">{category.emoji}</div>
              <div><div className="feedHeadline"><strong>{entry.name}</strong><span>{category.short}</span></div><p>{entry.activity}</p><small>{entry.detail} · {entry.time}</small></div>
              <div className="reactions">{['🔥','W','💪'].map((reaction) => <button key={reaction} onClick={() => react(entry.id, reaction)}>{reaction}{reactions[entry.id]?.[reaction] ? <sup>{reactions[entry.id][reaction]}</sup> : null}</button>)}</div>
            </article>
          );
        })}
      </div>
      <div className="duo card"><Sparkles/><div><p className="eyebrow">DUO STATUS</p><h3>You both showed up 5 of the last 7 days.</h3><p>Shared challenges and real friend accounts come with the database pass.</p></div></div>
    </section>
  );
}
