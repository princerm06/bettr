'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  type Category,
  type CategoryKey,
  categories,
  categoryFor,
  categorySignals,
  calculateDeterministicBasePoints,
} from '../lib/evaluation/legacyEvaluator';
import { applyPriorityReward } from '../lib/evaluation/priorityReward';
import {
  additionalCategorySuggestions,
  CATEGORY_REQUIRED_MESSAGE,
  countCategoryUsage,
  orderComposerCategories,
} from '../lib/evaluation/categoryComposerUx';
import { suggestCategoriesHybrid } from '../lib/evaluation/categorySemanticSuggestions';
import {
  canBypassSemanticGateForQuickClaim,
  TRUSTED_QUICK_ACTIVITIES,
} from '../lib/evaluation/trustedQuickActivities';
import { evaluateComposerSubmission } from '../lib/evaluation/developmentalGate';
import { evaluateObviousCategoryMismatch } from '../lib/evaluation/categoryMismatchGuard';
import { embedTextsClient, isClientMiniLmLoaded, loadClientMiniLm } from '../lib/evaluation/minilmClient';
import {
  COMPOSER_GATE_COPY,
  categoryMismatchMessage,
  composeSemanticLogText,
  gatedProgressInsight,
  persistDetailsAfterGate,
  shouldResetClarificationSession,
} from '../lib/evaluation/customComposerSemantic';
import {
  applyComposerGateDecisionToUi,
  resolveComposerSubmitPrecheck,
} from '../lib/evaluation/customComposerSubmit';
import {
  canPersistComposerResult,
  shouldReevaluateEditedLog,
} from '../lib/evaluation/composerPersistence';
import onboardingStyles from './onboarding.module.css';
import {
  BarChart3,
  MessageCircle,
  Bell,
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
  Settings,} from 'lucide-react';

type Priority = 'critical' | 'high' | 'normal' | 'maintenance';

type Log = {
  id: string;
  category: CategoryKey;
  categories?: CategoryKey[];
  activity: string;
  details?: string;
  date: string;
  timestamp: number;
  startTime?: string;
  durationMinutes?: number;
  points: number;
  image?: string;
  imagePath?: string;
  aiInsight?: string;
  custom?: boolean;
  visibility?: 'friends' | 'private';
};

type ReactionMap = Record<string, number>;

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

function categoriesForLog(log: Pick<Log, 'category' | 'categories'>) {
  const keys = log.categories?.length ? log.categories : [log.category];
  return Array.from(new Set(keys));
}

function attributionShareForCategory(log: Log, category: CategoryKey) {
  const selected = categoriesForLog(log);
  if (!selected.includes(category)) return 0;

  const compact = `${log.activity} ${log.details || ''}`.toLowerCase().replace(/[^a-z0-9$\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const matched = selected.filter((key) => categorySignals[key].test(compact));
  if (!matched.length) return 1 / selected.length;

  // Evidence-backed tags receive most of the category credit. Intentional but
  // unclear tags still receive a small share, so Himothy guides instead of blocks.
  const weights = selected.map((key) => matched.includes(key) ? 1 : 0.35);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights[selected.indexOf(category)] / totalWeight;
}

function pointsForCategory(log: Log, category: CategoryKey) {
  return log.points * attributionShareForCategory(log, category);
}

function effortShareForCategory(log: Log, category: CategoryKey) {
  return attributionShareForCategory(log, category);
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
  start_time: string | null;
  duration_minutes: number | null;
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
    startTime: row.start_time || undefined,
    durationMinutes: row.duration_minutes ?? undefined,
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
  const [tab, setTab] = useState<'dashboard' | 'history' | 'activity' | 'analytics' | 'friends'>('dashboard');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [quickCategory, setQuickCategory] = useState<Category | null>(null);
  const [composerCategory, setComposerCategory] = useState<CategoryKey | undefined>(undefined);
  const [showComposer, setShowComposer] = useState(false);
  const [composerSession, setComposerSession] = useState(0);
  const [editingLog, setEditingLog] = useState<Log | null>(null);
  const [showPriority, setShowPriority] = useState(false);
  const [recentLogId, setRecentLogId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [cloudReady, setCloudReady] = useState(!supabaseConfigured);
  const [profileName, setProfileName] = useState('Prince');
  const [accountOpen, setAccountOpen] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryEmailVerified, setRecoveryEmailVerified] = useState(false);
  const [securityEmailDraft, setSecurityEmailDraft] = useState('');
  const [savingSecurityEmail, setSavingSecurityEmail] = useState(false);
  const [securityEmailError, setSecurityEmailError] = useState('');
  const [securityEmailSaved, setSecurityEmailSaved] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(supabaseConfigured ? null : true);

  useEffect(() => {
    if (!supabase || !user) {
      setUnreadNotifications(0);
      return;
    }

    const client = supabase;
    const userId = user.id;

    async function refreshUnreadNotifications() {
      const { count, error } = await client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);

      if (!error) {
        setUnreadNotifications(count ?? 0);
      }
    }

    refreshUnreadNotifications();

    const channel = client
      .channel(`global-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const inserted = payload.new as HimothyNotification;

            if (!inserted.read_at && !notificationPanelOpen) {
              setUnreadNotifications((current) => current + 1);
            }

            window.setTimeout(() => {
              refreshUnreadNotifications();
            }, 750);

            return;
          }

          refreshUnreadNotifications();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [user?.id, notificationPanelOpen]);

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
        points: log.points ?? 5,
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
        client
          .from('logs')
          .select('*')
          .eq('user_id', account.id)
          .order('created_at', { ascending: false }),
        client.from('user_priorities').select('priorities').maybeSingle(),
        client.from('profiles').select('display_name,onboarding_completed,recovery_email,recovery_email_verified').eq('id', account.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (logsError) {
        setToast(`Cloud sync needs setup: ${logsError.message}`);
        setCloudReady(true);
        return;
      }

      if (profileRow?.display_name) setProfileName(profileRow.display_name);
      setRecoveryEmail(profileRow?.recovery_email || '');
      setRecoveryEmailVerified(Boolean(profileRow?.recovery_email_verified));
      if (typeof profileRow?.onboarding_completed === 'boolean') setOnboardingComplete(profileRow.onboarding_completed);
      else setProfileName(account.user_metadata?.display_name || account.email?.split('@')[0] || 'Bettr');
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
                start_time: local.startTime || null,
                duration_minutes: local.durationMinutes ?? null,
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
  }, [user?.id]);

  async function refreshUnreadNotifications() {
    if (!supabase || !user) {
      setUnreadNotifications(0);
      return;
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);

    if (!error) setUnreadNotifications(count || 0);
  }

  useEffect(() => {
    if (!user) {
      setUnreadNotifications(0);
      return;
    }

    refreshUnreadNotifications();

    const timer = window.setInterval(() => {
      refreshUnreadNotifications();
    }, 20000);

    return () => window.clearInterval(timer);
  }, [user?.id, tab]);

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
    categories.forEach((c) => {
      const earned = logs
        .filter((log) => log.points > 0)
        .reduce((sum, log) => sum + pointsForCategory(log, c.key), 0);

      result[c.key] = Math.min(99, Math.max(0, Math.round(earned)));
    });
    return result;
  }, [logs]);

  const discipline = useMemo(() => {
    const week = new Date();
    week.setHours(0, 0, 0, 0);
    week.setDate(week.getDate() - 6);
    const recent = logs.filter(
      (log) =>
        log.points > 0 &&
        new Date(`${log.date}T12:00:00`) >= week
    );
    const totalWeight = categories.reduce((sum, category) => sum + priorityWeights[priorities[category.key]], 0);
    const earned = categories.reduce((sum, category) => {
      const count = recent.reduce((sum, log) => sum + effortShareForCategory(log, category.key), 0);
      const priority = priorities[category.key];
      return sum + Math.min(1, count / priorityTargets[priority]) * priorityWeights[priority];
    }, 0);
    return Math.round((earned / totalWeight) * 100);
  }, [logs, priorities]);

  const todayLogs = logs.filter((log) => log.date === todayISO());
  const activeDays = new Set(
    logs
      .filter((log) => log.points > 0 && log.date >= dayISO(-6))
      .map((log) => log.date)
  ).size;
  const level = Math.max(1, Math.floor(logs.reduce((sum, log) => sum + log.points, 0) / 28) + 1);
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
        start_time: finalLog.startTime || null,
        duration_minutes: finalLog.durationMinutes ?? null,
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
    if (!canBypassSemanticGateForQuickClaim(category, activity)) {
      console.error('Blocked untrusted quick claim; free text cannot bypass 3A.', {
        category,
        activity,
      });
      setToast('That action isn’t an approved quick claim. Use a custom entry.');
      return;
    }

    const id = crypto.randomUUID();
    const points = applyPriorityReward(5, [category], priorities);

    const log: Log = {
      id,
      category,
      activity,
      date: todayISO(),
      timestamp: Date.now(),
      points,
    };

    setLogs((prev) => [log, ...prev]);
    setQuickCategory(null);
    setRecentLogId(id);
    setToast(`+${points} ${categoryFor(category).short} · claimed`);
    window.setTimeout(() => setRecentLogId(null), 1200);
    await persistCloudLog(log);
  }

  function openComposer(category?: CategoryKey) {
    setComposerCategory(category);
    setQuickCategory(null);
    setComposerSession((value) => value + 1);
    setShowComposer(true);
  }

  async function saveCustomLog(log: Omit<Log, 'id' | 'timestamp'>) {
    const id = crypto.randomUUID();

    const finalPoints = Number(log.points || 0);
    if (finalPoints <= 0) {
      console.error('Blocked new custom log with non-positive points after semantic gate.', {
        activity: log.activity,
        points: finalPoints,
      });
      setToast("Bettr couldn't award progress for this entry. Try again.");
      return;
    }

    const newLog: Log = {
      ...log,
      id,
      timestamp: Date.now(),
      points: finalPoints,
      custom: true,
      visibility: log.visibility || 'friends',
    };

    setLogs((prev) => [newLog, ...prev]);
    setShowComposer(false);
    setRecentLogId(id);
    setToast(`${categoryFor(log.category).emoji} Custom entry added`);

    window.setTimeout(() => setRecentLogId(null), 1200);
    await persistCloudLog(newLog);
  }

  async function updateLog(id: string, patch: Omit<Log, 'id' | 'timestamp'>) {
    // Semantic rejection must never call this. Failed edits leave the original row unchanged.
    const current = logs.find((item) => item.id === id);
    if (!current) return;
    let updated: Log = {
      ...current,
      ...patch,
      id,
      timestamp: current.timestamp,
      visibility: Number(patch.points || 0) <= 0
        ? 'private'
        : (patch.visibility || current.visibility || 'friends'),
    };
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
          log_date: updated.date, start_time: updated.startTime || null, duration_minutes: updated.durationMinutes ?? null, points: updated.points, image_path: updated.imagePath || null, ai_insight: updated.aiInsight || null, custom: Boolean(updated.custom), visibility: updated.visibility || 'friends',
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

  async function persistPriorities(nextPriorities: Record<CategoryKey, Priority>) {
    setPriorities(nextPriorities);

    if (!supabase || !user) return true;

    const { error } = await supabase
      .from('user_priorities')
      .upsert({
        user_id: user.id,
        priorities: nextPriorities,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      setToast(`Could not sync priorities: ${error.message}`);
      return false;
    }

    return true;
  }

  async function finishOnboarding(
    nextPriorities: Record<CategoryKey, Priority>,
    startLog = false,
    suggestedCategory: CategoryKey = 'mind'
  ) {
    setOnboardingComplete(true);

    if (supabase && user) {
      const client = supabase;

      const [{ error: priorityError }, { error: profileError }] =
        await Promise.all([
          client
            .from('user_priorities')
            .upsert({
              user_id: user.id,
              priorities: nextPriorities,
              updated_at: new Date().toISOString(),
            }),

          client
            .from('profiles')
            .update({
              onboarding_completed: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', user.id),
        ]);

      if (priorityError || profileError) {
        setOnboardingComplete(false);
        setToast(
          `Could not finish onboarding: ${
            priorityError?.message ||
            profileError?.message ||
            'unknown error'
          }`
        );
        return;
      }
    }

    setPriorities(nextPriorities);

    if (startLog) {
      setComposerCategory(suggestedCategory);
      setComposerSession((value) => value + 1);
      setShowComposer(true);
    }
  }


  async function saveRecoveryEmail() {
    if (!supabase || !user || savingSecurityEmail) return;

    const email = securityEmailDraft.trim().toLowerCase();

    setSavingSecurityEmail(true);
    setSecurityEmailError('');

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      const accessToken = sessionData.session?.access_token;

      if (sessionError || !accessToken) {
        throw new Error('Your session expired. Sign in again and retry.');
      }

      const response = await fetch('/api/account/security', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recoveryEmail: email || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload?.error || 'Could not update recovery email.'
        );
      }

      setRecoveryEmail(email);
      setSecurityEmailDraft(email);
      setRecoveryEmailVerified(false);
      setToast(
        email
          ? 'Recovery email saved.'
          : 'Recovery email removed.'
      );
    } catch (error) {
      setSecurityEmailError(
        error instanceof Error
          ? error.message
          : 'Could not update recovery email.'
      );
    } finally {
      setSavingSecurityEmail(false);
    }
  }


  async function deleteAccount() {
    if (!supabase || !user || deleteConfirm !== 'DELETE' || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteAccountError('');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error('Your session expired. Sign in again and retry.');

      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Could not delete your account.');

      try {
        localStorage.removeItem(`himothy.logs.v2.${user.id}`);
        localStorage.removeItem('himothy.logs.v2');
        localStorage.removeItem('himothy.logs');
        localStorage.removeItem('himothy.legacyMigrationClaimed');
      } catch {}

      setLogs([]);

      await supabase.auth.signOut();
      setShowDeleteAccount(false);
    } catch (error) {
      setDeleteAccountError(error instanceof Error ? error.message : 'Could not delete your account.');
    } finally {
      setDeletingAccount(false);
    }
  }

  async function openActivity() {
    setNotificationPanelOpen(false);
    setTab('activity');

    if (!supabase || !user) return;

    const readAt = new Date().toISOString();

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('user_id', user.id)
      .is('read_at', null);

    if (!error) {
      setUnreadNotifications(0);
    }
  }

  if (supabaseConfigured && !authReady) return <CloudBoot/>;
  if (supabaseConfigured && authReady && !user) return <AuthScreen/>;
  if (supabaseConfigured && user && (!cloudReady || onboardingComplete === null)) return <CloudBoot/>;
  if (supabaseConfigured && user && onboardingComplete === false) {
    return <OnboardingFlow profileName={profileName} initialPriorities={priorities} onFinish={finishOnboarding}/>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PRIVATE BETA</p>
          <h1>BETTR</h1>
          <p className="subtitle">Get Bettr. Together.</p>
        </div>
        <div className="accountCluster">
          {supabaseConfigured && <span className={`cloudBadge ${cloudReady ? 'ready' : ''}`}><Cloud size={13}/> {cloudReady ? 'Cloud' : 'Syncing'}</span>}
          {supabaseConfigured && user && (
            <div className="notificationControl">
              <button
                className={`notificationBell ${notificationPanelOpen ? 'open' : ''}`}
                aria-label="Notifications"
                title="Notifications"
                onClick={() => {
                  setAccountOpen(false);
                  setNotificationPanelOpen((open) => {
                    if (!open) setUnreadNotifications(0);
                    return !open;
                  });
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
                  onViewAll={openActivity}
                  onOpenFriends={() => {
                    setNotificationPanelOpen(false);
                    setTab('friends');
                  }}
                />
              )}
            </div>
          )}
          <button className="avatar" aria-label="Profile" onClick={() => { setNotificationPanelOpen(false); setAccountOpen((value) => !value); }}>{profileName.slice(0, 1).toUpperCase()}</button>
          {accountOpen && (
            <div className="accountMenu card">
              <strong>{profileName}</strong>
              <small>Bettr account</small>
              {supabaseConfigured ? (
                <>
                  <button onClick={() => {
                    setAccountOpen(false);
                    setSecurityEmailDraft(recoveryEmail);
                    setSecurityEmailError('');
                    setSecurityEmailSaved(false);
                    setShowAccountSettings(true);
                  }}>
                    <Settings size={15}/> Account settings
                  </button>
                  <button onClick={async () => { setAccountOpen(false); await supabase?.auth.signOut(); }}><LogOut size={15}/> Sign out</button>

                </>
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
        <button className={tab === 'activity' ? 'active' : ''} onClick={openActivity}>
          <MessageCircle size={17}/> Activity
          {unreadNotifications > 0 && <span className="navBadge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
        </button>
        <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}><Sparkles size={17}/> Analytics</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}><Users size={17}/> Friends</button>
      </nav>

      {tab === 'dashboard' && (
        <>
          <section className="hero card">
            <div className="heroCopy">
              <p className="eyebrow">YOUR BETTR</p>
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
              <button className="miniPriority priorityAttention" onClick={() => setShowPriority(true)}>
                <Flame size={16}/>
                <span>
                  <small>YOUR WEEK</small>
                  Tune priorities
                </span>
                <ChevronRight size={15}/>
              </button>
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
            <div><p className="eyebrow">PRIORITY MODE</p><h2>Discipline follows context.</h2><p>Finals week can be Academics-heavy. Recruiting season can be Career-heavy. Bettr scores whether your effort matches what you said matters.</p></div>
            <div className="priorityStack">
              {categories.filter((category) => priorities[category.key] === 'critical' || priorities[category.key] === 'high').map((category) => (
                <span key={category.key} className={priorities[category.key]}>{category.emoji} {category.short} · {priorities[category.key]}</span>
              ))}
            </div>
            <button className="priorityCardEdit" onClick={() => setShowPriority(true)}>
              Tune weekly priorities <ChevronRight size={15}/>
            </button>
          </section>

          <RecentMemories logs={logs.slice(0, 4)} onDelete={deleteLog} onEdit={setEditingLog}/>
        </>
      )}

      {tab === 'history' && <HistoryView logs={logs} onDelete={deleteLog} onEdit={setEditingLog}/>}
      {tab === 'activity' && user && (
        <ActivityView
          user={user}
          onUnreadChange={setUnreadNotifications}
          onOpenFriends={() => setTab('friends')}
        />
      )}
      {tab === 'analytics' && <AnalyticsView
          logs={logs}
          priorities={priorities}
          onTunePriorities={() => setShowPriority(true)}
        />}
      {tab === 'friends' && user && <FriendsView user={user} profileName={profileName} onProfileName={setProfileName}/>}

      <button className="floating" onClick={() => openComposer()}><Plus size={25}/> Log</button>

      <nav className="mobileNav">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><BarChart3 size={19}/><span>Build</span></button>
        <button
          className={tab === 'history' ? 'active' : ''}
          onClick={() => setTab('history')}
        >
          <CalendarDays size={19}/>
          <span>History</span>
        </button>
        <button className={tab === 'activity' ? 'active' : ''} onClick={openActivity}>
          <span className="mobileActivityIcon">
            <MessageCircle size={19}/>
            {unreadNotifications > 0 && <i>{unreadNotifications > 9 ? '9+' : unreadNotifications}</i>}
          </span>
          <span>Activity</span>
        </button>
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
              {TRUSTED_QUICK_ACTIVITIES[quickCategory.key].map((activity) => (
                <button key={activity} onClick={() => claimLog(quickCategory.key, activity)}><Check size={17}/>{activity}</button>
              ))}
            </div>
            <button className="customEntryButton" onClick={() => openComposer(quickCategory.key)}><Camera size={17}/> Custom entry + photo <ChevronRight size={16}/></button>
          </div>
        </div>
      )}

      {showComposer && (
        <CustomComposer
          key={`new-${composerSession}`}
          initialCategory={composerCategory}
          logs={logs}
          priorities={priorities}
          onClose={() => setShowComposer(false)}
          onSave={saveCustomLog}
        />
      )}

      {editingLog && (
        <CustomComposer
          key={`edit-${editingLog.id}`}
          initialCategory={editingLog.category}
          existing={editingLog}
          logs={logs}
          priorities={priorities}
          onClose={() => setEditingLog(null)}
          onSave={(patch) => updateLog(editingLog.id, patch)}
        />
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
            <button
              className="primaryButton"
              onClick={async () => {
                const saved = await persistPriorities(priorities);
                if (saved) {
                  setShowPriority(false);
                  setToast('Priorities saved.');
                }
              }}
            >
              Save priority mode
            </button>
          </div>
        </div>
      )}

      {showAccountSettings && (
        <div className="overlay" onClick={() => !savingSecurityEmail && setShowAccountSettings(false)}>
          <div
            className="modal accountSettingsModal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="close"
              disabled={savingSecurityEmail}
              onClick={() => setShowAccountSettings(false)}
            >
              <X/>
            </button>

            <p className="eyebrow">ACCOUNT SETTINGS</p>
            <h2>Security</h2>
            <p className="accountSettingsIntro">
              Your username and password are your primary Bettr login. Add an email for account recovery and stronger sign-in security later.
            </p>

            <section className="securitySettingCard">
              <div className="securitySettingTop">
                <div>
                  <strong>Recovery email</strong>
                  <p>
                    Optional. This email is never required to use Bettr.
                  </p>
                </div>

                {recoveryEmail ? (
                  <span className={`emailStatus ${recoveryEmailVerified ? 'verified' : 'pending'}`}>
                    {recoveryEmailVerified ? '✓ Verified' : 'Not verified'}
                  </span>
                ) : (
                  <span className="emailStatus empty">Not added</span>
                )}
              </div>

              <label className="securityEmailField">
                Email address
                <input
                  type="email"
                  value={securityEmailDraft}
                  disabled={savingSecurityEmail}
                  onChange={(event) => {
                    setSecurityEmailDraft(event.target.value);
                    setSecurityEmailError('');
                    setSecurityEmailSaved(false);
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>

              <div className="securityActions">
                <button
                  className="primaryButton"
                  disabled={
                    savingSecurityEmail ||
                    securityEmailDraft.trim().toLowerCase() === recoveryEmail.toLowerCase()
                  }
                  onClick={saveRecoveryEmail}
                >
                  {savingSecurityEmail
                    ? 'Saving…'
                    : recoveryEmail
                      ? 'Save email'
                      : 'Add email'}
                </button>

                {recoveryEmail && (
                  <button
                    className="verifyComingSoon"
                    disabled
                    title="Email delivery will be connected later"
                  >
                    Send verification
                    <small>Coming soon</small>
                  </button>
                )}
              </div>

              {securityEmailSaved && (
                <div className="securitySuccess">
                  ✓ Recovery email updated
                </div>
              )}

              {securityEmailError && (
                <div className="securityError">
                  {securityEmailError}
                </div>
              )}

              {recoveryEmail && !recoveryEmailVerified && (
                <div className="verificationNotice">
                  <strong>Verification isn&apos;t active yet.</strong>
                  <p>
                    Your email has been saved, but Bettr will not mark it verified until email delivery is connected.
                  </p>
                </div>
              )}
            </section>

            <section className="futureSecurityCard">
              <div>
                <span>NEW DEVICE PROTECTION</span>
                <strong>Require an email code on new devices</strong>
                <p>
                  Once email verification is available, you&apos;ll be able to use your verified email as an extra sign-in step.
                </p>
              </div>

              <button disabled>Coming soon</button>
            </section>

            <section className="dangerZoneCard">
              <div>
                <span>DANGER ZONE</span>
                <strong>Delete account</strong>
                <p>
                  Permanently delete your Bettr profile, logs, friendships, photos, and account data.
                </p>
              </div>

              <button
                className="dangerZoneButton"
                onClick={() => {
                  setShowAccountSettings(false);
                  setDeleteConfirm('');
                  setDeleteAccountError('');
                  setShowDeleteAccount(true);
                }}
              >
                <Trash2 size={15}/>
                Delete account
              </button>
            </section>
          </div>
        </div>
      )}

      {showDeleteAccount && (
        <div className="overlay" onClick={() => !deletingAccount && setShowDeleteAccount(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <button className="close" disabled={deletingAccount} onClick={() => setShowDeleteAccount(false)}><X/></button>
            <p className="eyebrow">ACCOUNT</p>
            <h2>Delete your Bettr account?</h2>
            <p>This permanently deletes your profile, logs, priorities, friendships, reactions, comments, and uploaded log photos. This cannot be undone.</p>
            <label style={{ display: 'grid', gap: 8, marginTop: 18 }}>
              <span>Type <strong>DELETE</strong> to confirm.</span>
              <input value={deleteConfirm} disabled={deletingAccount} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" autoComplete="off" />
            </label>
            {deleteAccountError && <p style={{ color: '#b42318', marginTop: 10 }}>{deleteAccountError}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="primaryButton" style={{ background: '#b42318', flex: 1 }} disabled={deleteConfirm !== 'DELETE' || deletingAccount} onClick={deleteAccount}>
                {deletingAccount ? 'Deleting…' : 'Delete account permanently'}
              </button>
              <button disabled={deletingAccount} onClick={() => setShowDeleteAccount(false)}>Cancel</button>
            </div>
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
        <div className="authMark">B</div>
        <p className="eyebrow">BETTR CLOUD</p>
        <h1>Getting your account ready.</h1>
        <p>Checking your session and syncing your progress.</p>
        <div className="syncPulse"><i/><i/><i/></div>
      </div>
    </main>
  );
}

function OnboardingFlow({ profileName, initialPriorities, onFinish }: {
  profileName: string;
  initialPriorities: Record<CategoryKey, Priority>;
  onFinish: (priorities: Record<CategoryKey, Priority>, startLog?: boolean, suggestedCategory?: CategoryKey) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState<CategoryKey[]>([]);
  const [mission, setMission] = useState<CategoryKey | null>(null);
  const [saving, setSaving] = useState(false);

  const firstName = profileName.trim().split(/\s+/)[0] || 'there';
  const totalSteps = 5;
  const toggleFocus = (key: CategoryKey) => {
    setFocus((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const configuredPriorities = () => {
    const next = { ...initialPriorities };
    categories.forEach((category) => { next[category.key] = 'maintenance'; });
    focus.forEach((key) => { next[key] = key === mission ? 'critical' : 'high'; });
    return next;
  };
  async function finish(startLog: boolean) {
    if (!mission) return;
    setSaving(true);
    await onFinish(configuredPriorities(), startLog, mission);
    setSaving(false);
  }

  return (
    <main className={onboardingStyles.shell}>
      <div className={onboardingStyles.frame}>
        <header className={onboardingStyles.header}>
          <div><span className={onboardingStyles.mark}>B</span><strong>BETTR</strong></div>
          <span>{Math.min(step + 1, totalSteps)} / {totalSteps}</span>
        </header>
        <div className={onboardingStyles.progress}><i style={{ width: `${((step + 1) / totalSteps) * 100}%` }}/></div>

        {step === 0 && <section className={onboardingStyles.panel}>
          <p className={onboardingStyles.kicker}>WELCOME, {firstName.toUpperCase()}</p>
          <h1>Keep track of the work<br/>you&apos;re already doing.</h1>
          <p className={onboardingStyles.lead}>Bettr helps you log the things you do to improve, see the progress add up, and build alongside people close to you.</p>
          <div className={onboardingStyles.promiseCard}>
            <div className={onboardingStyles.promiseCopy}>
              <strong>Build momentum you can actually see.</strong>
              <p>Track meaningful progress without turning self-improvement into homework.</p>
            </div>

            <div className={onboardingStyles.momentumRail}>
              <div className={onboardingStyles.momentumStep}>
                <div className={onboardingStyles.momentumIcon}>⚡</div>
                <div>
                  <strong>DO</strong>
                  <span>Make progress</span>
                </div>
              </div>

              <div className={onboardingStyles.railLine} />

              <div className={onboardingStyles.momentumStep}>
                <div className={onboardingStyles.momentumIcon}>✎</div>
                <div>
                  <strong>LOG</strong>
                  <span>Claim the work</span>
                </div>
              </div>

              <div className={onboardingStyles.railLine} />

              <div className={onboardingStyles.momentumStep}>
                <div className={onboardingStyles.momentumIcon}>↗</div>
                <div>
                  <strong>BUILD</strong>
                  <span>See momentum</span>
                </div>
              </div>
            </div>
          </div>
          <button className={onboardingStyles.primary} onClick={() => setStep(1)}>Get started <ChevronRight size={17}/></button>
        </section>}

        {step === 1 && <section className={onboardingStyles.panel}>
          <p className={onboardingStyles.kicker}>YOUR FOCUS</p>
          <h1>What are you focused on right now?</h1>
          <p className={onboardingStyles.lead}>Pick at least one. Choose whatever matters to you right now — you can change these priorities anytime.</p>
          <div className={onboardingStyles.categoryGrid}>{categories.map((category) => <button key={category.key} className={`${onboardingStyles.category} ${focus.includes(category.key) ? onboardingStyles.selected : ''}`} onClick={() => toggleFocus(category.key)}><span>{category.emoji}</span><div><strong>{category.short}</strong><small>{category.description}</small></div>{focus.includes(category.key) && <Check size={17}/>}</button>)}</div>
          <div className={onboardingStyles.actions}><button className={onboardingStyles.back} onClick={() => setStep(0)}>Back</button><button className={onboardingStyles.primary} disabled={focus.length < 1} onClick={() => { if (!focus.includes(mission as CategoryKey)) setMission(null); setStep(2); }}>Choose priorities <ChevronRight size={17}/></button></div>
        </section>}

        {step === 2 && <section className={onboardingStyles.panel}>
          <p className={onboardingStyles.kicker}>PRIORITY MODE</p>
          <h1>What matters most right now?</h1>
          <p className={onboardingStyles.lead}>Choose one main focus. Bettr&apos;s Discipline score rewards consistency with what you said matters—not trying to do everything every day.</p>
          <div className={onboardingStyles.missionList}>{focus.map((key) => { const category = categoryFor(key); return <button key={key} className={`${onboardingStyles.mission} ${mission === key ? onboardingStyles.selected : ''}`} onClick={() => setMission(key)}><span>{category.emoji}</span><div><strong>{category.label}</strong><small>{mission === key ? 'Critical priority' : 'Make this my main focus'}</small></div>{mission === key && <Check size={18}/>}</button>; })}</div>
          <div className={onboardingStyles.note}><strong>How scoring works</strong><p>Your main focus becomes Critical, your other selected areas become High, and everything else stays in Maintenance. One activity has one total reward—even if it legitimately belongs to multiple categories.</p></div>
          <div className={onboardingStyles.actions}><button className={onboardingStyles.back} onClick={() => setStep(1)}>Back</button><button className={onboardingStyles.primary} disabled={!mission} onClick={() => setStep(3)}>Continue <ChevronRight size={17}/></button></div>
        </section>}

        {step === 3 && <section className={onboardingStyles.panel}>
          <p className={onboardingStyles.kicker}>HOW IT WORKS</p>
          <h1>Log the progress. Keep the context.</h1>
          <div className={onboardingStyles.explainGrid}>
            <article><span>⚡</span><div><strong>Quick Log</strong><p>Two taps for common things like studying, lifting, cooking, or reading.</p></div></article>
            <article><span>✍️</span><div><strong>Custom entries</strong><p>Add details, photos, dates, and multiple categories when something is worth remembering.</p></div></article>
            <article><span>◎</span><div><strong>Progress & Discipline</strong><p>Your stats show accumulated evidence. Discipline measures how consistently your effort follows your priorities.</p></div></article>
          </div>
          <div className={onboardingStyles.example}><small>EXAMPLE</small><div><span>💼</span><div><strong>Worked on my app</strong><p>Career + Mind & Craft · 5 total points</p></div><b>+5</b></div></div>
          <div className={onboardingStyles.actions}><button className={onboardingStyles.back} onClick={() => setStep(2)}>Back</button><button className={onboardingStyles.primary} onClick={() => setStep(4)}>Continue <ChevronRight size={17}/></button></div>
        </section>}

        {step === 4 && <section className={onboardingStyles.panel}>
          <p className={onboardingStyles.kicker}>BUILD WITH FRIENDS</p>
          <h1>Share what you want.<br/>Keep the rest yours.</h1>
          <p className={onboardingStyles.lead}>Friends can see entries you share, react, and comment. Set any entry to Private when you want it to stay yours.</p>
          <div className={onboardingStyles.privacy}><div><Users size={20}/><span><strong>Friends</strong><small>Visible to accepted friends</small></span></div><div><span className={onboardingStyles.lock}>🔒</span><span><strong>Private</strong><small>Only visible to you</small></span></div></div>
          <div className={onboardingStyles.ready}><strong>You&apos;re set.</strong><p>Want to claim something you&apos;ve already done today?</p></div>
          <div className={onboardingStyles.finishActions}><button className={onboardingStyles.primary} disabled={saving} onClick={() => finish(true)}><Plus size={17}/>{saving ? 'Saving…' : 'Log something'}</button><button className={onboardingStyles.skip} disabled={saving} onClick={() => finish(false)}>Skip for now</button></div>
          <button className={onboardingStyles.backLink} onClick={() => setStep(3)}>Back</button>
        </section>}
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

    if (!supabase || !usernameValid || password.length < 6) return;

    if (mode === 'signup' && !displayName.trim()) {
      setMessage('Add your name to finish your profile.');
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          username: cleanUsername,
          password,
          displayName: mode === 'signup' ? displayName.trim() : undefined,
          recoveryEmail: mode === 'signup' && email.trim() ? email.trim() : undefined,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload?.code === 'username_taken') {
          setUsernameStatus('taken');
        }

        throw new Error(payload?.error || 'Could not authenticate.');
      }

      if (!payload?.access_token || !payload?.refresh_token) {
        throw new Error('Could not start your session.');
      }

      const { error } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });

      if (error) throw error;
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
        <h1>BETTR</h1>
        <h2>Get Bettr.<br/><span>Together.</span></h2>
        <p>Your progress, priorities, photos, and history now follow you across devices.</p>
        <div className="authPromises">
          <span><Check size={15}/> Private account</span>
          <span><Cloud size={15}/> Cloud-synced progress</span>
          <span><ImageIcon size={15}/> Private photo storage</span>
        </div>
      </section>
      <form className="authCard card" onSubmit={submit}>
        <div className="authMark">B</div>
        <p className="eyebrow">{mode === 'signin' ? 'WELCOME BACK' : 'JOIN BETTR'}</p>
        <h2>{mode === 'signin' ? 'Lock back in.' : 'Create your profile.'}</h2>
        <p>{mode === 'signin' ? 'Sign in with your username and password.' : 'Pick the name and unique @username your friends will know you by.'}</p>
        {mode === 'signup' && (
          <label className="authField">
            Name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Prince"
              autoComplete="name"
              required
            />
          </label>
        )}

        <label className="authField">
          Username
          <div className="authUsernameWrap">
            <span>@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
              placeholder="prince"
              autoComplete="username"
              maxLength={30}
              required
            />
          </div>
        </label>

        {mode === 'signup' && (
          <div className={`usernameAvailability ${usernameStatus}`}>
            {usernameStatus === 'checking' && 'Checking availability…'}
            {usernameStatus === 'available' && <><Check size={12}/> @{cleanUsername} is available</>}
            {usernameStatus === 'taken' && <><X size={12}/> @{cleanUsername} is already taken</>}
            {usernameStatus === 'invalid' && 'Use 3–30 lowercase letters, numbers, underscores, or periods.'}
            {usernameStatus === 'error' && 'Could not check availability yet. We’ll verify when you create the account.'}
          </div>
        )}

        <label className="authField">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
          />
        </label>

        {mode === 'signup' && (
          <label className="authField">
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>Email</span>
              <span style={{ opacity: .5, fontSize: 11 }}>OPTIONAL</span>
            </span>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="For recovery & account security"
              autoComplete="email"
            />

            <small style={{ opacity: .55, lineHeight: 1.45 }}>
              Not required to create your account. You&apos;ll be able to verify it later for recovery and extra sign-in security.
            </small>
          </label>
        )}
        {message && <div className="authMessage">{message}</div>}
        <button className="primaryButton authSubmit" disabled={busy || !usernameValid || (mode === 'signup' && (usernameStatus === 'checking' || usernameStatus === 'taken' || usernameStatus === 'invalid'))}>{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="authSwitch" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null); }}>
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

function CustomComposer({ initialCategory, existing, logs, priorities, onClose, onSave }: {
  initialCategory?: CategoryKey;
  existing?: Log;
  logs: Log[];
  priorities: Record<CategoryKey, Priority>;
  onClose: () => void;
  onSave: (log: Omit<Log, 'id' | 'timestamp'>) => void;
}) {
  const [selectedCategories, setSelectedCategories] = useState<CategoryKey[]>(
    existing ? categoriesForLog(existing) : initialCategory ? [initialCategory] : []
  );
  const [activity, setActivity] = useState(existing?.activity || '');
  const [details, setDetails] = useState(existing?.details || '');
  const [date, setDate] = useState(existing?.date || todayISO());
  const [startTime, setStartTime] = useState(
    existing?.startTime?.slice(0, 5) || ''
  );
  const [durationHours, setDurationHours] = useState(
    existing?.durationMinutes ? String(Math.floor(existing.durationMinutes / 60) || '') : ''
  );
  const [durationMinutes, setDurationMinutes] = useState(
    existing?.durationMinutes ? String(existing.durationMinutes % 60 || '') : ''
  );
  const [image, setImage] = useState<string | undefined>(existing?.image);
  const [analyze, setAnalyze] = useState(true);
  const [visibility, setVisibility] = useState<'friends' | 'private'>(
    existing?.visibility || 'private'
  );
  const [busy, setBusy] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [modelReady, setModelReady] = useState(isClientMiniLmLoaded());
  const [gateNotice, setGateNotice] = useState<
    | 'invalid'
    | 'non'
    | 'uncertain'
    | 'uncertain_rejected'
    | 'technical'
    | 'scoring_conflict'
    | 'clarification_needed'
    | 'category_mismatch'
    | null
  >(null);
  const [categoryMismatchNotice, setCategoryMismatchNotice] = useState<string | null>(null);
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const [clarificationText, setClarificationText] = useState('');
  const [frozenOriginalText, setFrozenOriginalText] = useState<string | null>(null);
  const [categoryRequiredError, setCategoryRequiredError] = useState(false);
  const [debouncedSuggestionText, setDebouncedSuggestionText] = useState('');
  const [suggestedCategories, setSuggestedCategories] = useState<CategoryKey[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const evaluatingRef = useRef(false);
  const closedRef = useRef(false);
  const isEdit = Boolean(existing);
  const usageCounts = useMemo(() => countCategoryUsage(logs), [logs]);
  const orderedCategories = useMemo(
    () => orderComposerCategories(priorities, usageCounts),
    [priorities, usageCounts]
  );
  const baseEstimatedPoints = activity.trim() && selectedCategories.length
    ? calculateDeterministicBasePoints(details, Boolean(image))
    : 0;

  const estimatedPoints = applyPriorityReward(
    baseEstimatedPoints,
    selectedCategories,
    priorities
  );

  function resetClarificationSession() {
    setAwaitingClarification(false);
    setClarificationText('');
    setFrozenOriginalText(null);
    if (gateNotice === 'uncertain' || gateNotice === 'uncertain_rejected' || gateNotice === 'clarification_needed') {
      setGateNotice(null);
    }
  }

  function onSemanticSourceChange(nextActivity: string, nextDetails: string) {
    const nextOriginal = composeSemanticLogText(nextActivity, nextDetails);
    if (shouldResetClarificationSession(frozenOriginalText, nextOriginal)) {
      resetClarificationSession();
    }
    if (gateNotice && gateNotice !== 'uncertain') {
      setGateNotice(null);
    }
  }

  useEffect(() => {
    closedRef.current = false;
    let cancelled = false;
    void loadClientMiniLm()
      .then(() => {
        if (!cancelled) setModelReady(true);
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      cancelled = true;
      closedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSuggestionText(`${activity}\n\u001f${details}`);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activity, details]);

  useEffect(() => {
    let cancelled = false;
    const [nextActivity, nextDetails = ''] = debouncedSuggestionText.split('\n\u001f');
    const activityText = (nextActivity || '').trim();
    const detailsText = nextDetails.trim();

    if (!activityText && !detailsText) {
      setSuggestedCategories([]);
      return;
    }

    async function refreshSuggestions() {
      if (!isClientMiniLmLoaded()) {
        const fallback = additionalCategorySuggestions(
          activityText,
          detailsText,
          selectedCategories,
          orderedCategories
        );
        if (!cancelled) setSuggestedCategories(fallback);
        return;
      }

      try {
        const next = await suggestCategoriesHybrid({
          activity: activityText,
          details: detailsText,
          selected: selectedCategories,
          embedMany: embedTextsClient,
        });
        if (!cancelled) setSuggestedCategories(next);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setSuggestedCategories(
            additionalCategorySuggestions(
              activityText,
              detailsText,
              selectedCategories,
              orderedCategories
            )
          );
        }
      }
    }

    void refreshSuggestions();
    return () => {
      cancelled = true;
    };
  }, [debouncedSuggestionText, selectedCategories, orderedCategories, modelReady]);

  function toggleCategory(key: CategoryKey) {
    setSelectedCategories((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      if (next.length) setCategoryRequiredError(false);
      return next;
    });
    if (gateNotice === 'category_mismatch') {
      setGateNotice(null);
      setCategoryMismatchNotice(null);
    }
  }

  function addSuggestedCategory(key: CategoryKey) {
    setSelectedCategories((current) => current.includes(key) ? current : [...current, key]);
    setCategoryRequiredError(false);
    if (gateNotice === 'category_mismatch') {
      setGateNotice(null);
      setCategoryMismatchNotice(null);
    }
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { setImage(await compressImage(file)); } finally { setBusy(false); }
  }

  function buildLogPayload(
    cleanActivity: string,
    points: number,
    persistedDetails: string
  ): Omit<Log, 'id' | 'timestamp'> {
    const totalDurationMinutes =
      (Math.max(0, Number(durationHours) || 0) * 60) +
      Math.max(0, Number(durationMinutes) || 0);
    const labels = selectedCategories.map((key) => categoryFor(key).short).join(' + ');

    return {
      category: selectedCategories[0],
      categories: selectedCategories,
      activity: cleanActivity,
      details: persistedDetails,
      image,
      imagePath: existing?.imagePath,
      aiInsight: analyze
        ? gatedProgressInsight(labels, persistedDetails, Boolean(image))
        : undefined,
      date,
      startTime: startTime || undefined,
      durationMinutes: totalDurationMinutes > 0 ? totalDurationMinutes : undefined,
      points,
      custom: true,
      visibility,
    };
  }

  function sameCategorySelection(log: Log, keys: CategoryKey[]) {
    const existingKeys = categoriesForLog(log);
    if (existingKeys.length !== keys.length) return false;
    return existingKeys.every((key) => keys.includes(key));
  }

  async function blockObviousCategoryMismatch(text: string) {
    const selectedLabel =
      selectedCategories.length === 1
        ? categoryFor(selectedCategories[0]).short
        : 'the selected categories';
    try {
      const verdict = await evaluateObviousCategoryMismatch({
        text,
        selected: selectedCategories,
        embedMany: embedTextsClient,
      });
      if (!verdict.mismatch) return false;
      setCategoryMismatchNotice(
        categoryMismatchMessage(selectedLabel, categoryFor(verdict.alternativeKey).short)
      );
      setGateNotice('category_mismatch');
      return true;
    } catch (err) {
      console.error(err);
      setGateNotice('technical');
      return true;
    }
  }

  async function submitGated() {
    if (evaluatingRef.current || evaluating) return;
    const cleanActivity = activity.trim();
    if (!cleanActivity) return;
    if (!selectedCategories.length) {
      setCategoryRequiredError(true);
      return;
    }

    const precheck = resolveComposerSubmitPrecheck({
      activity: cleanActivity,
      details,
      awaitingClarification,
      frozenOriginalText,
      clarificationText,
    });

    if (precheck.type === 'noop') return;
    if (precheck.type === 'need_clarification_text') {
      setGateNotice('clarification_needed');
      return;
    }
    if (precheck.type === 'trivial_clarification') {
      setAwaitingClarification(false);
      setFrozenOriginalText(null);
      setGateNotice('uncertain_rejected');
      return;
    }
    if (precheck.type === 'invalid') {
      setAwaitingClarification(false);
      setFrozenOriginalText(null);
      setClarificationText('');
      setGateNotice('invalid');
      return;
    }

    const { originalText, clarificationPass } = precheck;

    const skipGate =
      isEdit &&
      existing &&
      !clarificationPass &&
      !shouldReevaluateEditedLog({
        existingPoints: existing.points,
        existingSemanticText: composeSemanticLogText(
          existing.activity,
          existing.details || ''
        ),
        nextSemanticText: originalText,
      });

    if (skipGate) {
      const categoriesUnchanged = existing ? sameCategorySelection(existing, selectedCategories) : true;
      if (!categoriesUnchanged) {
        evaluatingRef.current = true;
        setEvaluating(true);
        try {
          if (await blockObviousCategoryMismatch(originalText) || closedRef.current) return;
        } finally {
          evaluatingRef.current = false;
          setEvaluating(false);
        }
      }
      const basePoints = calculateDeterministicBasePoints(details, Boolean(image));
      const points = applyPriorityReward(basePoints, selectedCategories, priorities);
      if (points <= 0) {
        setGateNotice('scoring_conflict');
        return;
      }
      onSave(buildLogPayload(cleanActivity, points, details.trim()));
      return;
    }

    evaluatingRef.current = true;
    setEvaluating(true);
    setGateNotice(null);

    try {
      const result = await evaluateComposerSubmission({
        activity: cleanActivity,
        details,
        clarificationPass,
        clarificationText,
      });
      if (result.status === 'TECHNICAL_FAILURE') {
        console.error(result.error);
      }
      const ui = applyComposerGateDecisionToUi({
        clarificationPass,
        status: result.status,
      });

      if (ui.persist) {
        const persistedDetails = persistDetailsAfterGate({
          details,
          clarificationPass,
          clarificationText,
        });
        const basePoints = calculateDeterministicBasePoints(
          persistedDetails,
          Boolean(image)
        );
        const points = applyPriorityReward(basePoints, selectedCategories, priorities);
        if (!canPersistComposerResult({ kind: 'save' }, points) || closedRef.current) {
          if (points <= 0) {
            console.error('DEVELOPMENTAL custom log produced non-positive points', {
              basePoints,
              points,
              activity: cleanActivity,
            });
            setGateNotice('scoring_conflict');
          }
          return;
        }
        const persistText = composeSemanticLogText(cleanActivity, persistedDetails);
        if (await blockObviousCategoryMismatch(persistText) || closedRef.current) return;
        onSave(buildLogPayload(cleanActivity, points, persistedDetails));
        return;
      }

      setAwaitingClarification(ui.awaitingClarification);
      if (ui.awaitingClarification) {
        setFrozenOriginalText(originalText);
      } else {
        setFrozenOriginalText(null);
      }
      setGateNotice(ui.gateNotice);
    } finally {
      evaluatingRef.current = false;
      setEvaluating(false);
      setModelReady(isClientMiniLmLoaded());
    }
  }

  function submit() {
    void submitGated();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal composer" onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}><X/></button>
        <p className="eyebrow">{existing ? 'EDIT LOG' : 'CUSTOM LOG'}</p>
        <h2>{existing ? 'Update this entry.' : 'What did you do?'}</h2>
        <p>Select every area this activity meaningfully contributed to. The first selected area is the primary category.</p>

        <label className="fieldLabel">Categories <span>select at least one</span></label>
        <div className="categoryPicker multiCategoryPicker">
          {orderedCategories.map((item) => <button key={item.key} className={selectedCategories.includes(item.key) ? 'selected' : ''} onClick={() => toggleCategory(item.key)} title={item.label}>{item.emoji}<span>{item.short}</span></button>)}
        </div>
        {categoryRequiredError && (
          <p className="composerFieldError">{CATEGORY_REQUIRED_MESSAGE}</p>
        )}
        <div className="selectedCategorySummary">
          {selectedCategories.map((key) => (
            <span key={key} className="selectedCategoryPill">
              {categoryFor(key).emoji} {categoryFor(key).short}
              <button
                type="button"
                className="selectedCategoryRemove"
                aria-label={`Remove ${categoryFor(key).short}`}
                title={`Remove ${categoryFor(key).short}`}
                onClick={() => {
                  setSelectedCategories((current) =>
                    current.filter((item) => item !== key)
                  );
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {suggestedCategories.length > 0 && (
          <div className="composerAlsoFits">
            <span>{selectedCategories.length ? 'Also fits' : 'Suggested'}</span>
            {suggestedCategories.map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => addSuggestedCategory(key)}
                title={`Add ${categoryFor(key).label}`}
              >
                {categoryFor(key).emoji} {categoryFor(key).short}
              </button>
            ))}
          </div>
        )}

        <label className="fieldLabel" htmlFor="activity">Entry</label>
        <input id="activity" className="textInput" autoFocus value={activity} onChange={(event) => {
          const next = event.target.value;
          setActivity(next);
          onSemanticSourceChange(next, details);
        }} placeholder="e.g. Hit a new squat PR, cooked salmon bowls, talked to someone new…"/>

        <div className="composerSplit logTimingGrid">
          <div>
            <label className="fieldLabel" htmlFor="logDate">Date</label>
            <div className="dateField">
              <input
                id="logDate"
                className="textInput"
                type="date"
                max={todayISO()}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                title="Choose activity date"
              />
            </div>
            {existing && date !== existing.date && (
              <small className="dateEditHint">
                Date will update from {new Date(`${existing.date}T12:00:00`).toLocaleDateString()} to {new Date(`${date}T12:00:00`).toLocaleDateString()}.
              </small>
            )}
          </div>

          <div>
            <label className="fieldLabel" htmlFor="logStartTime">
              Start time <span>optional</span>
            </label>
            <input
              id="logStartTime"
              className="textInput startTimeInput"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              onClick={(event) => {
                event.currentTarget.showPicker?.();
              }}
              aria-label="Start time"
            />
          </div>

          <div className="durationField">
            <label className="fieldLabel">
              Duration <span>optional</span>
            </label>

            <div className="durationInputs">
              <label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  max="23"
                  inputMode="numeric"
                  value={durationHours}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '');
                    if (!digits) {
                      setDurationHours('');
                      return;
                    }
                    setDurationHours(String(Math.min(23, Number(digits))));
                  }}
                  onKeyDown={(event) => {
                    if (['-', '+', 'e', 'E', '.', ','].includes(event.key)) {
                      event.preventDefault();
                    }
                  }}
                  placeholder="0"
                  aria-label="Duration hours"
                />
                <span>hr</span>
              </label>

              <label>
                <input
                  className="textInput"
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  value={durationMinutes}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '');
                    if (!digits) {
                      setDurationMinutes('');
                      return;
                    }
                    setDurationMinutes(String(Math.min(59, Number(digits))));
                  }}
                  onKeyDown={(event) => {
                    if (['-', '+', 'e', 'E', '.', ','].includes(event.key)) {
                      event.preventDefault();
                    }
                  }}
                  placeholder="0"
                  aria-label="Duration minutes"
                />
                <span>min</span>
              </label>
            </div>
          </div>
        </div>

        <label className="fieldLabel">Who can see this?</label>
        <div className="visibilityPicker">
          <button type="button" className={visibility === 'friends' ? 'selected' : ''} onClick={() => setVisibility('friends')}><Users size={15}/> Friends</button>
          <button type="button" className={visibility === 'private' ? 'selected' : ''} onClick={() => setVisibility('private')}>🔒 Private</button>
        </div>

        <label className="fieldLabel" htmlFor="details">Details <span>optional</span></label>
        <textarea id="details" className="textArea" value={details} onChange={(event) => {
          const next = event.target.value;
          setDetails(next);
          onSemanticSourceChange(activity, next);
        }} placeholder="Numbers, context, what went well, what you learned, what you want to improve…"/>

        {gateNotice === 'category_mismatch' && categoryMismatchNotice && (
          <div className="composerGateNotice">
            <span>{categoryMismatchNotice}</span>
          </div>
        )}
        {gateNotice === 'invalid' && (
          <div className="composerGateNotice">
            <span>{COMPOSER_GATE_COPY.invalid}</span>
          </div>
        )}
        {gateNotice === 'non' && (
          <div className="composerGateNotice">
            <span>{COMPOSER_GATE_COPY.non}</span>
          </div>
        )}
        {gateNotice === 'technical' && (
          <div className="composerGateNotice">
            <span>{COMPOSER_GATE_COPY.technical}</span>
          </div>
        )}
        {gateNotice === 'scoring_conflict' && (
          <div className="composerGateNotice">
            <span>{COMPOSER_GATE_COPY.scoringConflict}</span>
          </div>
        )}
        {gateNotice === 'uncertain_rejected' && (
          <div className="composerGateNotice">
            <span>{COMPOSER_GATE_COPY.uncertainRejected}</span>
          </div>
        )}
        {awaitingClarification && (gateNotice === 'uncertain' || gateNotice === 'clarification_needed') && (
          <div className="composerClarification">
            <strong>{COMPOSER_GATE_COPY.uncertainHeading}</strong>
            <span>{COMPOSER_GATE_COPY.uncertainBody}</span>
            <textarea
              className="textArea"
              value={clarificationText}
              onChange={(event) => {
                setClarificationText(event.target.value);
                if (gateNotice === 'clarification_needed') setGateNotice('uncertain');
              }}
              placeholder="What did you do or accomplish?"
            />
            {gateNotice === 'clarification_needed' && (
              <small>Add a little more before Bettr can recheck this action.</small>
            )}
          </div>
        )}

        <input ref={fileRef} className="hiddenInput" type="file" accept="image/*" onChange={handleImage}/>
        {!image ? <button className="photoDrop" onClick={() => fileRef.current?.click()} disabled={busy}><ImageIcon size={22}/><div><strong>{busy ? 'Preparing photo…' : 'Add a photo'}</strong><small>Fit check, meal, gym PR, project screenshot, book, anything.</small></div></button> : <div className="photoPreview"><img src={image} alt="Custom log preview"/><button onClick={() => setImage(undefined)}><Trash2 size={16}/> Remove</button></div>}

        <label className="aiToggle"><input type="checkbox" checked={analyze} onChange={(event) => setAnalyze(event.target.checked)}/><span className="toggleTrack"><i/></span><div><strong><Sparkles size={15}/> Smart feedback</strong><small>Supportive prototype check. It evaluates the entry, never the person.</small></div></label>
        <button
          type="button"
          className="primaryButton submitLog"
          onClick={submit}
          disabled={!activity.trim() || busy || evaluating}
        >
          <Send size={17}/>
          {evaluating
            ? (modelReady ? COMPOSER_GATE_COPY.checking : COMPOSER_GATE_COPY.gettingReady)
            : awaitingClarification && (gateNotice === 'uncertain' || gateNotice === 'clarification_needed')
              ? COMPOSER_GATE_COPY.recheck
              : isEdit
                ? 'Save changes'
                : selectedCategories.length
                  ? `Check this action (+${estimatedPoints})`
                  : 'Check this action'}
        </button>
      </div>
    </div>
  );
}

function RecentMemories({ logs, onDelete, onEdit }: { logs: Log[]; onDelete: (id: string) => void; onEdit: (log: Log) => void }) {
  const [viewingLog, setViewingLog] = useState<Log | null>(null);

  return (
    <section className="memoriesSection">
      <div className="sectionHead"><div><p className="eyebrow">RECENT</p><h2>What you actually did.</h2><p>Entries become a private timeline of your progress.</p></div></div>

      <div className="memoryGrid">
        {logs.map((log) => (
          <LogCard
            key={log.id}
            log={log}
            onDelete={onDelete}
            onEdit={onEdit}
            onView={setViewingLog}
          />
        ))}
      </div>

      {viewingLog && (
        <LogDetailViewer
          log={viewingLog}
          onClose={() => setViewingLog(null)}
          onEdit={(log) => {
            setViewingLog(null);
            onEdit(log);
          }}
          onDelete={(id) => {
            setViewingLog(null);
            onDelete(id);
          }}
        />
      )}
    </section>
  );
}

function LogCard({
  log,
  onDelete,
  onEdit,
  onView,
}: {
  log: Log;
  onDelete: (id: string) => void;
  onEdit: (log: Log) => void;
  onView: (log: Log) => void;
}) {
  const logAreas = categoriesForLog(log);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;

    if (!start) return;

    const moved = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y
    );

    // A finger/mouse movement larger than 8px is treated as scrolling/dragging,
    // not an attempt to open the entry.
    if (moved <= 8) onView(log);
  }

  return (
    <article
      className={`memory card clickableHistoryLog ${log.image ? 'withImage' : ''}`}
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onView(log);
        }
      }}
    >
      {log.image && <img className="memoryPhoto" src={log.image} alt="Log attachment"/>}

      <div className="memoryBody">
        <div className="memoryTop">
          <span className="memoryCategory">
            {logAreas.map((key) => `${categoryFor(key).emoji} ${categoryFor(key).short}`).join(" · ")}
          </span>

          <span>
            <button
              className="iconButton"
              title="Edit entry"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(log);
              }}
            >
              <Pencil size={14}/>
            </button>

            <button
              className="iconButton"
              title="Delete entry"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(log.id);
              }}
            >
              <Trash2 size={14}/>
            </button>
          </span>
        </div>

        <h3>{log.activity}</h3>

        {log.details && <p>{log.details}</p>}

        {log.aiInsight && (
          <div className="aiInsight">
            <span><Sparkles size={14}/> SMART FEEDBACK · PROTOTYPE</span>
            <p>{log.aiInsight}</p>
          </div>
        )}

        <footer>
          <span>{new Date(`${log.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <b>+{log.points}</b>
        </footer>
      </div>
    </article>
  );
}

function LogDetailViewer({
  log,
  onClose,
  onEdit,
  onDelete,
}: {
  log: Log;
  onClose: () => void;
  onEdit: (log: Log) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <article
        className="modal historyLogViewer"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="close"
          onClick={onClose}
          aria-label="Close entry"
        >
          <X/>
        </button>

        <div className="historyViewerHead">
          <div>
            <p className="eyebrow">LOG ENTRY</p>
            <h2>{log.activity}</h2>
          </div>

          <b className="historyViewerPoints">+{log.points}</b>
        </div>

        <div className="historyViewerMeta">
          <span>
            {categoriesForLog(log)
              .map((key) => `${categoryFor(key).emoji} ${categoryFor(key).short}`)
              .join(' · ')}
          </span>

          <span>
            {new Date(`${log.date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>

          {log.startTime && (
            <span>
              🕒 {new Date(`1970-01-01T${log.startTime}`).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          )}

          {log.durationMinutes && (
            <span>
              ⏱ {[
                Math.floor(log.durationMinutes / 60) > 0
                  ? `${Math.floor(log.durationMinutes / 60)} hr`
                  : '',
                log.durationMinutes % 60 > 0
                  ? `${log.durationMinutes % 60} min`
                  : '',
              ].filter(Boolean).join(' ')}
            </span>
          )}

          <span>
            {log.visibility === 'private'
              ? '🔒 Private'
              : '👥 Friends'}
          </span>
        </div>

        {log.image && (
          <img
            className="historyViewerImage"
            src={log.image}
            alt="Log attachment"
          />
        )}

        <section className="historyViewerSection">
          <small>DETAILS</small>

          {log.details ? (
            <p>{log.details}</p>
          ) : (
            <p className="historyViewerMuted">
              No extra details were added.
            </p>
          )}
        </section>

        {log.aiInsight && (
          <section className="historyViewerSection">
            <small>SMART FEEDBACK</small>
            <p>{log.aiInsight}</p>
          </section>
        )}

        <div className="historyViewerActions">
          <button
            className="primaryButton"
            onClick={() => onEdit(log)}
          >
            <Pencil size={16}/>
            Edit entry
          </button>

          <button
            className="historyViewerDelete"
            onClick={() => onDelete(log.id)}
          >
            <Trash2 size={15}/>
            Delete
          </button>
        </div>
      </article>
    </div>
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
  const [viewingLog, setViewingLog] = useState<Log | null>(null);

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
                    <div
                      className="selectedLog clickableHistoryLog"
                      key={log.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setViewingLog(log)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setViewingLog(log);
                        }
                      }}
                    >
                      {log.image ? <img src={log.image} alt=""/> : <span>{category.emoji}</span>}
                      <div><strong>{log.activity}</strong><small>{category.short}{log.details ? ` · ${log.details}` : ''}</small></div>
                      <b>+{log.points}</b>
                      <button
                        className="iconButton"
                        title="Delete entry"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(log.id);
                        }}
                      >
                        <Trash2 size={14}/>
                      </button>
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
                <button
                  key={log.id}
                  onClick={() => {
                    setSelectedDate(log.date);
                    setViewingLog(log);
                  }}
                >
                  {log.image ? <img src={log.image} alt=""/> : <span>{categoryFor(log.category).emoji}</span>}
                  <div><strong>{log.activity}</strong><small>{categoryFor(log.category).short} · {new Date(`${log.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>
                </button>
              )) : <p className="sideEmpty">Photo logs, custom entries, and bigger wins will surface here.</p>}
            </div>
          </article>

          <DailyQuoteCard />
        </aside>
      </div>

      {viewingLog && (
        <div
          className="overlay"
          onClick={() => setViewingLog(null)}
        >
          <article
            className="modal historyLogViewer"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setViewingLog(null)}
              aria-label="Close entry"
            >
              <X/>
            </button>

            <div className="historyViewerHead">
              <div>
                <p className="eyebrow">LOG ENTRY</p>
                <h2>{viewingLog.activity}</h2>
              </div>

              <b className="historyViewerPoints">
                +{viewingLog.points}
              </b>
            </div>

            <div className="historyViewerMeta">
              <span>
                {categoriesForLog(viewingLog)
                  .map(
                    (key) =>
                      `${categoryFor(key).emoji} ${categoryFor(key).short}`
                  )
                  .join(' · ')}
              </span>

              <span>
                {new Date(
                  `${viewingLog.date}T12:00:00`
                ).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>

              <span>
                {viewingLog.visibility === 'private'
                  ? '🔒 Private'
                  : '👥 Friends'}
              </span>
            </div>

            {viewingLog.image && (
              <img
                className="historyViewerImage"
                src={viewingLog.image}
                alt="Log attachment"
              />
            )}

            {viewingLog.details ? (
              <section className="historyViewerSection">
                <small>DETAILS</small>
                <p>{viewingLog.details}</p>
              </section>
            ) : (
              <section className="historyViewerSection">
                <small>DETAILS</small>
                <p className="historyViewerMuted">
                  No extra details were added.
                </p>
              </section>
            )}

            {viewingLog.aiInsight && (
              <section className="historyViewerSection">
                <small>SMART FEEDBACK</small>
                <p>{viewingLog.aiInsight}</p>
              </section>
            )}

            <div className="historyViewerActions">
              <button
                className="primaryButton"
                onClick={() => {
                  const log = viewingLog;
                  setViewingLog(null);
                  onEdit(log);
                }}
              >
                <Pencil size={16}/>
                Edit entry
              </button>

              <button
                className="historyViewerDelete"
                onClick={() => {
                  const id = viewingLog.id;
                  setViewingLog(null);
                  onDelete(id);
                }}
              >
                <Trash2 size={15}/>
                Delete
              </button>
            </div>
          </article>
        </div>
      )}

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

function AnalyticsView({
  logs,
  priorities,
  onTunePriorities,
}: {
  logs: Log[];
  priorities: Record<CategoryKey, Priority>;
  onTunePriorities: () => void;
}) {
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
    points: recent.reduce((sum, log) => sum + pointsForCategory(log, category.key), 0),
  })).sort((a, b) => b.points - a.points);
  const maxPoints = Math.max(1, ...totals.map((item) => item.points));
  const activeAreas = totals.filter((item) => item.count > 0).length;
  const balance = activeAreas ? Math.round((activeAreas / categories.length) * 100) : 0;
  const top = totals[0];

  const criticalPriorities = categories.filter(
    (category) => priorities[category.key] === 'critical'
  );
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
          <button className="analyticsPriorityButton" onClick={onTunePriorities}>
            <Flame size={16}/>
            Tune weekly priorities
            <ChevronRight size={15}/>
          </button>
        </div>
        <div className="quoteChip"><span>“</span><p>{quote.text}</p><small>— {quote.author}</small></div>
      </div>

      <div className="analyticsMetrics">
        <article className="analyticsMetric card"><small>30-DAY POINTS</small><strong>{points}</strong><span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs prior 30d</span></article>
        <article className="analyticsMetric card"><small>ACTIVE DAYS</small><strong>{activeDays}<i>/30</i></strong><span>{Math.round((activeDays / 30) * 100)}% consistency</span></article>
        <article className="analyticsMetric card"><small>AREAS ACTIVE</small><strong>{activeAreas}<i>/10</i></strong><span>{balance}% life coverage</span></article>
        <article className="analyticsMetric card">
          <small>MOST ACTIVE</small>
          <strong className="focusStat">{top.category.emoji} {top.category.short}</strong>
          <span>{Math.round(top.points)} points · {top.count} logs in the last 30 days</span>
        </article>

        <article className="analyticsMetric card priorityMetric">
          <small>CRITICAL PRIORITIES</small>

          <div className="criticalPriorityList">
            {criticalPriorities.map((category) => (
              <strong key={category.key} className="focusStat">
                {category.emoji} {category.short}
              </strong>
            ))}
          </div>

          <span>
            {criticalPriorities.length === 1
              ? '1 current critical focus'
              : `${criticalPriorities.length} current critical focuses`}
          </span>
        </article>
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
              <b>{Math.round(categoryPoints)}</b>
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
type SocialComment = {
  id: string;
  log_id: string;
  user_id: string;
  body: string | null;
  parent_comment_id: string | null;
  image_path: string | null;
  created_at: string;
};
type FeedLog = CloudLogRow;

type HimothyNotification = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: 'friend_request' | 'friend_accept' | 'comment' | 'reply';
  log_id: string | null;
  comment_id: string | null;
  friendship_id: string | null;
  read_at: string | null;
  created_at: string;
};


function timeAgo(value: string) {
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
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  async function refreshPanel() {
    if (!supabase) return;

    const [
      { data: notificationRows },
      { data: profileRows },
      { data: logRows },
      { data: friendshipRows },
    ] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('profiles')
        .select('id,display_name,username,avatar_url'),

      supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),

      supabase
        .from('friendships')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
    ]);

    const notifications =
      (notificationRows || []) as HimothyNotification[];

    const friendships =
      (friendshipRows || []) as Friendship[];

    const acceptedFriendIds = new Set(
      friendships
        .filter((friendship) => friendship.status === 'accepted')
        .map((friendship) =>
          friendship.requester_id === user.id
            ? friendship.addressee_id
            : friendship.requester_id
        )
    );

    /*
      Friend-request notifications are actionable notifications, not history.

      If the friendship no longer exists, or it is already accepted/blocked,
      the request has been resolved and should disappear.
    */
    const resolvedRequestIds = notifications
      .filter((item) => {
        if (item.type !== 'friend_request') return false;

        /*
          Strong cleanup rule:
          if this sender is already an accepted friend,
          their old request notification is resolved.
        */
        if (
          item.actor_id &&
          acceptedFriendIds.has(item.actor_id)
        ) {
          return true;
        }

        /*
          Fall back to the specific friendship row when available.
        */
        if (!item.friendship_id) return true;

        const friendship = friendships.find(
          (entry) => entry.id === item.friendship_id
        );

        return !friendship || friendship.status !== 'pending';
      })
      .map((item) => item.id);

    if (resolvedRequestIds.length) {
      await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id)
        .in('id', resolvedRequestIds);
    }

    const visible = notifications
      .filter((item) => !resolvedRequestIds.includes(item.id))
      .slice(0, 8);

    setItems(visible);
    setProfiles((profileRows || []) as SocialProfile[]);
    setLogs((logRows || []) as FeedLog[]);
    setLoading(false);

    return visible;
  }

  async function markVisibleRead(notifications: HimothyNotification[]) {
    if (!supabase) return;

    const unreadIds = notifications
      .filter((item) => !item.read_at)
      .map((item) => item.id);

    if (!unreadIds.length) {
      onUnreadChange(0);
      return;
    }

    const readAt = new Date().toISOString();

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('user_id', user.id)
      .in('id', unreadIds);

    if (!error) {
      setItems((current) =>
        current.map((item) =>
          unreadIds.includes(item.id)
            ? { ...item, read_at: readAt }
            : item
        )
      );

      onUnreadChange(0);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAndAcknowledge() {
      const visible = await refreshPanel();
      if (!cancelled && visible) await markVisibleRead(visible);
    }

    loadAndAcknowledge();

    if (!supabase) return;

    const client = supabase;
    const channel = client
      .channel(`bell-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void (async () => {
            const visible = await refreshPanel();
            if (visible) await markVisibleRead(visible);
          })();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      client.removeChannel(channel);
    };
  }, [user.id]);

  async function resolveFriendRequest(
    item: HimothyNotification,
    action: 'accept' | 'decline'
  ) {
    if (!supabase || !item.friendship_id) return;

    setRequestBusy(item.id);

    let error = null;

    if (action === 'accept') {
      const result = await supabase
        .from('friendships')
        .update({
          status: 'accepted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.friendship_id);

      error = result.error;
    } else {
      const result = await supabase
        .from('friendships')
        .delete()
        .eq('id', item.friendship_id);

      error = result.error;
    }

    if (!error) {
      /*
        Once handled, remove the notification itself.
        This makes it disappear now AND after reload.
      */
      let notificationDelete = supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id)
        .eq('type', 'friend_request');

      if (item.actor_id) {
        notificationDelete = notificationDelete.eq(
          'actor_id',
          item.actor_id
        );
      } else {
        notificationDelete = notificationDelete.eq(
          'id',
          item.id
        );
      }

      await notificationDelete;

      setItems((current) =>
        current.filter((entry) => entry.id !== item.id)
      );

      onUnreadChange(
        items.filter(
          (entry) =>
            entry.id !== item.id &&
            !entry.read_at
        ).length
      );
    }

    setRequestBusy(null);
  }

  async function markRead(item: HimothyNotification) {
    if (!supabase || item.read_at) return;

    const readAt = new Date().toISOString();

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', item.id)
      .eq('user_id', user.id);

    if (!error) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, read_at: readAt } : entry
        )
      );

      onUnreadChange(
        Math.max(0, items.filter((entry) => !entry.read_at && entry.id !== item.id).length)
      );
    }
  }

  async function openItem(item: HimothyNotification) {
    if (!supabase) return;

    if (
      item.type === 'friend_request' ||
      item.type === 'friend_accept'
    ) {
      await markRead(item);
      onOpenFriends();
      return;
    }

    /*
      Opening a comment/reply marks it as read, but keeps
      it in notification history so Activity remains useful.
    */
    await markRead(item);

    if (item.log_id) {
      sessionStorage.setItem(
        'himothy.activityTargetLog',
        item.log_id
      );
    }

    if (item.comment_id) {
      sessionStorage.setItem(
        'himothy.activityTargetComment',
        item.comment_id
      );
    }

    onViewAll();
  }

  function actorName(id: string | null) {
    const actor = profiles.find(
      (profile) => profile.id === id
    );

    return (
      actor?.display_name ||
      (actor?.username ? `@${actor.username}` : 'Someone')
    );
  }

  return (
    <div
      className="notificationPanel card"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="notificationPanelHead">
        <div>
          <p className="eyebrow">NOTIFICATIONS</p>
          <h3>What&apos;s new</h3>
        </div>

        <div className="notificationPanelActions">
          <button
            className="notificationPanelClose"
            onClick={onClose}
            aria-label="Close notifications"
          >
            <X size={15}/>
          </button>
        </div>
      </div>

      <div className="notificationPanelList">
        {items.map((item) => {
          const log = item.log_id
            ? logs.find((entry) => entry.id === item.log_id)
            : null;

          const label =
            item.type === 'friend_request'
              ? `${actorName(item.actor_id)} sent you a friend request`
              : item.type === 'friend_accept'
                ? `${actorName(item.actor_id)} accepted your friend request`
                : item.type === 'reply'
                  ? `${actorName(item.actor_id)} replied to your comment`
                  : `${actorName(item.actor_id)} commented on your log`;

          return (
            <div
              className={`notificationPanelRow ${
                item.read_at ? '' : 'unread'
              }`}
              key={item.id}
            >
              <button
                className="notificationPanelMain"
                onClick={() => openItem(item)}
              >
                <span className="notificationMiniIcon">
                  {item.type === 'friend_request' ||
                  item.type === 'friend_accept'
                    ? <Users size={15}/>
                    : <MessageCircle size={15}/>}
                </span>

                <span className="notificationPanelCopy">
                  <strong>{label}</strong>
                  {log && <span>“{log.activity}”</span>}
                  <small>{timeAgo(item.created_at)}</small>
                </span>

                {!item.read_at && (
                  <i className="notificationUnreadDot"/>
                )}
              </button>

              {item.type === 'friend_request' &&
                item.friendship_id && (
                  <div className="notificationRequestActions">
                    <button
                      className="accept"
                      disabled={requestBusy === item.id}
                      onClick={() =>
                        resolveFriendRequest(item, 'accept')
                      }
                    >
                      Accept
                    </button>

                    <button
                      disabled={requestBusy === item.id}
                      onClick={() =>
                        resolveFriendRequest(item, 'decline')
                      }
                    >
                      Decline
                    </button>
                  </div>
                )}
            </div>
          );
        })}

        {!loading && !items.length && (
          <div className="notificationPanelEmpty">
            <Bell size={19}/>
            <strong>You&apos;re caught up.</strong>
            <span>Recent notifications will show up here.</span>
          </div>
        )}
      </div>

      <button
        className="notificationViewAll"
        onClick={onViewAll}
      >
        View all activity <ChevronRight size={15}/>
      </button>
    </div>
  );
}

function SignedCommentImage({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!supabase) return;
      const { data } = await supabase.storage
        .from('comment-images')
        .createSignedUrl(path, 60 * 30);

      if (alive) setSrc(data?.signedUrl || null);
    }

    load();

    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (!src) {
    return <div className="commentImageLoading">Loading photo…</div>;
  }

  return (
    <>
      <button
        type="button"
        className="commentPhotoButton"
        onClick={() => setOpen(true)}
        aria-label="Open full image"
      >
        <img
          className="commentPhoto"
          src={src}
          alt="Comment attachment"
        />
      </button>

      {open && (
        <div
          className="commentImageLightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Comment image"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="commentImageLightboxClose"
            aria-label="Close image"
            onClick={() => setOpen(false)}
          >
            <X size={24}/>
          </button>

          <img
            className="commentImageLightboxPhoto"
            src={src}
            alt="Comment attachment full size"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function ThreadedComments({
  logId,
  logOwnerId,
  user,
  profiles,
  comments,
  onRefresh,
}: {
  logId: string;
  logOwnerId: string;
  user: User;
  profiles: SocialProfile[];
  comments: SocialComment[];
  onRefresh: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<SocialComment | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
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

  async function deleteComment(comment: SocialComment) {
    if (!supabase) return;

    const canDelete =
      comment.user_id === user.id ||
      logOwnerId === user.id;

    if (!canDelete) return;

    const confirmed = window.confirm(
      childrenOf(comment.id).length
        ? 'Delete this comment and its replies?'
        : 'Delete this comment?'
    );

    if (!confirmed) return;

    const commentsToDelete = [
      comment,
      ...comments.filter(
        (item) => item.parent_comment_id === comment.id
      ),
    ];

    const imagePaths = commentsToDelete
      .map((item) => item.image_path)
      .filter((path): path is string => Boolean(path));

    const { error } = await supabase
      .from('log_comments')
      .delete()
      .eq('id', comment.id);

    if (error) {
      window.alert(error.message || 'Could not delete comment.');
      return;
    }

    if (imagePaths.length) {
      await supabase.storage
        .from('comment-images')
        .remove(imagePaths);
    }

    if (replyTo?.id === comment.id) {
      setReplyTo(null);
    }

    await onRefresh();
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
    } catch (error: any) {
      console.error('COMMENT POST ERROR:', error);
      window.alert(
        error?.message ||
        error?.details ||
        error?.hint ||
        JSON.stringify(error) ||
        'Could not post comment.'
      );
    } finally {
      setPosting(false);
    }
  }

  function renderComment(comment: SocialComment, nested = false) {
    return (
      <div
        className={`threadComment ${nested ? 'threadReply' : ''}`}
        key={comment.id}
        data-comment-id={comment.id}
      >
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

          <div className="commentActions">
            <button
              className="replyButton"
              onClick={() => {
                setReplyTo(comment);
                commentInputRef.current?.focus();
              }}
            >
              Reply
            </button>

            {(comment.user_id === user.id || logOwnerId === user.id) && (
              <button
                className="commentDeleteButton"
                onClick={() => deleteComment(comment)}
              >
                Delete
              </button>
            )}
          </div>

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
          ref={commentInputRef}
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


function ActivityView({
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

  // Keep social activity in sync without polling.
  // Notifications are scoped to the current user, while comment
  // changes refresh visible conversation threads.
  useEffect(() => {
    if (!supabase) return;

    const client = supabase;

    const channel = client
      .channel(`activity-live-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          refreshActivity();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'log_comments',
        },
        () => {
          refreshActivity();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [user.id]);

  useEffect(() => {
    if (loading) return;

    const targetLogId = sessionStorage.getItem(
      'himothy.activityTargetLog'
    );

    const targetCommentId = sessionStorage.getItem(
      'himothy.activityTargetComment'
    );

    if (!targetLogId && !targetCommentId) return;

    const timer = window.setTimeout(() => {
      let target: Element | null = null;

      if (targetCommentId) {
        target = document.querySelector(
          `[data-comment-id="${targetCommentId}"]`
        );
      }

      if (!target && targetLogId) {
        target = document.querySelector(
          `[data-activity-log-id="${targetLogId}"]`
        );
      }

      if (!target) return;

      target.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      const highlightClass = targetCommentId
        ? 'commentNotificationTarget'
        : 'activityThreadTarget';

      target.classList.add(highlightClass);

      window.setTimeout(() => {
        target?.classList.remove(highlightClass);
      }, 1800);

      sessionStorage.removeItem('himothy.activityTargetLog');
      sessionStorage.removeItem('himothy.activityTargetComment');
    }, 150);

    return () => window.clearTimeout(timer);
  }, [loading, visibleLogs, comments]);

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

  async function openNotification(
    notification: HimothyNotification
  ) {
    if (!supabase) return;

    if (
      notification.type === 'friend_request' ||
      notification.type === 'friend_accept'
    ) {
      await markNotificationRead(notification);
      onOpenFriends();
      return;
    }

    await markNotificationRead(notification);

    if (!notification.log_id && !notification.comment_id) return;

    let target: Element | null = null;

    if (notification.comment_id) {
      target = document.querySelector(
        `[data-comment-id="${notification.comment_id}"]`
      );
    }

    if (!target && notification.log_id) {
      target = document.querySelector(
        `[data-activity-log-id="${notification.log_id}"]`
      );
    }

    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      const highlightClass = notification.comment_id
        ? 'commentNotificationTarget'
        : 'activityThreadTarget';

      target.classList.add(highlightClass);

      window.setTimeout(() => {
        target?.classList.remove(highlightClass);
      }, 1800);
    }
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
      <article
        className="card activityThread"
        key={`${context}-${log.id}`}
        data-activity-log-id={log.id}
      >
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
          logOwnerId={log.user_id}
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
                : notification.type === 'friend_accept'
                  ? `${actorName} accepted your friend request`
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
                  {notification.type === 'friend_request' ||
                  notification.type === 'friend_accept'
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

  // Keep friendships, shared logs, reactions, and comments live.
  // Manual refresh should not be necessary during normal use.
  useEffect(() => {
    if (!supabase) return;

    const client = supabase;

    const channel = client
      .channel(`friends-live-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friendships',
        },
        () => {
          refreshSocial();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'logs',
        },
        () => {
          refreshSocial();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'log_reactions',
        },
        () => {
          refreshSocial();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'log_comments',
        },
        () => {
          refreshSocial();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [user.id]);

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
  async function acceptRequest(friendship: Friendship) {
    if (!supabase) return;

    const client = supabase;

    const { error } = await client
      .from('friendships')
      .update({
        status: 'accepted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', friendship.id);

    if (error) {
      setNotice(error.message);
      return;
    }

    const requesterId = friendship.requester_id;

    await client
      .from('notifications')
      .delete()
      .eq('user_id', user.id)
      .eq('type', 'friend_request')
      .eq('actor_id', requesterId);

    setNotice('You are friends now.');
    await refreshSocial();
  }
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
          <div className="peopleList">{results.map((p) => { const rel=relationByUser(p.id); return <div className="personRow" key={p.id}><div className="friendAvatar">{(p.display_name||p.username||'?')[0].toUpperCase()}</div><div><strong>{p.display_name||'Bettr user'}</strong><small>{p.username ? `@${p.username}` : 'No username yet'}</small></div>{!rel ? <button onClick={()=>sendRequest(p.id)} disabled={busy}><Plus size={15}/> Add</button> : <span className="relationTag">{rel.status === 'accepted' ? 'Friends' : rel.requester_id === user.id ? 'Sent' : 'Requested you'}</span>}</div>})}{query.trim().length>=2 && !results.length && <p className="emptySocial">No users found.</p>}</div>
        </article>
      </div>

      <div className="friendsWorkspace">
        <main className="friendsActivityColumn">
          <div className="sectionHead socialHead">
            <div>
              <p className="eyebrow">FRIEND ACTIVITY</p>
              <h2>What your circle is doing.</h2>
            </div>
          </div>

          <div className="feed">
            {feed.map((entry) => {
              const cat = categoryFor(entry.category);
              const owner = profiles.find(
                (p) => p.id === entry.user_id
              );
              const logReactions = reactions.filter(
                (r) => r.log_id === entry.id
              );
              const logComments = comments.filter(
                (c) => c.log_id === entry.id
              );

              return (
                <article
                  className="card socialFeedItem"
                  key={entry.id}
                >
                  <div className="socialFeedTop">
                    <div className="feedIcon">{cat.emoji}</div>

                    <div>
                      <div className="feedHeadline">
                        <strong>
                          {owner?.display_name || 'Friend'}
                        </strong>
                        <span>{cat.short}</span>
                      </div>

                      <small>
                        {new Date(entry.created_at).toLocaleString()}
                      </small>
                    </div>
                  </div>

                  <h3>{entry.activity}</h3>

                  {entry.details && <p>{entry.details}</p>}

                  <div className="reactions">
                    {['🔥', 'W', '💪'].map((emoji) => {
                      const count = logReactions.filter(
                        (r) => r.reaction === emoji
                      ).length;

                      const mine = logReactions.some(
                        (r) =>
                          r.reaction === emoji &&
                          r.user_id === user.id
                      );

                      return (
                        <button
                          className={mine ? 'mine' : ''}
                          key={emoji}
                          onClick={() =>
                            toggleReaction(entry.id, emoji)
                          }
                        >
                          {emoji}
                          {count > 0 && <sup>{count}</sup>}
                        </button>
                      );
                    })}
                  </div>

                  <ThreadedComments
                    logId={entry.id}
                    logOwnerId={entry.user_id}
                    user={user}
                    profiles={profiles}
                    comments={logComments}
                    onRefresh={refreshSocial}
                  />
                </article>
              );
            })}

            {friends.length > 0 && !feed.length && (
              <div className="card emptyFriendState">
                <Flame />
                <h3>No shared activity yet.</h3>
                <p>
                  When a friend logs something with Friends
                  visibility, it appears here.
                </p>
              </div>
            )}
          </div>
        </main>

        <aside className="friendsSidebar">
          <div className="friendsSidebarSection">
            <div className="sectionHead socialHead">
              <div>
                <p className="eyebrow">
                  FRIENDS · {friends.length}
                </p>
                <h2>Your people.</h2>
              </div>
            </div>

            {friends.length ? (
              <div className="friendStrip">
                {friends.map((p) => {
                  const f = relationByUser(p.id)!;

                  return (
                    <div
                      className="friendChip card"
                      key={p.id}
                    >
                      <div className="friendAvatar">
                        {(p.display_name || '?')[0].toUpperCase()}
                      </div>

                      <div>
                        <strong>{p.display_name}</strong>
                        <small>
                          {p.username
                            ? `@${p.username}`
                            : 'Friend'}
                        </small>
                      </div>

                      <button
                        title="Remove friend"
                        onClick={() =>
                          removeConnection(f.id)
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card emptyFriendState">
                <Users />
                <h3>Your circle starts here.</h3>
                <p>
                  Search for your best friend above and send
                  the first request.
                </p>
              </div>
            )}
          </div>

          {incoming.length > 0 && (
            <div className="friendsSidebarSection">
              <div className="sectionHead socialHead">
                <div>
                  <p className="eyebrow">
                    REQUESTS · {incoming.length}
                  </p>
                  <h2>Waiting on you.</h2>
                </div>
              </div>

              <article className="card requestPanel">
                <div className="peopleList">
                  {incoming.map((f) => {
                    const profile = profiles.find(
                      (x) => x.id === f.requester_id
                    );

                    return (
                      <div
                        className="personRow"
                        key={f.id}
                      >
                        <div className="friendAvatar">
                          {(profile?.display_name || '?')[0].toUpperCase()}
                        </div>

                        <div>
                          <strong>
                            {profile?.display_name ||
                              'Bettr user'}
                          </strong>

                          <small>
                            {profile?.username
                              ? `@${profile.username}`
                              : 'Friend request'}
                          </small>
                        </div>

                        <div className="requestActions">
                          <button
                            className="accept"
                            onClick={() =>
                              acceptRequest(f)
                            }
                          >
                            <Check size={15} />
                            Accept
                          </button>

                          <button
                            onClick={() =>
                              removeConnection(f.id)
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
