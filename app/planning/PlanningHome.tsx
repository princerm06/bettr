'use client';

import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import GoalsView from './GoalsView';
import RoutinesView from './RoutinesView';
import TodosView from './TodosView';
import TodayView, { type PlannerCreditedLog, type PlannerSavedLogLookup } from './TodayView';
import type { PlanningCategoryKey } from '../../lib/planning';
import styles from './planningHome.module.css';

type PlanningSection = 'today' | 'goals' | 'routines' | 'todos';

type PriorityLevel = 'critical' | 'high' | 'normal' | 'maintenance';
type PriorityMap = Record<PlanningCategoryKey, PriorityLevel>;

export default function PlanningHome({
  user,
  priorities,
  onNotice,
  onCreditedLog,
  onUpdatedLog,
  getSavedLog,
}: {
  user: User | null;
  priorities: PriorityMap;
  onNotice: (message: string) => void;
  onCreditedLog: (log: PlannerCreditedLog) => Promise<void>;
  onUpdatedLog: (log: PlannerCreditedLog) => Promise<void>;
  getSavedLog?: (logId: string) => PlannerSavedLogLookup | null;
}) {
  const [section, setSection] = useState<PlanningSection>('today');

  return (
    <>
      <div className={`viewSwitch ${styles.switch}`}>
        <button
          type="button"
          className={section === 'today' ? 'active' : ''}
          onClick={() => setSection('today')}
        >
          Today
        </button>
        <button
          type="button"
          className={section === 'goals' ? 'active' : ''}
          onClick={() => setSection('goals')}
        >
          Goals
        </button>
        <button
          type="button"
          className={section === 'routines' ? 'active' : ''}
          onClick={() => setSection('routines')}
        >
          Routines
        </button>
        <button
          type="button"
          className={section === 'todos' ? 'active' : ''}
          onClick={() => setSection('todos')}
        >
          To-Dos
        </button>
      </div>
      {section === 'today' ? (
        <TodayView
          user={user}
          priorities={priorities}
          onNotice={onNotice}
          onCreditedLog={onCreditedLog}
          onUpdatedLog={onUpdatedLog}
          getSavedLog={getSavedLog}
        />
      ) : section === 'goals' ? (
        <GoalsView user={user} onNotice={onNotice} />
      ) : section === 'routines' ? (
        <RoutinesView user={user} onNotice={onNotice} />
      ) : (
        <TodosView user={user} onNotice={onNotice} />
      )}
    </>
  );
}
