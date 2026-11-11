import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '../firebase';
import type { StartupConfig, StartupItem, UserProfile } from '../types';
import { can } from '../lib/permissions';
import { isDirectAudioUrl } from '../lib/startup';
import { verses } from '../data/verses';
import { StartupDailyOverlay } from './StartupDailyOverlay';
import {
  DEFAULT_STARTUP_PREFERENCES,
  readStartupPreferences,
  writeStartupPreferences,
  type StartupPreferences,
} from './StartupPreferences';

const firstVerse = verses[0];
const DEFAULT_CONFIG: StartupConfig = {
  enabled: true,
  frequency: 'each_open',
  schedule: {
    coran: { allDay: true, start: '00:00', end: '23:59' },
    matin: { allDay: false, start: '05:00', end: '11:59' },
    soir: { allDay: false, start: '16:00', end: '22:00' },
    rizq: { allDay: false, start: '05:00', end: '22:00' },
  },
  volume: 0.5,
  loop: false,
  background: true,
  welcomeTitle: firstVerse.title,
  welcomeText: firstVerse.text,
  welcomeSource: firstVerse.source,
  audioUrl: '',
};

function normalizeConfig(data: Partial<StartupConfig>): StartupConfig {
  const schedule = data.schedule || DEFAULT_CONFIG.schedule;
  return {
    ...DEFAULT_CONFIG,
    ...data,
    welcomeTitle: data.welcomeTitle || DEFAULT_CONFIG.welcomeTitle,
    welcomeText: data.welcomeText || DEFAULT_CONFIG.welcomeText,
    welcomeSource: data.welcomeSource || DEFAULT_CONFIG.welcomeSource,
    audioUrl: data.audioUrl || '',
    schedule: {
      coran: { ...DEFAULT_CONFIG.schedule.coran, ...schedule.coran },
      matin: { ...DEFAULT_CONFIG.schedule.matin, ...schedule.matin },
      soir: { ...DEFAULT_CONFIG.schedule.soir, ...schedule.soir },
      rizq: { ...DEFAULT_CONFIG.schedule.rizq, ...schedule.rizq },
    },
  };
}

export interface StartupContextValue {
  config: StartupConfig;
  items: StartupItem[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  personalPreferences: StartupPreferences;
  updatePersonalPreferences: (updates: Partial<StartupPreferences>) => void;
  audioAllowed: boolean;
  openNow: () => void;
  audioPlaying: boolean;
  audioBlocked: boolean;
  audioMessage: string | null;
  muted: boolean;
  toggleAudio: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
}

const StartupContext = createContext<StartupContextValue | null>(null);

export function StartupProvider({
  userProfile,
  online,
  children,
}: {
  userProfile: UserProfile | null;
  online: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  const ownerId = userProfile?.ownerId || userProfile?.uid || '';
  const userId = userProfile?.uid || '';
  const audioAllowed = can(userProfile, 'startup', 'playAudio');
  const canManage = userProfile?.role === 'admin' && ownerId === userProfile.uid;
  const [config, setConfig] = useState<StartupConfig>(DEFAULT_CONFIG);
  const [items, setItems] = useState<StartupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [personalPreferences, setPersonalPreferences] = useState<StartupPreferences>(DEFAULT_STARTUP_PREFERENCES);
  const [preferencesForUser, setPreferencesForUser] = useState('');
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('phone-clinic-startup-muted') === '1';
    } catch {
      return false;
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    setPreferencesForUser('');
    if (!userId) {
      setPersonalPreferences(DEFAULT_STARTUP_PREFERENCES);
      return;
    }
    setPersonalPreferences(readStartupPreferences(userId));
    setPreferencesForUser(userId);
  }, [userId]);

  const updatePersonalPreferences = useCallback((updates: Partial<StartupPreferences>) => {
    setPersonalPreferences((previous) => {
      const next = { ...previous, ...updates };
      writeStartupPreferences(userId, next);
      return next;
    });
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setConfig(DEFAULT_CONFIG);
    setItems([]);
    openedRef.current = false;
    if (!ownerId || !online) {
      setLoading(false);
      return;
    }

    const unsubscribeConfig = onSnapshot(
      doc(db, 'startup_config', ownerId),
      (snapshot) => {
        setConfig(snapshot.exists() ? normalizeConfig(snapshot.data() as Partial<StartupConfig>) : DEFAULT_CONFIG);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load startup configuration:', snapshotError);
        setError(t('embeddedStartup.configLoadError'));
        setLoading(false);
      },
    );

    return () => unsubscribeConfig();
  }, [ownerId, online, t]);

  const openNow = useCallback(() => {
    if (!personalPreferences.enabled || !config.enabled || !online || loading || error) return;
    setOverlayOpen(true);
  }, [personalPreferences.enabled, config.enabled, online, loading, error]);

  useEffect(() => {
    if (loading || !ownerId || !online || preferencesForUser !== userId || openedRef.current) return;
    openedRef.current = true;
    openNow();
  }, [loading, ownerId, userId, preferencesForUser, online, openNow]);

  useEffect(() => {
    if (!personalPreferences.enabled || !config.enabled) setOverlayOpen(false);
  }, [personalPreferences.enabled, config.enabled]);

  const selectedAudioUrl = useMemo(
    () => audioAllowed && isDirectAudioUrl(config.audioUrl || '') ? config.audioUrl || '' : '',
    [audioAllowed, config.audioUrl],
  );

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setAudioPlaying(false);
  }, []);

  const playAudio = useCallback(async () => {
    if (!audioAllowed) return;
    if (!selectedAudioUrl) {
      setAudioMessage(t('embeddedStartup.noAudio'));
      setAudioPlaying(false);
      return;
    }

    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    audio.preload = 'none';
    audio.loop = config.loop;
    audio.volume = config.volume;
    audio.muted = muted;
    if (audio.src !== selectedAudioUrl) audio.src = selectedAudioUrl;
    audio.onended = () => setAudioPlaying(false);
    audio.onerror = () => {
      setAudioPlaying(false);
      setAudioMessage(t('embeddedStartup.audioUnavailable'));
    };
    try {
      await audio.play();
      setAudioBlocked(false);
      setAudioPlaying(true);
      setAudioMessage(null);
    } catch (playError) {
      setAudioPlaying(false);
      setAudioBlocked(playError instanceof Error && playError.name === 'NotAllowedError');
      setAudioMessage(playError instanceof Error && playError.name === 'NotAllowedError'
        ? t('embeddedStartup.playbackBlocked')
        : t('embeddedStartup.playbackError'));
    }
  }, [audioAllowed, selectedAudioUrl, config.loop, config.volume, muted, t]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = config.volume;
      audioRef.current.loop = config.loop;
    }
  }, [config.volume, config.loop]);

  useEffect(() => {
    if (!audioAllowed) {
      stopAudio();
      audioRef.current = null;
      setAudioBlocked(false);
      return;
    }
    if (audioRef.current && audioRef.current.src !== selectedAudioUrl) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      setAudioPlaying(false);
    }
  }, [audioAllowed, selectedAudioUrl, stopAudio]);

  useEffect(() => {
    if (!config.enabled) {
      setOverlayOpen(false);
      stopAudio();
    }
  }, [config.enabled, stopAudio]);

  useEffect(() => {
    if (online) return;
    setOverlayOpen(false);
    stopAudio();
  }, [online, stopAudio]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const toggleAudio = useCallback(() => {
    if (audioPlaying) stopAudio();
    else void playAudio();
  }, [audioPlaying, stopAudio, playAudio]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
    try {
      localStorage.setItem('phone-clinic-startup-muted', next ? '1' : '0');
    } catch (storageError) {
      console.warn('Unable to save startup mute preference:', storageError);
    }
  }, [muted]);

  const setVolume = (volume: number) => {
    if (audioRef.current) audioRef.current.volume = volume;
    setConfig((previous) => ({ ...previous, volume }));
  };

  const closeOverlay = () => setOverlayOpen(false);
  const value: StartupContextValue = {
    config,
    items,
    loading,
    error,
    canManage,
    personalPreferences,
    updatePersonalPreferences,
    audioAllowed,
    openNow,
    audioPlaying,
    audioBlocked,
    audioMessage,
    muted,
    toggleAudio,
    toggleMute,
    setVolume,
  };

  return (
    <StartupContext.Provider value={value}>
      {children}
      <StartupMiniPlayer />
      {overlayOpen && (
        <StartupDailyOverlay
          preferences={personalPreferences}
          onPreferencesChange={updatePersonalPreferences}
          onClose={closeOverlay}
        />
      )}
    </StartupContext.Provider>
  );
}

export function useStartup(): StartupContextValue {
  const value = useContext(StartupContext);
  if (!value) throw new Error('useStartup must be used inside StartupProvider');
  return value;
}

export function StartupMiniPlayer() {
  const { config, audioAllowed, audioPlaying, muted, toggleAudio, toggleMute } = useStartup();
  const { t } = useTranslation('settings');
  if (!config.enabled || !audioAllowed || !isDirectAudioUrl(config.audioUrl || '')) return null;
  return (
    <div className="fixed bottom-4 end-4 z-40 flex items-center gap-2 rounded-full border border-ds-border bg-ds-surface px-2 py-1 shadow-ds-md backdrop-blur">
      <button className="rounded-full p-2 text-ds-brand hover:bg-ds-brand-soft" onClick={toggleAudio} aria-label={audioPlaying ? t('embeddedStartup.pause') : t('embeddedStartup.play')}>
        {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button className="rounded-full p-2 text-ds-brand hover:bg-ds-brand-soft" onClick={toggleMute} aria-label={muted ? t('embeddedStartup.unmute') : t('embeddedStartup.mute')}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
