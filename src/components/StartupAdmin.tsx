import { useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ArrowDown, ArrowUp, ImagePlus, Music2, Plus, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import type { StartupItem, StartupSection, UserProfile } from '../types';
import { adhkarLibrary } from '../data/adhkar';
import { verses } from '../data/verses';
import { isDirectAudioUrl, isDirectImageUrl } from '../lib/startup';
import { useStartup } from './StartupProvider';
import { useTranslation } from 'react-i18next';

const SECTION_KEYS: Record<StartupSection, string> = {
  coran: 'startup.sections.coran',
  matin: 'startup.sections.morning',
  soir: 'startup.sections.evening',
  rizq: 'startup.sections.rizq',
};

const EMPTY_FORM = {
  type: 'text' as 'text' | 'image' | 'audio',
  title: '',
  text: '',
  source: '',
  repeat: 1,
  imageUrl: '',
  legacyImageData: '',
  audioUrl: '',
};

export default function StartupAdmin({ userProfile }: { userProfile: UserProfile | null }) {
  const { t } = useTranslation('settings');
  const { config, items, error } = useStartup();
  const ownerId = userProfile?.ownerId || userProfile?.uid || '';
  const [section, setSection] = useState<StartupSection>('coran');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const audioPreview = useRef<HTMLAudioElement | null>(null);
  const sectionItems = items.filter((item) => item.section === section);
  const imagePreview = isDirectImageUrl(form.imageUrl) ? form.imageUrl : form.legacyImageData;

  const saveConfig = async (updates: Partial<typeof config>) => {
    try {
      await setDoc(doc(db, 'startup_config', ownerId), {
        ownerId,
        ...updates,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setMessage(t('startup.messages.configSaved'));
    } catch (saveError) {
      console.error('Unable to save startup settings:', saveError);
      setMessage(t('startup.messages.configSaveError'));
    }
  };

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setMessage('');
    } catch (actionError) {
      console.error('Unable to update startup content:', actionError);
      setMessage(t('startup.messages.actionError'));
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!ownerId) return setMessage(t('startup.messages.ownerMissing'));
    if (!form.title.trim()) return setMessage(t('startup.messages.titleRequired'));
    if (form.type === 'text' && !form.text.trim()) return setMessage(t('startup.messages.textRequired'));
    if (form.type === 'image' && !isDirectImageUrl(form.imageUrl)) {
      return setMessage(t('startup.messages.invalidImageUrl'));
    }
    if (form.type === 'audio' && !isDirectAudioUrl(form.audioUrl)) {
      return setMessage(t('startup.messages.invalidAudioUrl'));
    }
    if (form.type === 'image' && !editingId && items.filter((item) => item.type === 'image').length >= 15) {
      return setMessage(t('startup.messages.imageLimit'));
    }

    setBusy(true);
    try {
      const payload = {
        ownerId,
        section,
        type: form.type,
        title: form.title.trim(),
        text: form.type === 'text' ? form.text.trim() : '',
        source: form.source.trim(),
        repeat: Math.max(1, Number(form.repeat) || 1),
        ...(form.type === 'image' ? { imageUrl: form.imageUrl.trim() } : {}),
        ...(form.type === 'audio' ? { audioUrl: form.audioUrl.trim() } : {}),
        order: editingId ? items.find((item) => item.id === editingId)?.order || 0 : items.length,
        active: items.find((item) => item.id === editingId)?.active ?? true,
        ...(editingId ? {} : { createdAt: serverTimestamp() }),
      };
      if (editingId) await updateDoc(doc(db, 'startup_items', editingId), payload);
      else await addDoc(collection(db, 'startup_items'), payload);
      resetForm();
      setMessage(t('startup.messages.contentSaved'));
    } catch (saveError) {
      console.error('Unable to save startup content:', saveError);
      setMessage(t('startup.messages.contentSaveError'));
    } finally {
      setBusy(false);
    }
  };

  const importLibrary = async () => {
    setBusy(true);
    setMessage('');
    try {
      const base = section === 'coran'
        ? verses.map((verse) => ({
          section,
          type: 'text' as const,
          title: verse.title,
          text: verse.text,
          source: verse.source,
          repeat: 1,
        }))
        : adhkarLibrary.filter((item) => item.section === section);
      const existing = new Set(sectionItems.map((item) => `${item.source}|${item.title}`));
      const toAdd = base.filter((item) => !existing.has(`${item.source}|${item.title}`));
      if (!toAdd.length) {
        setMessage(t('startup.messages.libraryAlreadyAdded'));
        return;
      }
      const batch = writeBatch(db);
      toAdd.forEach((item, index) => {
        const ref = doc(collection(db, 'startup_items'));
        batch.set(ref, {
          ...item,
          ownerId,
          active: item.text !== '',
          order: items.length + index,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setMessage(t('startup.messages.libraryAdded', { count: toAdd.length }));
    } catch (importError) {
      console.error('Unable to import startup library:', importError);
      setMessage(t('startup.messages.libraryAddError'));
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async (item: StartupItem, direction: -1 | 1) => {
    const index = sectionItems.findIndex((current) => current.id === item.id);
    const target = sectionItems[index + direction];
    if (!target) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'startup_items', item.id), { order: target.order });
    batch.update(doc(db, 'startup_items', target.id), { order: item.order });
    await batch.commit();
  };

  const beginEdit = (item: StartupItem) => {
    setEditingId(item.id);
    setForm({
      type: item.type === 'image' || item.type === 'audio' ? item.type : 'text',
      title: item.title,
      text: item.text || '',
      source: item.source || '',
      repeat: item.repeat || 1,
      imageUrl: item.imageUrl || '',
      legacyImageData: item.imageData || '',
      audioUrl: item.audioUrl || '',
    });
  };

  const testAudio = () => {
    setMessage('');
    if (!isDirectAudioUrl(form.audioUrl)) {
      return setMessage(t('startup.messages.invalidAudioUrl'));
    }
    const audio = audioPreview.current;
    if (!audio) return setMessage(t('startup.messages.audioPlayerUnavailable'));
    audio.volume = config.volume;
    audio.currentTime = 0;
    void audio.play().then(() => {
      setMessage(t('startup.messages.audioStarted'));
    }).catch(() => {
      setMessage(t('startup.messages.audioFileError'));
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">{t('startup.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('startup.description')}</p>
      </div>

      <aside className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <h2 className="font-bold">{t('startup.hostingTitle')}</h2>
        <p className="mt-1">{t('startup.hostingDescription')}</p>
      </aside>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-black uppercase tracking-wider text-slate-700">{t('startup.generalSettings')}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={config.enabled} onChange={(event) => void saveConfig({ enabled: event.target.checked })} />
            {t('startup.enabled')}
          </label>
          <label className="text-sm font-semibold">{t('startup.frequency')}
            <select value={config.frequency} onChange={(event) => void saveConfig({ frequency: event.target.value as typeof config.frequency })} className="mt-1 block w-full rounded-lg border p-2">
              <option value="each_open">{t('startup.eachOpen')}</option>
              <option value="daily_period">{t('startup.dailyPeriod')}</option>
            </select>
          </label>
          <label className="text-sm font-semibold">{t('startup.defaultVolume')}
            <input type="range" min="0" max="1" step="0.05" value={config.volume} onChange={(event) => void saveConfig({ volume: Number(event.target.value) })} className="mt-3 block w-full" />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.loop} onChange={(event) => void saveConfig({ loop: event.target.checked })} />{t('startup.loop')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.background} onChange={(event) => void saveConfig({ background: event.target.checked })} />{t('startup.background')}</label>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {(['matin', 'soir', 'rizq', 'coran'] as StartupSection[]).map((key) => (
            <div key={key} className="rounded-xl border border-slate-100 p-3">
              <p className="mb-2 text-xs font-black uppercase text-slate-600">{t(SECTION_KEYS[key])}</p>
              <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={config.schedule[key].allDay} onChange={(event) => void saveConfig({ schedule: { ...config.schedule, [key]: { ...config.schedule[key], allDay: event.target.checked } } })} />{t('startup.allDay')}</label>
              <div className="flex gap-2">
                <input aria-label={t('startup.startTime', { section: t(SECTION_KEYS[key]) })} type="time" value={config.schedule[key].start} onChange={(event) => void saveConfig({ schedule: { ...config.schedule, [key]: { ...config.schedule[key], start: event.target.value } } })} className="rounded border p-1 text-sm" />
                <input aria-label={t('startup.endTime', { section: t(SECTION_KEYS[key]) })} type="time" value={config.schedule[key].end} onChange={(event) => void saveConfig({ schedule: { ...config.schedule, [key]: { ...config.schedule[key], end: event.target.value } } })} className="rounded border p-1 text-sm" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {(['coran', 'matin', 'soir', 'rizq'] as StartupSection[]).map((key) => (
          <button key={key} onClick={() => { setSection(key); resetForm(); }} className={`rounded-xl px-4 py-2 text-sm font-bold ${section === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}>{t(SECTION_KEYS[key])}</button>
        ))}
      </div>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-slate-800">{t(SECTION_KEYS[section])}</h2>
            <button onClick={() => void importLibrary()} disabled={busy} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50">{t('startup.addFromLibrary')}</button>
          </div>
          {sectionItems.map((item, index) => (
            <article key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {item.type === 'audio' ? <Music2 className="h-4 w-4 text-indigo-500" /> : item.type === 'image' ? <ImagePlus className="h-4 w-4 text-ds-accent" /> : null}
                  <h3 className="truncate font-bold text-slate-800">{item.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.active ? t('startup.active') : t('startup.disabled')}</span>
                </div>
                {item.type === 'text' && <p className="font-arabic mt-2 line-clamp-2 text-end text-lg text-slate-600" dir="rtl">{item.text}</p>}
                {item.source && <p className="mt-2 text-xs text-slate-400">{item.source}</p>}
                {item.type === 'audio' && <p className="mt-2 truncate text-xs text-slate-500">{item.audioUrl}</p>}
                {item.type === 'image' && (item.imageUrl || item.imageData) && (
                  <img src={item.imageUrl || item.imageData} alt={item.title} className="mt-2 max-h-24 rounded-lg object-contain" />
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <button aria-label={t('startup.moveUp')} disabled={index === 0} onClick={() => void runAction(() => moveItem(item, -1))} className="rounded p-2 text-slate-500 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button aria-label={t('startup.moveDown')} disabled={index === sectionItems.length - 1} onClick={() => void runAction(() => moveItem(item, 1))} className="rounded p-2 text-slate-500 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button aria-label={t('startup.toggleContent', { title: item.title })} onClick={() => void runAction(() => updateDoc(doc(db, 'startup_items', item.id), { active: !item.active }))} className="rounded px-2 text-xs font-bold text-indigo-600">{item.active ? t('startup.deactivate') : t('startup.activate')}</button>
                <button aria-label={t('startup.edit')} onClick={() => beginEdit(item)} className="rounded px-2 text-xs font-bold text-indigo-600">{t('startup.edit')}</button>
                <button aria-label={t('startup.delete')} onClick={() => void runAction(() => deleteDoc(doc(db, 'startup_items', item.id)))} className="rounded p-2 text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!sectionItems.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-400">{t('startup.emptySection')}</p>}
        </div>

        <form onSubmit={saveItem} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-800">{editingId ? t('startup.editContent') : t('startup.addContent')}</h2>
          <label className="block text-xs font-bold text-slate-600">{t('startup.type')}
            <select value={form.type} onChange={(event) => { const type = event.target.value as typeof form.type; setForm({ ...form, type }); }} className="mt-1 w-full rounded-lg border p-2">
              <option value="text">{t('startup.textSlide')}</option>
              <option value="image">{t('startup.imageSlide')}</option>
              <option value="audio">{t('startup.audioTrack')}</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">{t('startup.contentTitle')}
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 w-full rounded-lg border p-2" required />
          </label>
          {form.type === 'text' && <>
            <label className="block text-xs font-bold text-slate-600">{t('startup.arabicText')}
              <textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} dir="rtl" rows={5} className="font-arabic mt-1 w-full rounded-lg border p-2 text-lg" required />
            </label>
            <label className="block text-xs font-bold text-slate-600">{t('startup.source')}
              <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="block text-xs font-bold text-slate-600">{t('startup.repetitions')}
              <input type="number" min="1" value={form.repeat} onChange={(event) => setForm({ ...form, repeat: Number(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
          </>}
          {form.type === 'image' && <>
            <label className="block text-xs font-bold text-slate-600">{t('startup.imageUrl')}
              <input type="url" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} className="mt-1 w-full rounded-lg border p-2" placeholder={t('startup.imageUrlPlaceholder')} />
            </label>
            <p className="text-xs text-slate-500">{t('startup.imageHelp')}</p>
            {imagePreview && <img src={imagePreview} alt={t('startup.imagePreview')} onError={() => setMessage(t('startup.messages.imageFileError'))} className="max-h-56 rounded-lg object-contain" />}
          </>}
          {form.type === 'audio' && <>
            <label className="block text-xs font-bold text-slate-600">{t('startup.audioUrl')}
              <input type="url" value={form.audioUrl} onChange={(event) => setForm({ ...form, audioUrl: event.target.value })} className="mt-1 w-full rounded-lg border p-2" placeholder={t('startup.audioUrlPlaceholder')} />
            </label>
            <button type="button" onClick={testAudio} className="rounded-lg border px-3 py-2 text-xs font-bold text-indigo-700">{t('startup.testPlayback')}</button>
            <audio
              ref={audioPreview}
              controls
              preload="none"
              src={isDirectAudioUrl(form.audioUrl) ? form.audioUrl.trim() : undefined}
              onError={() => setMessage(t('startup.messages.audioFileError'))}
              className="w-full"
            />
          </>}
          {message && <p role="status" className="text-sm text-indigo-700">{message}</p>}
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} type="submit" className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{busy ? t('startup.saving') : t('startup.save')}</button>
            {editingId && <button type="button" onClick={resetForm} className="rounded-lg border px-4 py-2 text-sm font-bold text-slate-600">{t('startup.cancel')}</button>}
          </div>
        </form>
      </section>
    </div>
  );
}
