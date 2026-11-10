import { useEffect, useRef, useState } from 'react';
import { selectStartupContent, fetchRandomVerse, type StartupContent } from '../lib/startupRotation';
import type { StartupPreferences } from './StartupPreferences';
import { StartupAudioButton } from './StartupPreferences';
import { X } from 'lucide-react';

export function StartupDailyOverlay({
  preferences,
  onPreferencesChange,
  onClose,
}: {
  preferences: StartupPreferences;
  onPreferencesChange: (updates: Partial<StartupPreferences>) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<StartupContent>(() => selectStartupContent({
    mode: preferences.mode,
    lastContentId: preferences.lastContentId,
    lastContentKind: preferences.lastContentKind,
  }));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    onPreferencesChange({ lastContentId: content.id, lastContentKind: content.kind });
  }, []);

  useEffect(() => {
    if (content.kind !== 'verse') return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void fetchRandomVerse(preferences.reciter, controller.signal).then((remoteVerse) => {
      if (remoteVerse.id === preferences.lastContentId) return;
      setContent(remoteVerse);
      onPreferencesChange({ lastContentId: remoteVerse.id, lastContentKind: 'verse' });
    }).catch((error: unknown) => {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.warn('Using a local Quran verse because the public API is unavailable:', error);
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [content.kind, preferences.reciter]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coran & Adhkar"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-ds-bg px-5 py-14 text-ds-text"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute end-5 top-5 z-10 rounded-full border border-ds-border bg-ds-surface-2 p-3 text-ds-text hover:bg-ds-border"
        aria-label="Fermer"
      >
        <X className="h-5 w-5" />
      </button>
      <main className="relative flex w-full max-w-5xl flex-col items-center text-center">
        <p className="mb-8 text-xs font-semibold uppercase tracking-[0.35em] text-ds-brand">Coran &amp; Adhkar</p>
        <article className="animate-in fade-in duration-700">
          <h1 className="mb-6 font-arabic text-2xl font-semibold text-ds-brand md:text-3xl" dir="rtl" lang="ar">
            {content.title}
          </h1>
          <p
            className="font-arabic leading-[1.9]"
            style={{ fontSize: `clamp(1.5rem, ${preferences.fontSize / 16}vw, ${preferences.fontSize}px)` }}
            dir="rtl"
            lang="ar"
          >
            {content.text}
          </p>
          <p className="mt-6 text-xs text-ds-muted">{content.source}</p>
        </article>
        <StartupAudioButton
          enabled={preferences.audioEnabled}
          url={content.kind === 'verse' ? content.audioUrl || null : null}
          volume={preferences.volume}
        />
        <button
          type="button"
          onClick={onClose}
          className="mt-10 rounded-full bg-ds-brand px-10 py-4 text-lg font-black text-ds-brand-contrast shadow-ds-md transition hover:bg-ds-brand-hover"
        >
          دخول
        </button>
      </main>
    </div>
  );
}
