import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { StartupContentKind, StartupContentMode } from '../lib/startupRotation';
import { Button, Card, Select } from './ui';
import { useTranslation } from 'react-i18next';

export type StartupReciter = 'ar.alafasy' | 'ar.abdurrahmaansudais' | 'ar.husary' | 'ar.minshawi';

export interface StartupPreferences {
  enabled: boolean;
  mode: StartupContentMode;
  audioEnabled: boolean;
  volume: number;
  fontSize: number;
  reciter: StartupReciter;
  lastContentId: string | null;
  lastContentKind: StartupContentKind | null;
}

export const DEFAULT_STARTUP_PREFERENCES: StartupPreferences = {
  enabled: true,
  mode: 'both',
  audioEnabled: false,
  volume: 0.5,
  fontSize: 32,
  reciter: 'ar.alafasy',
  lastContentId: null,
  lastContentKind: null,
};

const RECITERS: Array<{ value: StartupReciter; label: string }> = [
  { value: 'ar.alafasy', label: 'Mishary Alafasy' },
  { value: 'ar.abdurrahmaansudais', label: 'Abdurrahman as-Sudais' },
  { value: 'ar.husary', label: 'Mahmoud Khalil Al-Husary' },
  { value: 'ar.minshawi', label: 'Muhammad Siddiq Al-Minshawi' },
];

const storageKey = (uid: string) => `phone-clinic-startup-preferences:${uid}`;

export function readStartupPreferences(uid: string): StartupPreferences {
  if (!uid) return DEFAULT_STARTUP_PREFERENCES;
  try {
    const stored = localStorage.getItem(storageKey(uid));
    if (!stored) return DEFAULT_STARTUP_PREFERENCES;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return DEFAULT_STARTUP_PREFERENCES;
    const preferences = value as Partial<StartupPreferences>;
    return {
      ...DEFAULT_STARTUP_PREFERENCES,
      ...preferences,
      enabled: typeof preferences.enabled === 'boolean' ? preferences.enabled : true,
      mode: preferences.mode === 'verse' || preferences.mode === 'dhikr' || preferences.mode === 'both'
        ? preferences.mode
        : 'both',
      audioEnabled: preferences.audioEnabled === true,
      volume: typeof preferences.volume === 'number' ? Math.min(1, Math.max(0, preferences.volume)) : 0.5,
      fontSize: typeof preferences.fontSize === 'number' ? Math.min(56, Math.max(20, preferences.fontSize)) : 32,
      reciter: RECITERS.some((reciter) => reciter.value === preferences.reciter)
        ? preferences.reciter as StartupReciter
        : 'ar.alafasy',
      lastContentId: typeof preferences.lastContentId === 'string' ? preferences.lastContentId : null,
      lastContentKind: preferences.lastContentKind === 'verse' || preferences.lastContentKind === 'dhikr'
        ? preferences.lastContentKind
        : null,
    };
  } catch (error) {
    console.warn('Unable to read personal startup preferences:', error);
    return DEFAULT_STARTUP_PREFERENCES;
  }
}

export function writeStartupPreferences(uid: string, preferences: StartupPreferences) {
  if (!uid) return;
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(preferences));
  } catch (error) {
    console.warn('Unable to save personal startup preferences:', error);
  }
}

export function StartupPreferencesPanel({
  preferences,
  onChange,
}: {
  preferences: StartupPreferences;
  onChange: (updates: Partial<StartupPreferences>) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-sm font-bold text-ds-text">{t('startup.preferences.title')}</h2>
        <p className="mt-1 text-sm text-ds-muted">{t('startup.preferences.description')}</p>
      </div>

      <label className="flex min-h-11 items-center justify-between gap-3 rounded-ds-md border border-ds-border bg-ds-surface-2 p-3 text-sm font-semibold text-ds-text">
        {t('startup.preferences.enabled')}
        <input
          type="checkbox"
          checked={preferences.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          className="h-5 w-5 shrink-0 accent-ds-brand"
        />
      </label>

      <Select
        label={t('startup.preferences.content')}
        value={preferences.mode}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'verse' || value === 'dhikr' || value === 'both') onChange({ mode: value });
        }}
      >
        <option value="verse">{t('startup.preferences.verses')}</option>
        <option value="dhikr">{t('startup.preferences.adhkar')}</option>
        <option value="both">{t('startup.preferences.both')}</option>
      </Select>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('startup.preferences.reciter')}
          value={preferences.reciter}
          onChange={(event) => {
            const reciter = RECITERS.find((option) => option.value === event.target.value);
            if (reciter) onChange({ reciter: reciter.value });
          }}
        >
          {RECITERS.map((reciter) => <option key={reciter.value} value={reciter.value}>{reciter.label}</option>)}
        </Select>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-ds-md border border-ds-border bg-ds-surface-2 px-3 text-sm font-semibold text-ds-text">
          {t('startup.preferences.audioEnabled')}
          <input
            type="checkbox"
            checked={preferences.audioEnabled}
            onChange={(event) => onChange({ audioEnabled: event.target.checked })}
            className="h-5 w-5 shrink-0 accent-ds-brand"
          />
        </label>
      </div>

      <label className="block space-y-2 text-sm font-semibold text-ds-text">
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Volume2 className="h-4 w-4 text-ds-brand" /> {t('startup.preferences.volume')}</span>
          <span>{Math.round(preferences.volume * 100)} %</span>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={preferences.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
          className="w-full accent-ds-brand"
        />
      </label>

      <label className="block space-y-2 text-sm font-semibold text-ds-text">
        <span className="flex items-center justify-between gap-2">
          <span>{t('startup.preferences.arabicTextSize')}</span>
          <span>{preferences.fontSize} px</span>
        </span>
        <input
          type="range"
          min="20"
          max="56"
          step="2"
          value={preferences.fontSize}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
          className="w-full accent-ds-brand"
        />
      </label>
    </Card>
  );
}

export function StartupAudioButton({
  enabled,
  url,
  volume,
}: {
  enabled: boolean;
  url: string | null;
  volume: number;
}) {
  const { t } = useTranslation('settings');
  const [message, setMessage] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const manualPlayAttempt = useRef(false);

  useEffect(() => {
    retryCount.current = 0;
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, [enabled, url]);

  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  const play = async () => {
    if (!enabled) return;
    if (!url || !audioRef.current) {
      setMessage(t('startup.audio.unavailable'));
      return;
    }
    setLoading(true);
    setMessage('');
    retryCount.current = 0;
    const audio = audioRef.current;
    audio.volume = volume;
    manualPlayAttempt.current = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await audio.play();
        manualPlayAttempt.current = false;
        setPlaying(true);
        setLoading(false);
        setMessage('');
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'NotAllowedError') {
          setMessage(t('startup.audio.retryPermission'));
          break;
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
    manualPlayAttempt.current = false;
    setLoading(false);
    setMessage((previous) => previous || t('startup.audio.unavailableRetry'));
  };

  const retryPlayback = () => {
    if (manualPlayAttempt.current || retryTimer.current !== null) return;
    setPlaying(false);
    if (!enabled || !url || retryCount.current >= 3) {
      setMessage(t('startup.audio.unavailableRetry'));
      return;
    }
    const delay = 500 * (2 ** retryCount.current);
    retryCount.current += 1;
    setMessage(t('startup.audio.retrying', { count: retryCount.current }));
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      const audio = audioRef.current;
      if (!audio) return;
      audio.load();
      void audio.play().then(() => {
        setPlaying(true);
        setMessage('');
      }).catch(() => retryPlayback());
    }, delay);
  };

  if (!enabled) return null;
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="none"
          onEnded={() => setPlaying(false)}
          onError={retryPlayback}
        />
      )}
      <Button type="button" variant="secondary" disabled={loading} onClick={() => {
        if (playing) {
          audioRef.current?.pause();
          if (retryTimer.current !== null) {
            window.clearTimeout(retryTimer.current);
            retryTimer.current = null;
          }
          retryCount.current = 0;
          setPlaying(false);
        } else {
          void play();
        }
      }}>
        {loading ? t('startup.audio.connecting') : playing ? t('startup.audio.stop') : t('startup.audio.listen')}
      </Button>
      {message && <p role="status" className="text-center text-xs text-ds-muted">{message}</p>}
    </div>
  );
}
