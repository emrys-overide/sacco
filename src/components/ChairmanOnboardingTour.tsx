import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bus, CheckCircle2, ClipboardList, FileCode2, ShieldCheck, UserRoundPlus, Users, X } from 'lucide-react';
import { STORAGE_KEYS } from '../lib/auth';

type TourProgress = {
  status: 'in-progress' | 'dismissed' | 'completed';
  step: number;
};

type TourStep = {
  title: string;
  description: string;
  actionLabel: string;
  tab: string;
  icon: React.ReactNode;
};

const tourSteps: TourStep[] = [
  {
    title: 'Review the SACCO blueprint',
    description: 'Start by reviewing the operating controls, roles, and financial rules with the Chairman before live records are entered.',
    actionLabel: 'Open Blueprint',
    tab: 'Blueprint',
    icon: <FileCode2 className="h-5 w-5" />
  },
  {
    title: 'Create the officer team',
    description: 'Use individual accounts for the Secretary, Treasurer, Accountant, and Auditor. Never share the Chairman password.',
    actionLabel: 'Open Account Access',
    tab: 'Account Access',
    icon: <UserRoundPlus className="h-5 w-5" />
  },
  {
    title: 'Register the first member',
    description: 'Add the member’s verified name, ID, phone number, email, and membership details before they create their own account.',
    actionLabel: 'Open Members',
    tab: 'Members',
    icon: <Users className="h-5 w-5" />
  },
  {
    title: 'Add the member’s vehicle',
    description: 'Register the vehicle plate, route, driver, and owner connection so collections are attached to the right records.',
    actionLabel: 'Open Fleet',
    tab: 'Fleet',
    icon: <Bus className="h-5 w-5" />
  },
  {
    title: 'Start daily operations',
    description: 'Record daily collections, savings, repayments, and expenses only after the underlying member and vehicle records are in place.',
    actionLabel: 'Open Daily Collections',
    tab: 'Daily Collections',
    icon: <ClipboardList className="h-5 w-5" />
  }
];

function storageKeyFor(userId: string) {
  return `${STORAGE_KEYS.chairmanOnboardingTour}:${userId}`;
}

function readProgress(key: string): TourProgress | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourProgress>;
    if (!['in-progress', 'dismissed', 'completed'].includes(String(parsed.status))) return null;
    const step = Number.isInteger(parsed.step) && (parsed.step as number) >= 0 && (parsed.step as number) < tourSteps.length
      ? parsed.step as number
      : 0;
    return { status: parsed.status as TourProgress['status'], step };
  } catch {
    return null;
  }
}

function saveProgress(key: string, progress: TourProgress) {
  try {
    localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // Storage can be unavailable in private browsing. The guide still works for this session.
  }
}

interface ChairmanOnboardingTourProps {
  currentUserId: string;
  isEligible: boolean;
  onNavigateToTab: (tab: string) => void;
}

/**
 * A browser-local guide for the first Chairman. It intentionally depends on an
 * empty member registry so experienced officers are never interrupted later.
 */
export default function ChairmanOnboardingTour({ currentUserId, isEligible, onNavigateToTab }: ChairmanOnboardingTourProps) {
  const storageKey = storageKeyFor(currentUserId);
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isEligible) {
      setIsOpen(false);
      return;
    }
    const progress = readProgress(storageKey);
    setStepIndex(progress?.step ?? 0);
    setIsOpen(!progress || progress.status === 'in-progress');
  }, [isEligible, storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        saveProgress(storageKey, { status: 'dismissed', step: stepIndex });
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, stepIndex, storageKey]);

  if (!isEligible) return null;

  const step = tourSteps[stepIndex];
  const isLastStep = stepIndex === tourSteps.length - 1;

  const openGuide = () => {
    const savedProgress = readProgress(storageKey);
    const nextStep = savedProgress && savedProgress.status !== 'completed' ? savedProgress.step : 0;
    setStepIndex(nextStep);
    saveProgress(storageKey, { status: 'in-progress', step: nextStep });
    setIsOpen(true);
  };

  const closeForLater = () => {
    saveProgress(storageKey, { status: 'dismissed', step: stepIndex });
    setIsOpen(false);
  };

  const moveToStep = (nextStep: number) => {
    setStepIndex(nextStep);
    saveProgress(storageKey, { status: 'in-progress', step: nextStep });
  };

  const openCurrentWorkspace = () => {
    if (isLastStep) {
      saveProgress(storageKey, { status: 'completed', step: stepIndex });
    } else {
      saveProgress(storageKey, { status: 'in-progress', step: stepIndex });
    }
    setIsOpen(false);
    onNavigateToTab(step.tab);
  };

  const finishGuide = () => {
    saveProgress(storageKey, { status: 'completed', step: stepIndex });
    setIsOpen(false);
  };

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={openGuide}
          className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 transition-colors hover:bg-blue-100"
        >
          <ShieldCheck className="h-4 w-4" />
          Open first-Chairman setup guide
        </button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-3 sm:items-center sm:p-6" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="chairman-onboarding-title"
            className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/30 bg-white shadow-2xl"
          >
            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-5 py-5 text-white sm:px-7 sm:py-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-200"><ShieldCheck className="h-5 w-5" /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-300">Guided first setup</p>
                    <h2 id="chairman-onboarding-title" className="mt-1 text-xl font-bold tracking-tight">Chairman handover guide</h2>
                    <p className="mt-1 text-xs leading-5 text-blue-100/80">Work through these controls together before entering live SACCO records.</p>
                  </div>
                </div>
                <button type="button" onClick={closeForLater} aria-label="Close setup guide" className="rounded-lg p-1.5 text-blue-100 transition-colors hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
              </div>
              <div className="mt-5 flex gap-1.5" aria-label={`Step ${stepIndex + 1} of ${tourSteps.length}`}>
                {tourSteps.map((item, index) => <span key={item.title} className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? 'bg-emerald-400' : 'bg-white/20'}`} />)}
              </div>
              <p className="mt-2 text-right text-[10px] font-bold uppercase tracking-wider text-blue-200">Step {stepIndex + 1} of {tourSteps.length}</p>
            </div>

            <div className="p-5 sm:p-7">
              <div className="flex gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">{step.icon}</div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-slate-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                </div>
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  {stepIndex > 0 && (
                    <button type="button" onClick={() => moveToStep(stepIndex - 1)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</button>
                  )}
                  <button type="button" onClick={closeForLater} className="rounded-xl px-3 py-2.5 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-50">Skip for now</button>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={openCurrentWorkspace} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100">{step.actionLabel}<ArrowRight className="h-4 w-4" /></button>
                  {isLastStep ? (
                    <button type="button" onClick={finishGuide} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-slate-800">Finish guide<CheckCircle2 className="h-4 w-4" /></button>
                  ) : (
                    <button type="button" onClick={() => moveToStep(stepIndex + 1)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700">Next step<ArrowRight className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
