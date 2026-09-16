'use client';

import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import GoalsView from './GoalsView';
import RoutinesView from './RoutinesView';
import styles from './planningHome.module.css';

type PlanningSection = 'goals' | 'routines';

export default function PlanningHome({
  user,
  onNotice,
}: {
  user: User | null;
  onNotice: (message: string) => void;
}) {
  const [section, setSection] = useState<PlanningSection>('goals');

  return (
    <>
      <div className={`viewSwitch ${styles.switch}`}>
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
      </div>
      {section === 'goals' ? (
        <GoalsView user={user} onNotice={onNotice} />
      ) : (
        <RoutinesView user={user} onNotice={onNotice} />
      )}
    </>
  );
}
