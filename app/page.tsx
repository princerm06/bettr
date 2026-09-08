'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Cloud,
  Pencil,
  LogOut,
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
  categories?: CategoryKey[];
  activity: string;
  details?: string;
  date: string;
  timestamp: number;
  points: number;
  image?: string;
  imagePath?: string;
  aiInsight?: string;
  custom?: boolean;
  visibility?: 'friends' | 'private';
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

function categoriesForLog(log: Pick<Log, 'category' | 'categories'>) {
  const keys = log.categories?.length ? log.categories : [log.category];
  return Array.from(new Set(keys));
}

type QualityResult = {
  status: 'valid' | 'questionable' | 'invalid';
  message: string;
  suggestedCategory?: CategoryKey;
  suggestionMode?: 'switch' | 'add';
};

const categorySignals: Record<CategoryKey, RegExp> = {
  appearance: /\b(skin|skincare|hair|groom|shav|hygiene|dental|teeth|face|acne|moistur|cleanser|sunscreen|trim|barber)\w*\b/,
  fashion: /\b(outfit|fit|wardrobe|shirt|pants|shoe|jacket|style|accessor|watch|jewel|fragrance|cologne|dress)\w*\b/,
  academics: /\b(stud|class|lecture|homework|assignment|quiz|exam|test|problem|leetcode|course|grade|review|learn|notes?|flashcards?)\w*\b/,
  career: /\b(job|career|intern|resume|résumé|application|apply|interview|network|recruit|portfolio|project|research|linkedin|meeting|professional)\w*\b/,
  finance: /\b(budget|spend|spent|save|saved|saving|invest|money|dollar|income|expense|grocer|trade|stock|deposit|cash|debt|bill)\w*\b/,
  nutrition: /\b(cook|meal|food|protein|calor|nutrition|grocery|water|hydr|breakfast|lunch|dinner|vegetable|fruit|prep)\w*\b/,
  social: /\b(friend|social|talk|conversation|meet|met|hang|party|event|date|call|text|introduc|connect|plan|roommate)\w*\b/,
  physical: /\b(gym|lift|run|ran|walk|squat|bench|deadlift|workout|train|mile|km|5k|10k|rep|set|sport|basketball|soccer|mobility|stretch|cardio|pr)\w*\b/,
  mind: /\b(read|book|journal|meditat|write|wrote|guitar|piano|instrument|language|chess|philosoph|practice|speech|debate|craft|draw|paint|creat)\w*\b/,
  spirituality: /\b(pray|prayer|church|mosque|temple|scripture|bible|quran|faith|worship|relig|gratitude|spiritual|service|reflection)\w*\b/,
};

const progressSignals = /\b(stud(?:y|ied|ying)|learn(?:ed|ing)?|read|wrote|write|practic(?:e|ed|ing)|train(?:ed|ing)?|work(?:ed|ing)?|lift(?:ed|ing)?|ran|run(?:ning)?|walk(?:ed|ing)?|cook(?:ed|ing)?|prep(?:ped|ping)?|apply|applied|built|build(?:ing)?|finish(?:ed|ing)?|complete(?:d|ing)?|review(?:ed|ing)?|save(?:d|ing)?|invest(?:ed|ing)?|budget(?:ed|ing)?|plan(?:ned|ning)?|meet|met|talk(?:ed|ing)?|prayed|pray(?:ing)?|journal(?:ed|ing)?|meditat(?:ed|ing)|clean(?:ed|ing)?|organ(?:ize|ized|izing)|improv(?:e|ed|ing)|practice|session|workout|interview|application|assignment|project|meal|routine|class|lecture|exam|quiz|miles?|pages?|reps?|sets?|minutes?|hours?)\b/;

function looksLikeGibberish(compact: string) {
  const tokens = compact.split(' ').filter(Boolean).filter((token) => token.length > 2);
  if (!tokens.length) return true;
  const suspicious = tokens.filter((token) => {
    const letters = token.replace(/[^a-z]/g, '');
    if (letters.length < 5) return false;
    const vowels = (letters.match(/[aeiouy]/g) || []).length;
    return /[^aeiouy]{5,}/.test(letters) || vowels / letters.length < 0.16 || /(.)\1\1/.test(letters);
  }).length;
  const recognizable = progressSignals.test(compact) || Object.values(categorySignals).some((pattern) => pattern.test(compact));
  return !recognizable && (tokens.length <= 2 || suspicious >= Math.ceil(tokens.length / 2));
}

function validateLogQuality(categoryKeys: CategoryKey[], activity: string, details: string): QualityResult {
  const text = `${activity} ${details}`.trim().toLowerCase();
  const compact = text.replace(/[^a-z0-9$\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const noCredit = [
    /\bjerk\w*\s*off\b/, /\bmasturbat\w*\b/, /\bdid nothing\b/, /\bdoom ?scroll\w*\b/,
    /\bscroll(?:ed|ing)? (?:tiktok|instagram|reels|shorts)\b/, /\bwatched (?:random )?(?:tiktok|reels|shorts)\b/,
  ];
  if (noCredit.some((pattern) => pattern.test(compact))) {
    return { status: 'invalid', message: 'This activity doesn’t appear to represent progress in the selected area, so it won’t affect your score. You can still save it to your private history.' };
  }
  if (compact.length < 4 || /^(test|asdf|lol|idk|nothing|stuff|thing|things|random|whatever)$/.test(compact) || looksLikeGibberish(compact)) {
    return { status: 'questionable', message: 'This entry isn’t clear enough to score confidently. Add a plain-language description of what you did, and it can count once the progress is understandable.' };
  }
  const generic = /^(walked|read|studied|worked|workout|gym|ran|cooked|prayed|journaled|talked|socialized)$/i.test(activity.trim());
  if (generic && !details.trim()) {
    return { status: 'questionable', message: 'This may be real progress, but it needs a little context before earning points—try adding time, distance, pages, reps, topic, or what changed.' };
  }
  const detectedCategories = categories
    .map((item) => item.key)
    .filter((key) => categorySignals[key].test(compact));

  if (categoryKeys.length > 1) {
    const matched = categoryKeys.filter((key) => detectedCategories.includes(key));
    const requiredMatches = Math.min(categoryKeys.length, Math.max(1, Math.ceil(categoryKeys.length / 2)));
    if (matched.length < requiredMatches) {
      const outsideMatch = detectedCategories.find((key) => !categoryKeys.includes(key));
      if (outsideMatch) {
        return {
          status: 'questionable',
          message: `This activity appears more related to ${categoryFor(outsideMatch).label} than enough of the selected areas. Add the relevant area or clarify how the others were involved.`,
          suggestedCategory: outsideMatch,
          suggestionMode: 'add',
        };
      }
      return { status: 'questionable', message: 'You selected several areas, but the entry doesn’t yet explain how it contributed to enough of them. Add a little context or remove categories that weren’t meaningfully involved.' };
    }
  } else {
    const selected = categoryKeys[0];
    const selectedMatches = detectedCategories.includes(selected);
    const alternative = detectedCategories.find((key) => key !== selected);

    if (!selectedMatches && alternative) {
      return {
        status: 'invalid',
        message: `This activity looks more related to ${categoryFor(alternative).label} than ${categoryFor(selected).label}. Switch the category to earn progress points, or keep this entry as-is for 0 points.`,
        suggestedCategory: alternative,
        suggestionMode: 'switch',
      };
    }

    if (!selectedMatches && !progressSignals.test(compact)) {
      return { status: 'questionable', message: 'This entry doesn’t clearly describe progress in the selected area yet. Add what you actually did or what improved so Himothy can score it fairly.' };
    }
  }
  return { status: 'valid', message: categoryKeys.length > 1 ? 'This looks clear enough to count across the selected areas.' : 'This looks clear enough to count toward the selected area.' };
}

function prototypeInsight(categoryKeys: CategoryKey[], activity: string, details: string, hasImage: boolean) {
  const quality = validateLogQuality(categoryKeys, activity, details);
  if (quality.status !== 'valid') return quality.message;
  const labels = categoryKeys.map((key) => categoryFor(key).short).join(' + ');
  const evidence = details.trim() || hasImage ? ' The extra context will also make this entry more useful when you look back later.' : '';
  return `${labels}: ${quality.message}${evidence}`;
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


type CloudLogRow = {
  id: string;
  user_id: string;
  category: CategoryKey;
  categories?: CategoryKey[];
  activity: string;
  details: string | null;
  log_date: string;
  created_at: string;
  points: number;
  image_path: string | null;
  ai_insight: string | null;
  custom: boolean;
  visibility?: 'friends' | 'private';
};

function dataUrlToBlob(dataUrl: string) {
  const [meta, encoded] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function signedImageUrl(path?: string | null) {
  if (!supabase || !path) return undefined;
  const { data } = await supabase.storage.from('log-images').createSignedUrl(path, 60 * 60 * 12);
  return data?.signedUrl;
}

async function rowToLog(row: CloudLogRow): Promise<Log> {
  return {
    id: row.id,
    category: row.category,
    categories: row.categories?.length ? row.categories : [row.category],
    activity: row.activity,
    details: row.details || '',
    date: row.log_date,
    timestamp: new Date(row.created_at).getTime(),
    points: row.points,
    imagePath: row.image_path || undefined,
    image: await signedImageUrl(row.image_path),
    aiInsight: row.ai_insight || undefined,
    custom: row.custom,
    visibility: row.visibility || 'friends',
  };
}

async function uploadImageForLog(userId: string, logId: string, image?: string) {
  if (!supabase || !image?.startsWith('data:')) return { imagePath: undefined, imageUrl: image };
  const blob = dataUrlToBlob(image);
  const extension = blob.type.includes('png') ? 'png' : 'jpg';
  const imagePath = `${userId}/${logId}.${extension}`;
  const { error } = await supabase.storage.from('log-images').upload(imagePath, blob, {
    contentType: blob.type,
    upsert: true,
  });
  if (error) throw error;
  return { imagePath, imageUrl: await signedImageUrl(imagePath) };
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
  const [editingLog, setEditingLog] = useState<Log | null>(null);
  const [showPriority, setShowPriority] = useState(false);
  const [recentLogId, setRecentLogId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [cloudReady, setCloudReady] = useState(!supabaseConfigured);
  const [profileName, setProfileName] = useState('Prince');
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    // Local prototype data is only hydrated directly when cloud mode is off.
    // In cloud mode, legacy local data is offered to exactly one signed-in account
    // during the migration step below so another account on the same browser can
    // never accidentally inherit somebody else's logs.
    if (supabaseConfigured) return;
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
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) return;
    const client = supabase;
    const account = user;
    let cancelled = false;
    async function hydrateCloud() {
      setCloudReady(false);
      const [{ data: remoteLogs, error: logsError }, { data: priorityRow }, { data: profileRow }] = await Promise.all([
        client.from('logs').select('*').order('created_at', { ascending: false }),
        client.from('user_priorities').select('priorities').maybeSingle(),
        client.from('profiles').select('display_name').maybeSingle(),
      ]);
      if (cancelled) return;
      if (logsError) {
        setToast(`Cloud sync needs setup: ${logsError.message}`);
        setCloudReady(true);
        return;
      }

      if (profileRow?.display_name) setProfileName(profileRow.display_name);
      else setProfileName(account.user_metadata?.display_name || account.email?.split('@')[0] || 'Himothy');
      if (priorityRow?.priorities) setPriorities(priorityRow.priorities as Record<CategoryKey, Priority>);

      if (remoteLogs?.length) {
        const hydrated = await Promise.all((remoteLogs as CloudLogRow[]).map(rowToLog));
        if (!cancelled) setLogs(hydrated);
      } else {
        const migrationOwner = localStorage.getItem('himothy.legacyMigrationClaimed');
        const canClaimLegacy = !migrationOwner || migrationOwner === account.id;
        const localRaw = canClaimLegacy ? localStorage.getItem('himothy.logs.v2') : null;
        const localLogs = localRaw ? (JSON.parse(localRaw) as Log[]) : [];
        if (localLogs.length) {
          const migrated: Log[] = [];
          let migrationFailed = false;
          for (const local of localLogs) {
            let imagePath = local.imagePath;
            let imageUrl = local.image;
            try {
              if (local.image?.startsWith('data:')) {
                const uploaded = await uploadImageForLog(account.id, local.id, local.image);
                imagePath = uploaded.imagePath;
                imageUrl = uploaded.imageUrl;
              }
              const { error } = await client.from('logs').insert({
                id: local.id,
                user_id: account.id,
                category: local.category,
                categories: categoriesForLog(local),
                activity: local.activity,
                details: local.details || null,
                log_date: local.date,
                created_at: new Date(local.timestamp).toISOString(),
                points: local.points,
                image_path: imagePath || null,
                ai_insight: local.aiInsight || null,
                custom: Boolean(local.custom),
                visibility: local.visibility || 'friends',
              });
              if (error) throw error;
              migrated.push({ ...local, imagePath, image: imageUrl });
            } catch {
              migrationFailed = true;
            }
          }
          if (!migrationFailed) {
            localStorage.setItem('himothy.legacyMigrationClaimed', account.id);
            localStorage.removeItem('himothy.logs.v2');
            localStorage.removeItem('himothy.logs');
            if (!cancelled) setToast(`Imported ${migrated.length} local ${migrated.length === 1 ? 'log' : 'logs'} into your account.`);
          } else if (!cancelled) {
            setToast('Some local logs could not migrate. Your local copy was left untouched.');
          }
          if (!cancelled) setLogs(migrated);
        } else if (!cancelled) {
          setLogs([]);
        }
      }
      if (!cancelled) setCloudReady(true);
    }
    hydrateCloud();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!logs.length) return;
    try {
      const key = supabaseConfigured && user ? `himothy.logs.v2.${user.id}` : 'himothy.logs.v2';
      localStorage.setItem(key, JSON.stringify(logs));
    } catch {
      setToast('Local cache is full. Cloud photos remain safe when Supabase is connected.');
    }
  }, [logs, user]);

  useEffect(() => {
    const priorityKey = supabaseConfigured && user ? `himothy.priorities.${user.id}` : 'himothy.priorities';
    localStorage.setItem(priorityKey, JSON.stringify(priorities));
    if (!supabase || !user || !cloudReady) return;
    const client = supabase;
    const account = user;
    const timer = window.setTimeout(async () => {
      const { error } = await client.from('user_priorities').upsert({
        user_id: account.id,
        priorities,
        updated_at: new Date().toISOString(),
      });
      if (error) setToast(`Could not sync priorities: ${error.message}`);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [priorities, user, cloudReady]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const categoryScores = useMemo(() => {
    const result = {} as Record<CategoryKey, number>;
    categories.forEach((c, i) => {
      const earned = logs.filter((log) => categoriesForLog(log).includes(c.key)).reduce((sum, log) => sum + log.points, 0);
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
      const count = recent.filter((log) => categoriesForLog(log).includes(category.key)).length;
      const priority = priorities[category.key];
      return sum + Math.min(1, count / priorityTargets[priority]) * priorityWeights[priority];
    }, 0);
    return Math.round((earned / totalWeight) * 100);
  }, [logs, priorities]);

  const todayLogs = logs.filter((log) => log.date === todayISO());
  const activeDays = new Set(logs.filter((log) => log.date >= dayISO(-6)).map((log) => log.date)).size;
  const level = Math.max(1, Math.floor(logs.reduce((sum, log) => sum + log.points, 0) / 28) + 14);
  const primaryPriority = categories.find((category) => priorities[category.key] === 'critical') || categories[0];

  async function persistCloudLog(log: Log) {
    if (!supabase || !user) return log;
    const client = supabase;
    const account = user;
    let finalLog = log;
    try {
      if (log.image?.startsWith('data:')) {
        const uploaded = await uploadImageForLog(account.id, log.id, log.image);
        finalLog = { ...log, imagePath: uploaded.imagePath, image: uploaded.imageUrl || log.image };
        setLogs((prev) => prev.map((item) => item.id === log.id ? finalLog : item));
      }
      const { error } = await client.from('logs').insert({
        id: finalLog.id,
        user_id: account.id,
        category: finalLog.category,
        categories: categoriesForLog(finalLog),
        activity: finalLog.activity,
        details: finalLog.details || null,
        log_date: finalLog.date,
        created_at: new Date(finalLog.timestamp).toISOString(),
        points: finalLog.points,
        image_path: finalLog.imagePath || null,
        ai_insight: finalLog.aiInsight || null,
        custom: Boolean(finalLog.custom),
        visibility: finalLog.visibility || 'friends',
      });
      if (error) throw error;
    } catch (error) {
      setToast(`Saved locally; cloud sync failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return finalLog;
  }

  async function claimLog(category: CategoryKey, activity: string) {
    const id = crypto.randomUUID();
    const log: Log = { id, category, activity, date: todayISO(), timestamp: Date.now(), points: 5 };
    setLogs((prev) => [log, ...prev]);
    setQuickCategory(null);
    setRecentLogId(id);
    setToast(`+5 ${categoryFor(category).short} · claimed`);
    window.setTimeout(() => setRecentLogId(null), 1200);
    await persistCloudLog(log);
  }

  function openComposer(category?: CategoryKey) {
    if (category) setComposerCategory(category);
    setQuickCategory(null);
    setShowComposer(true);
  }

  async function saveCustomLog(log: Omit<Log, 'id' | 'timestamp'>) {
    const id = crypto.randomUUID();
    const newLog: Log = { ...log, id, timestamp: Date.now(), custom: true };
    setLogs((prev) => [newLog, ...prev]);
    setShowComposer(false);
    setRecentLogId(id);
    setToast(`${categoryFor(log.category).emoji} Custom entry added`);
    window.setTimeout(() => setRecentLogId(null), 1200);
    await persistCloudLog(newLog);
  }

  async function updateLog(id: string, patch: Omit<Log, 'id' | 'timestamp'>) {
    const current = logs.find((item) => item.id === id);
    if (!current) return;
    let updated: Log = { ...current, ...patch, id, timestamp: current.timestamp };
    if (supabase && user) {
      const client = supabase;
      const account = user;
      try {
        if (patch.image?.startsWith('data:')) {
          const uploaded = await uploadImageForLog(account.id, id, patch.image);
          updated = { ...updated, imagePath: uploaded.imagePath, image: uploaded.imageUrl || patch.image };
        }
        const { error } = await client.from('logs').update({
          category: updated.category, categories: categoriesForLog(updated), activity: updated.activity, details: updated.details || null,
          log_date: updated.date, points: updated.points, image_path: updated.imagePath || null, ai_insight: updated.aiInsight || null, custom: Boolean(updated.custom), visibility: updated.visibility || 'friends',
        }).eq('id', id);
        if (error) throw error;
      } catch (error) {
        setToast(`Edit saved locally; cloud sync failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    setLogs((prev) => prev.map((item) => item.id === id ? updated : item));
    setEditingLog(null);
    setToast('Entry updated');
  }

  async function deleteLog(id: string) {
    const target = logs.find((log) => log.id === id);
    setLogs((prev) => prev.filter((log) => log.id !== id));
    setToast('Entry removed');
    if (!supabase || !user) return;
    const client = supabase;
    const { error } = await client.from('logs').delete().eq('id', id);
    if (error) setToast(`Removed locally; cloud delete failed: ${error.message}`);
    if (target?.imagePath) await client.storage.from('log-images').remove([target.imagePath]);
  }

  if (supabaseConfigured && !authReady) return <CloudBoot/>;
  if (supabaseConfigured && authReady && !user) return <AuthScreen/>;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PRIVATE BETA</p>
          <h1>HIMOTHY</h1>
          <p className="subtitle">Become more capable. Together.</p>
        </div>
        <div className="accountCluster">
          {supabaseConfigured && <span className={`cloudBadge ${cloudReady ? 'ready' : ''}`}><Cloud size={13}/> {cloudReady ? 'Cloud' : 'Syncing'}</span>}
          <button className="avatar" aria-label="Profile" onClick={() => setAccountOpen((value) => !value)}>{profileName.slice(0, 1).toUpperCase()}</button>
          {accountOpen && (
            <div className="accountMenu card">
              <strong>{profileName}</strong>
              <small>{user?.email || 'Local prototype mode'}</small>
              {supabaseConfigured ? (
                <button onClick={async () => { setAccountOpen(false); await supabase?.auth.signOut(); }}><LogOut size={15}/> Sign out</button>
              ) : (
                <p>Add Supabase keys to turn on accounts and cloud sync.</p>
              )}
            </div>
          )}
        </div>
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
              const hasRecent = logs.some((log) => categoriesForLog(log).includes(category.key) && log.id === recentLogId);
              return (
                <article className={`stat card ${hasRecent ? 'pulseStat' : ''}`} key={category.key}>
                  <div className="statTop"><span>{category.emoji}</span><div><strong>{category.short}</strong><small>{priorities[category.key]}</small></div><b>{categoryScores[category.key]}</b></div>
                  <div className="bar"><i style={{ width: `${categoryScores[category.key]}%` }}/></div>
                  <div className="statMeta"><span>{logs.filter((log) => categoriesForLog(log).includes(category.key) && log.date >= dayISO(-6)).length} logs this week</span><span>→</span></div>
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

          <RecentMemories logs={logs.slice(0, 4)} onDelete={deleteLog} onEdit={setEditingLog}/>
        </>
      )}

      {tab === 'history' && <HistoryView logs={logs} onDelete={deleteLog} onEdit={setEditingLog}/>}
      {tab === 'analytics' && <AnalyticsView logs={logs}/>}
      {tab === 'friends' && user && <FriendsView user={user} profileName={profileName} onProfileName={setProfileName}/>}

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

      {editingLog && (
        <CustomComposer key={`edit-${editingLog.id}`} initialCategory={editingLog.category} existing={editingLog} onClose={() => setEditingLog(null)} onSave={(patch) => updateLog(editingLog.id, patch)}/>
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


function CloudBoot() {
  return (
    <main className="authShell">
      <div className="authCard card cloudBoot">
        <div className="authMark">H</div>
        <p className="eyebrow">HIMOTHY CLOUD</p>
        <h1>Getting your account ready.</h1>
        <p>Checking your session and syncing your progress.</p>
        <div className="syncPulse"><i/><i/><i/></div>
      </div>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');
  const usernameValid = /^[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$/.test(cleanUsername);

  useEffect(() => {
    if (mode !== 'signup') { setUsernameStatus('idle'); return; }
    if (!cleanUsername) { setUsernameStatus('idle'); return; }
    if (!usernameValid) { setUsernameStatus('invalid'); return; }
    if (!supabase) return;

    const client = supabase;
    let cancelled = false;
    setUsernameStatus('checking');
    const timer = window.setTimeout(async () => {
      const { data, error } = await client.rpc('username_available', { candidate: cleanUsername });
      if (cancelled) return;
      if (error) setUsernameStatus('error');
      else setUsernameStatus(data ? 'available' : 'taken');
    }, 350);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [mode, cleanUsername, usernameValid]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim() || password.length < 6) return;
    const client = supabase;
    if (mode === 'signup' && (!displayName.trim() || !usernameValid)) {
      setMessage(!displayName.trim() ? 'Add your name to finish your profile.' : 'Choose a username with 3–30 lowercase letters, numbers, underscores, or periods.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const availability = await client.rpc('username_available', { candidate: cleanUsername });
        if (availability.error) throw availability.error;
        if (!availability.data) {
          setUsernameStatus('taken');
          setMessage(`@${cleanUsername} is already taken. Try another username.`);
          return;
        }

        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim(), username: cleanUsername } },
        });
        if (error) {
          const recheck = await client.rpc('username_available', { candidate: cleanUsername });
          if (!recheck.error && !recheck.data) {
            setUsernameStatus('taken');
            throw new Error(`@${cleanUsername} was just taken. Choose another username.`);
          }
          throw error;
        }
        if (!data.session) setMessage('Account created. Check your email to confirm it, then sign in.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not authenticate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authShell">
      <section className="authBrand">
        <p className="eyebrow">PRIVATE BETA</p>
        <h1>HIMOTHY</h1>
        <h2>Become more capable.<br/><span>Together.</span></h2>
        <p>Your progress, priorities, photos, and history now follow you across devices.</p>
        <div className="authPromises">
          <span><Check size={15}/> Private account</span>
          <span><Cloud size={15}/> Cloud-synced progress</span>
          <span><ImageIcon size={15}/> Private photo storage</span>
        </div>
      </section>
      <form className="authCard card" onSubmit={submit}>
        <div className="authMark">H</div>
        <p className="eyebrow">{mode === 'signin' ? 'WELCOME BACK' : 'JOIN HIMOTHY'}</p>
        <h2>{mode === 'signin' ? 'Lock back in.' : 'Create your profile.'}</h2>
        <p>{mode === 'signin' ? 'Your dashboard is waiting.' : 'Pick the name and unique @username your friends will know you by.'}</p>
        {mode === 'signup' && (
          <>
            <label className="authField">Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Prince" autoComplete="name" required/></label>
            <label className="authField">Username
              <div className="authUsernameWrap"><span>@</span><input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="prince" autoComplete="username" maxLength={30} required/></div>
            </label>
            <div className={`usernameAvailability ${usernameStatus}`}>
              {usernameStatus === 'checking' && 'Checking availability…'}
              {usernameStatus === 'available' && <><Check size={12}/> @{cleanUsername} is available</>}
              {usernameStatus === 'taken' && <><X size={12}/> @{cleanUsername} is already taken</>}
              {usernameStatus === 'invalid' && 'Use 3–30 lowercase letters, numbers, underscores, or periods.'}
              {usernameStatus === 'error' && 'Could not check availability yet. We’ll verify when you create the account.'}
            </div>
          </>
        )}
        <label className="authField">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required/></label>
        <label className="authField">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required/></label>
        {message && <div className="authMessage">{message}</div>}
        <button className="primaryButton authSubmit" disabled={busy || (mode === 'signup' && (usernameStatus === 'checking' || usernameStatus === 'taken' || usernameStatus === 'invalid'))}>{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="authSwitch" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null); }}>
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

function CustomComposer({ initialCategory, existing, onClose, onSave }: {
  initialCategory: CategoryKey;
  existing?: Log;
  onClose: () => void;
  onSave: (log: Omit<Log, 'id' | 'timestamp'>) => void;
}) {
  const [selectedCategories, setSelectedCategories] = useState<CategoryKey[]>(existing ? categoriesForLog(existing) : [initialCategory]);
  const [activity, setActivity] = useState(existing?.activity || '');
  const [details, setDetails] = useState(existing?.details || '');
  const [date, setDate] = useState(existing?.date || todayISO());
  const [image, setImage] = useState<string | undefined>(existing?.image);
  const [analyze, setAnalyze] = useState(true);
  const [visibility, setVisibility] = useState<'friends' | 'private'>(existing?.visibility || 'friends');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const quality = activity.trim() ? validateLogQuality(selectedCategories, activity, details) : null;

  function toggleCategory(key: CategoryKey) {
    setSelectedCategories((current) => current.includes(key) ? (current.length === 1 ? current : current.filter((item) => item !== key)) : [...current, key]);
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { setImage(await compressImage(file)); } finally { setBusy(false); }
  }

  function submit() {
    const cleanActivity = activity.trim();
    if (!cleanActivity || !selectedCategories.length) return;
    const check = validateLogQuality(selectedCategories, cleanActivity, details);
    const points = check.status === 'valid' ? (details.trim() || image ? 7 : 5) : 0;
    onSave({
      category: selectedCategories[0], categories: selectedCategories, activity: cleanActivity, details: details.trim(), image,
      imagePath: existing?.imagePath,
      aiInsight: analyze ? prototypeInsight(selectedCategories, cleanActivity, details, Boolean(image)) : undefined,
      date, points, custom: true, visibility,
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal composer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}><X/></button>
        <p className="eyebrow">{existing ? 'EDIT LOG' : 'CUSTOM LOG'}</p>
        <h2>{existing ? 'Update this entry.' : 'What did you do?'}</h2>
        <p>Select every area this activity meaningfully contributed to. The first selected area is the primary category.</p>

        <label className="fieldLabel">Categories <span>select multiple</span></label>
        <div className="categoryPicker multiCategoryPicker">
          {categories.map((item) => <button key={item.key} className={selectedCategories.includes(item.key) ? 'selected' : ''} onClick={() => toggleCategory(item.key)} title={item.label}>{item.emoji}<span>{item.short}</span></button>)}
        </div>
        <div className="selectedCategorySummary">{selectedCategories.map((key) => <span key={key}>{categoryFor(key).emoji} {categoryFor(key).short}</span>)}</div>

        <label className="fieldLabel" htmlFor="activity">Entry</label>
        <input id="activity" className="textInput" autoFocus value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="e.g. Hit a new squat PR, cooked salmon bowls, talked to someone new…"/>

        <div className="composerSplit">
          <div>
            <label className="fieldLabel" htmlFor="logDate">When did this happen?</label>
            <div className="dateField">
              <input id="logDate" className="textInput" type="date" max={todayISO()} value={date} onChange={(event) => setDate(event.target.value)} title="Choose activity date" />
            </div>
            {existing && date !== existing.date && <small className="dateEditHint">Date will update from {new Date(`${existing.date}T12:00:00`).toLocaleDateString()} to {new Date(`${date}T12:00:00`).toLocaleDateString()}.</small>}
          </div>
        </div>

        <label className="fieldLabel">Who can see this?</label>
        <div className="visibilityPicker">
          <button type="button" className={visibility === 'friends' ? 'selected' : ''} onClick={() => setVisibility('friends')}><Users size={15}/> Friends</button>
          <button type="button" className={visibility === 'private' ? 'selected' : ''} onClick={() => setVisibility('private')}>🔒 Private</button>
        </div>

        <label className="fieldLabel" htmlFor="details">Details <span>optional</span></label>
        <textarea id="details" className="textArea" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Numbers, context, what went well, what you learned, what you want to improve…"/>

        {quality && <div className={`qualityCheck ${quality.status}`}>
          <strong>{quality.status === 'valid' ? '✓ Looks good' : quality.status === 'questionable' ? 'Category / context check' : 'No progress points'}</strong>
          <span>{quality.message}</span>
          {quality.suggestedCategory && (
            <div className="qualityActions">
              <button type="button" onClick={() => {
                const suggestion = quality.suggestedCategory!;
                if (quality.suggestionMode === 'add') {
                  setSelectedCategories((current) => current.includes(suggestion) ? current : [...current, suggestion]);
                } else {
                  setSelectedCategories([suggestion]);
                }
              }}>
                {quality.suggestionMode === 'add' ? 'Add' : 'Switch to'} {categoryFor(quality.suggestedCategory).emoji} {categoryFor(quality.suggestedCategory).short}
              </button>
              <small>If you keep the current category selection, this entry can still be saved but will earn 0 points.</small>
            </div>
          )}
        </div>}

        <input ref={fileRef} className="hiddenInput" type="file" accept="image/*" onChange={handleImage}/>
        {!image ? <button className="photoDrop" onClick={() => fileRef.current?.click()} disabled={busy}><ImageIcon size={22}/><div><strong>{busy ? 'Preparing photo…' : 'Add a photo'}</strong><small>Fit check, meal, gym PR, project screenshot, book, anything.</small></div></button> : <div className="photoPreview"><img src={image} alt="Custom log preview"/><button onClick={() => setImage(undefined)}><Trash2 size={16}/> Remove</button></div>}

        <label className="aiToggle"><input type="checkbox" checked={analyze} onChange={(event) => setAnalyze(event.target.checked)}/><span className="toggleTrack"><i/></span><div><strong><Sparkles size={15}/> Smart feedback</strong><small>Supportive prototype check. It evaluates the entry, never the person.</small></div></label>
        <button className="primaryButton submitLog" onClick={submit} disabled={!activity.trim() || busy}><Send size={17}/> {existing ? 'Save changes' : quality && quality.status !== 'valid' ? 'Save without points' : 'Claim this progress'}</button>
      </div>
    </div>
  );
}

function RecentMemories({ logs, onDelete, onEdit }: { logs: Log[]; onDelete: (id: string) => void; onEdit: (log: Log) => void }) {
  return (
    <section className="memoriesSection">
      <div className="sectionHead"><div><p className="eyebrow">RECENT</p><h2>What you actually did.</h2><p>Entries become a private timeline of your progress.</p></div></div>
      <div className="memoryGrid">
        {logs.map((log) => <LogCard key={log.id} log={log} onDelete={onDelete} onEdit={onEdit}/>) }
      </div>
    </section>
  );
}

function LogCard({ log, onDelete, onEdit }: { log: Log; onDelete: (id: string) => void; onEdit: (log: Log) => void }) {
  const category = categoryFor(log.category);
  const logAreas = categoriesForLog(log);
  return (
    <article className={`memory card ${log.image ? 'withImage' : ''}`}>
      {log.image && <img className="memoryPhoto" src={log.image} alt="Log attachment"/>}
      <div className="memoryBody">
        <div className="memoryTop"><span className="memoryCategory">{logAreas.map((key) => `${categoryFor(key).emoji} ${categoryFor(key).short}`).join(" · ")}</span><span><button className="iconButton" title="Edit entry" onClick={() => onEdit(log)}><Pencil size={14}/></button><button className="iconButton" title="Delete entry" onClick={() => onDelete(log.id)}><Trash2 size={14}/></button></span></div>
        <h3>{log.activity}</h3>
        {log.details && <p>{log.details}</p>}
        {log.aiInsight && <div className="aiInsight"><span><Sparkles size={14}/> SMART FEEDBACK · PROTOTYPE</span><p>{log.aiInsight}</p></div>}
        <footer><span>{new Date(`${log.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><b>+{log.points}</b></footer>
      </div>
    </article>
  );
}

function HistoryView({ logs, onDelete, onEdit }: { logs: Log[]; onDelete: (id: string) => void; onEdit: (log: Log) => void }) {
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
  const activeCategories = new Set(monthLogs.flatMap((log) => categoriesForLog(log))).size;
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
    .map((category) => ({ category, count: monthLogs.filter((log) => categoriesForLog(log).includes(category.key)).length }))
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
            const icons = Array.from(new Set(dayLogs.flatMap((log) => categoriesForLog(log).map((key) => categoryFor(key).emoji)))).slice(0, 4);
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
  const logAreas = categoriesForLog(log);
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
    count: recent.filter((log) => categoriesForLog(log).includes(category.key)).length,
    points: recent.filter((log) => categoriesForLog(log).includes(category.key)).reduce((sum, log) => sum + log.points, 0),
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

type SocialProfile = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };
type Friendship = { id: string; requester_id: string; addressee_id: string; status: 'pending' | 'accepted' | 'blocked'; created_at: string };
type SocialReaction = { id: string; log_id: string; user_id: string; reaction: string };
type SocialComment = { id: string; log_id: string; user_id: string; body: string; created_at: string };
type FeedLog = CloudLogRow;

function FriendsView({ user, profileName, onProfileName }: { user: User; profileName: string; onProfileName: (name: string) => void }) {
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [feed, setFeed] = useState<FeedLog[]>([]);
  const [reactions, setReactions] = useState<SocialReaction[]>([]);
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string,string>>({});
  const [query, setQuery] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(profileName);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshSocial() {
    if (!supabase) return;
    const client = supabase;
    const [{ data: friendshipRows, error: friendshipError }, { data: profileRows, error: profileError }] = await Promise.all([
      client.from('friendships').select('*').order('created_at', { ascending: false }),
      client.from('profiles').select('id,display_name,username,avatar_url').order('display_name'),
    ]);
    if (friendshipError || profileError) { setNotice(friendshipError?.message || profileError?.message || 'Could not load friends.'); return; }
    const fs = (friendshipRows || []) as Friendship[];
    const ps = (profileRows || []) as SocialProfile[];
    setFriendships(fs); setProfiles(ps);
    const me = ps.find((p) => p.id === user.id);
    if (me) { setUsername(me.username || ''); setDisplayName(me.display_name || profileName); }

    const acceptedIds = fs.filter((f) => f.status === 'accepted').map((f) => f.requester_id === user.id ? f.addressee_id : f.requester_id);
    if (!acceptedIds.length) { setFeed([]); setReactions([]); setComments([]); return; }
    const { data: feedRows, error: feedError } = await client.from('logs')
      .select('*')
      .in('user_id', acceptedIds).eq('visibility', 'friends').order('created_at', { ascending: false }).limit(50);
    if (feedError) { setNotice(feedError.message); return; }
    const rows = (feedRows || []) as FeedLog[];
    setFeed(rows);
    const ids = rows.map((row) => row.id);
    if (!ids.length) { setReactions([]); setComments([]); return; }
    const [{ data: reactionRows }, { data: commentRows }] = await Promise.all([
      client.from('log_reactions').select('*').in('log_id', ids),
      client.from('log_comments').select('*').in('log_id', ids).order('created_at'),
    ]);
    setReactions((reactionRows || []) as SocialReaction[]);
    setComments((commentRows || []) as SocialComment[]);
  }

  useEffect(() => { refreshSocial(); }, [user.id]);

  const relationByUser = (id: string) => friendships.find((f) => f.requester_id === id || f.addressee_id === id);
  const friends = friendships.filter((f) => f.status === 'accepted').map((f) => profiles.find((p) => p.id === (f.requester_id === user.id ? f.addressee_id : f.requester_id))).filter(Boolean) as SocialProfile[];
  const incoming = friendships.filter((f) => f.status === 'pending' && f.addressee_id === user.id);
  const results = query.trim().length >= 2 ? profiles.filter((p) => p.id !== user.id && `${p.display_name || ''} ${p.username || ''}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0,8) : [];

  async function saveProfile() {
    if (!supabase) return;
    const client = supabase;
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g,'');
    if (cleanUsername.length < 3) { setNotice('Username must be at least 3 characters.'); return; }
    setBusy(true);
    const { error } = await client.from('profiles').update({ display_name: displayName.trim() || profileName, username: cleanUsername, updated_at: new Date().toISOString() }).eq('id', user.id);
    setBusy(false);
    if (error) { setNotice(error.code === '23505' ? 'That username is already taken.' : error.message); return; }
    onProfileName(displayName.trim() || profileName); setNotice('Profile saved.'); await refreshSocial();
  }

  async function sendRequest(id: string) {
    if (!supabase) return;
    const client = supabase;
    setBusy(true); const { error } = await client.from('friendships').insert({ requester_id: user.id, addressee_id: id, status: 'pending' }); setBusy(false);
    setNotice(error ? (error.code === '23505' ? 'A friend connection already exists.' : error.message) : 'Friend request sent.'); if (!error) await refreshSocial();
  }
  async function acceptRequest(friendship: Friendship) { if (!supabase) return; const client = supabase; const { error } = await client.from('friendships').update({ status:'accepted', updated_at:new Date().toISOString() }).eq('id',friendship.id); setNotice(error?.message || 'You are friends now.'); if (!error) await refreshSocial(); }
  async function removeConnection(id: string) { if (!supabase) return; const client = supabase; const { error } = await client.from('friendships').delete().eq('id',id); setNotice(error?.message || 'Connection removed.'); if (!error) await refreshSocial(); }

  async function toggleReaction(logId: string, reaction: string) {
    if (!supabase) return;
    const client = supabase;
    const existing = reactions.find((r) => r.log_id === logId && r.user_id === user.id && r.reaction === reaction);
    const { error } = existing ? await client.from('log_reactions').delete().eq('id', existing.id) : await client.from('log_reactions').insert({ log_id: logId, user_id: user.id, reaction });
    if (error) setNotice(error.message); else await refreshSocial();
  }
  async function addComment(logId: string) {
    if (!supabase) return; const client = supabase; const body = (commentDrafts[logId] || '').trim(); if (!body) return;
    const { error } = await client.from('log_comments').insert({ log_id: logId, user_id: user.id, body });
    if (error) setNotice(error.message); else { setCommentDrafts((d) => ({...d,[logId]:''})); await refreshSocial(); }
  }

  return (
    <section className="pageSection">
      <p className="eyebrow">YOUR CIRCLE</p><h2>Private accountability.</h2>
      <p className="subtitle">Find your people, share only what you choose, and give each other a reason to keep showing up.</p>
      {notice && <div className="socialNotice">{notice}<button onClick={() => setNotice(null)}><X size={14}/></button></div>}

      <div className="socialGrid">
        <article className="card socialPanel"><p className="eyebrow">YOUR PROFILE</p><h3>How friends find you</h3>
          <label className="fieldLabel">Display name</label><input className="textInput" value={displayName} onChange={(e)=>setDisplayName(e.target.value)} maxLength={50}/>
          <label className="fieldLabel">Username</label><div className="usernameField"><span>@</span><input className="textInput" value={username} onChange={(e)=>setUsername(e.target.value)} placeholder="prince" maxLength={30}/></div>
          <button className="primaryButton socialPrimary" onClick={saveProfile} disabled={busy}>Save profile</button>
        </article>
        <article className="card socialPanel"><p className="eyebrow">FIND FRIENDS</p><h3>Build your circle</h3>
          <input className="textInput" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search name or @username"/>
          <div className="peopleList">{results.map((p) => { const rel=relationByUser(p.id); return <div className="personRow" key={p.id}><div className="friendAvatar">{(p.display_name||p.username||'?')[0].toUpperCase()}</div><div><strong>{p.display_name||'Himothy user'}</strong><small>{p.username ? `@${p.username}` : 'No username yet'}</small></div>{!rel ? <button onClick={()=>sendRequest(p.id)} disabled={busy}><Plus size={15}/> Add</button> : <span className="relationTag">{rel.status === 'accepted' ? 'Friends' : rel.requester_id === user.id ? 'Sent' : 'Requested you'}</span>}</div>})}{query.trim().length>=2 && !results.length && <p className="emptySocial">No users found.</p>}</div>
        </article>
      </div>

      {incoming.length > 0 && <article className="card requestPanel"><div><p className="eyebrow">REQUESTS</p><h3>People who want in your circle</h3></div><div className="peopleList">{incoming.map((f)=>{const p=profiles.find((x)=>x.id===f.requester_id);return <div className="personRow" key={f.id}><div className="friendAvatar">{(p?.display_name||'?')[0].toUpperCase()}</div><div><strong>{p?.display_name||'Himothy user'}</strong><small>{p?.username?`@${p.username}`:'Friend request'}</small></div><div className="requestActions"><button className="accept" onClick={()=>acceptRequest(f)}><Check size={15}/> Accept</button><button onClick={()=>removeConnection(f.id)}><X size={15}/></button></div></div>})}</div></article>}

      <div className="sectionHead socialHead"><div><p className="eyebrow">FRIENDS · {friends.length}</p><h2>Your people.</h2></div></div>
      {friends.length ? <div className="friendStrip">{friends.map((p)=>{const f=relationByUser(p.id)!;return <div className="friendChip card" key={p.id}><div className="friendAvatar">{(p.display_name||'?')[0].toUpperCase()}</div><div><strong>{p.display_name}</strong><small>{p.username?`@${p.username}`:'Friend'}</small></div><button title="Remove friend" onClick={()=>removeConnection(f.id)}><X size={14}/></button></div>})}</div> : <div className="card emptyFriendState"><Users/><h3>Your circle starts here.</h3><p>Search for your best friend above and send the first request.</p></div>}

      <div className="sectionHead socialHead"><div><p className="eyebrow">FRIEND ACTIVITY</p><h2>What your circle is doing.</h2></div><button className="textButton" onClick={refreshSocial}>Refresh</button></div>
      <div className="feed">{feed.map((entry)=>{const cat=categoryFor(entry.category);const owner=profiles.find((p)=>p.id===entry.user_id);const logReactions=reactions.filter((r)=>r.log_id===entry.id);const logComments=comments.filter((c)=>c.log_id===entry.id);return <article className="card socialFeedItem" key={entry.id}>
        <div className="socialFeedTop"><div className="feedIcon">{cat.emoji}</div><div><div className="feedHeadline"><strong>{owner?.display_name||'Friend'}</strong><span>{cat.short}</span></div><small>{new Date(entry.created_at).toLocaleString()}</small></div></div>
        <h3>{entry.activity}</h3>{entry.details&&<p>{entry.details}</p>}
        <div className="reactions">{['🔥','W','💪'].map((emoji)=>{const count=logReactions.filter((r)=>r.reaction===emoji).length;const mine=logReactions.some((r)=>r.reaction===emoji&&r.user_id===user.id);return <button className={mine?'mine':''} key={emoji} onClick={()=>toggleReaction(entry.id,emoji)}>{emoji}{count>0&&<sup>{count}</sup>}</button>})}</div>
        <div className="commentList">{logComments.map((c)=>{const author=profiles.find((p)=>p.id===c.user_id);return <div key={c.id}><strong>{author?.display_name||'Friend'}</strong><span>{c.body}</span></div>})}</div>
        <div className="commentComposer"><input className="textInput" value={commentDrafts[entry.id]||''} onChange={(e)=>setCommentDrafts((d)=>({...d,[entry.id]:e.target.value}))} placeholder="Leave some encouragement…" maxLength={500} onKeyDown={(e)=>{if(e.key==='Enter')addComment(entry.id)}}/><button onClick={()=>addComment(entry.id)}><Send size={16}/></button></div>
      </article>})}{friends.length>0&&!feed.length&&<div className="card emptyFriendState"><Flame/><h3>No shared activity yet.</h3><p>When a friend logs something with Friends visibility, it appears here.</p></div>}</div>
    </section>
  );
}
