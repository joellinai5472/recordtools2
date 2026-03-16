/// <reference types="vite/client" />
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { transcribeAudioWithGemini } from './GeminiService';
import {
  Mic, Play, Pause, Square, Download, RotateCcw, CheckCircle2, AlertTriangle,
  Volume2, ExternalLink, Info, Copy, FileText, Loader2, MessageSquare,
  Sparkles, Activity, Lock, X
} from 'lucide-react';
import { Level, LevelLabels, MicStatus, AppSettings } from './types';
import { PROMPT_L2 } from './prompts';

// --- Constants ---
const STORAGE_KEY = 'newcourse_user_id';
const CHATPWC_LINK = "https://eu.chat.pwc.com/c/new";
const AI_STORAGE_KEY = 'newcourse_ai_enabled';
const DEFAULT_TRANSCRIPT_PLACEHOLDER = "(請點選上方按鈕產出逐字稿)";
const TRANSCRIPT_KEY = 'newcourse_transcript';
const PREP_NOTES_KEY = 'newcourse_prep_notes';
const UNLOCKED_LEVELS_KEY = 'newcourse_unlocked_levels';
const DEFAULT_YOUTUBE_URL = 'https://www.youtube.com/embed/Mp3Msfw90BE';

// --- Admin Config ---
const PASSCODES: Record<string, string> = {
  [Level.LV2]: 'go2',
};
const GLOBAL_TRANSCRIPT_ENABLED = import.meta.env.VITE_ENABLE_TRANSCRIPT !== 'false';
const CURRENT_VERSION_TAG = "v1.0.0";

// --- IndexedDB Utilities ---
const DB_NAME = 'NewCourseRecDB';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveAudioBlob = async (key: string, blob: Blob) => {
  try { const db = await openDB(); const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(blob, key); } catch (e) { console.error('Failed to save audio to IDB', e); }
};

const getAudioBlob = async (key: string): Promise<Blob | null> => {
  try {
    const db = await openDB(); const tx = db.transaction(STORE_NAME, 'readonly'); const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve) => { const r = store.get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
  } catch (e) { return null; }
};

// --- Helper: getCleanLevelLabel ---
const getCleanLevelLabel = (lv: Level) => LevelLabels[lv].replace(/【Level \d】/, '');

// --- VolumeVisualizer ---
const VolumeVisualizer: React.FC<{ stream: MediaStream | null }> = ({ stream }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!stream) return;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
    source.connect(analyser);
    const bufferLength = analyser.frequencyBinCount; const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let animationId: number;
    const draw = () => {
      animationId = requestAnimationFrame(draw); analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barCount = 30; const barWidth = canvas.width / barCount;
      ctx.fillStyle = '#F4A261';
      for (let i = 0; i < barCount; i++) { const value = dataArray[i + 5] || 0; const barHeight = (value / 255) * canvas.height; ctx.fillRect(i * barWidth, canvas.height - barHeight, barWidth - 2, barHeight); }
    };
    draw();
    return () => { cancelAnimationFrame(animationId); if (audioContext.state !== 'closed') audioContext.close(); };
  }, [stream]);
  return <canvas ref={canvasRef} width={240} height={40} className="w-60 h-10" />;
};

// --- MicTestModal ---
const MicTestModal: React.FC<{
  isOpen: boolean; onClose: () => void; onConfirm: () => void; stream: MediaStream | null;
  isTesting: boolean; testAudioBlob: Blob | null; runTest: () => void;
}> = ({ isOpen, onClose, onConfirm, stream, isTesting, testAudioBlob, runTest }) => {
  if (!isOpen) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-brand-dark/95 backdrop-blur-md animate-fade-in">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8 md:p-10 space-y-8">
          <div className="text-center space-y-2">
            <div className="bg-brand-orange/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"><Mic className="w-10 h-10 text-brand-orange" /></div>
            <h2 className="text-3xl font-black text-brand-dark">麥克風收音測試</h2>
            <p className="text-brand-slate font-bold">正式錄音前，先確認收音狀態</p>
          </div>
          <div className="bg-brand-dark/5 p-8 rounded-3xl flex flex-col items-center gap-6 border-2 border-brand-orange/10 shadow-inner">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] font-black text-brand-slate uppercase tracking-widest">即時音量波紋</span>
              <VolumeVisualizer stream={stream} />
            </div>
            <div className="w-full h-px bg-brand-slate/10" />
            <div className="w-full flex flex-col items-center gap-4">
              {!testAudioBlob && !isTesting ? (
                <button onClick={runTest} className="w-full py-5 bg-brand-orange text-white rounded-2xl font-black shadow-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 text-lg"><Activity className="w-6 h-6" /> 開始試錄</button>
              ) : isTesting ? (
                <div className="w-full space-y-6 flex flex-col items-center">
                  <p className="text-red-500 font-extrabold text-xl animate-bounce">正在錄製中...</p>
                  <button onClick={runTest} className="w-full py-4 bg-brand-dark text-white rounded-2xl font-black shadow-lg"><Square className="w-5 h-5 inline mr-2" />停止並檢查</button>
                </div>
              ) : (
                <div className="w-full space-y-4">
                  <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex items-center gap-4"><div className="bg-green-500 text-white p-2 rounded-full"><CheckCircle2 className="w-5 h-5" /></div><p className="text-green-800 font-black text-sm">試錄完成！請確認是否能聽到聲音</p></div>
                  <audio src={testAudioBlob ? URL.createObjectURL(testAudioBlob) : ''} controls className="w-full" />
                  <button onClick={runTest} className="w-full py-3 bg-brand-slate/10 text-brand-slate rounded-xl font-bold text-sm">重新試錄</button>
                </div>
              )}
            </div>
          </div>
          <button onClick={onConfirm} disabled={!testAudioBlob || isTesting} className={`w-full py-5 rounded-3xl font-black text-xl shadow-2xl transition-all flex items-center justify-center gap-3 ${!testAudioBlob || isTesting ? 'bg-brand-slate/10 text-brand-slate cursor-not-allowed' : 'bg-[#1D2D44] text-white hover:bg-[#2A3F5F] active:scale-95'}`}>
            確認沒問題，正式開始錄音 <Sparkles className="w-6 h-6 text-brand-orange" />
          </button>
          <button onClick={onClose} className="w-full text-brand-slate/60 text-sm font-black uppercase tracking-widest hover:text-brand-orange transition-all py-2">暫時取消</button>
        </div>
      </div>
    </div>, document.body
  );
};

// --- ContextPreviewBox ---
const ContextPreviewBox: React.FC<{ content: string; title: string; onCopy: () => void }> = ({ content, title, onCopy }) => (
  <div className="bg-[#E9ECEF]/50 border border-brand-slate/20 rounded-2xl overflow-hidden mt-6 animate-fade-in shadow-sm">
    <div className="bg-[#E9ECEF] px-5 py-4 flex items-center justify-between border-b border-brand-slate/10">
      <h4 className="text-sm font-black text-brand-dark tracking-wide flex items-center gap-3"><MessageSquare className="w-5 h-5 text-brand-orange" />{title}</h4>
      <div className="flex gap-2">
        <button onClick={onCopy} className="px-5 py-2.5 bg-brand-orange hover:bg-orange-500 text-brand-dark text-xs font-black rounded-lg transition-all flex items-center gap-2 shadow-md active:scale-95"><Copy className="w-4 h-4" /> 一鍵複製</button>
        <a href={CHATPWC_LINK} target="_blank" rel="noreferrer" className="px-5 py-2.5 bg-[#1D2D44] hover:bg-black text-white text-xs font-black rounded-lg transition-all flex items-center gap-2 shadow-md active:scale-95"><ExternalLink className="w-4 h-4" /> ChatPwC</a>
      </div>
    </div>
    <div className="p-5 bg-white"><textarea readOnly className="w-full h-80 text-base text-brand-dark/70 bg-transparent border-0 resize-none focus:ring-0 custom-scrollbar font-sans leading-relaxed whitespace-pre-wrap outline-none" value={content} /></div>
  </div>
);

// --- WAV Conversion ---
function audioBufferToWav(buffer: AudioBuffer) {
  const numOfChan = buffer.numberOfChannels, length = buffer.length * numOfChan * 2 + 44, bufferArr = new ArrayBuffer(length), view = new DataView(bufferArr), channels: Float32Array[] = [], sampleRate = buffer.sampleRate;
  let offset = 0, pos = 0;
  function setUint16(data: number) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data: number) { view.setUint32(pos, data, true); pos += 4; }
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
  for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
  let maxPeak = 0;
  for (let i = 0; i < numOfChan; i++) { for (let j = 0; j < buffer.length; j++) { const absValue = Math.abs(channels[i][j]); if (absValue > maxPeak) maxPeak = absValue; } }
  const targetPeak = 0.89; const gain = maxPeak > 0.01 ? targetPeak / maxPeak : 1.0;
  while (pos < length) { for (let i = 0; i < numOfChan; i++) { let sample = channels[i][offset] * gain; sample = Math.max(-1, Math.min(1, sample)); view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true); pos += 2; } offset++; }
  return new Blob([bufferArr], { type: "audio/wav" });
}

const convertToWav = async (webmBlob: Blob): Promise<Blob> => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await webmBlob.arrayBuffer(); const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const wavBlob = audioBufferToWav(audioBuffer); audioCtx.close(); return wavBlob;
};

// =============================================
// MAIN APP COMPONENT
// =============================================
function App() {
  // --- Detect Instructor Mode via URL ---
  const [isInstructorMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'instructor';
  });
  const [youtubeUrl, setYoutubeUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('video') ? `https://www.youtube.com/embed/${params.get('video')}` : DEFAULT_YOUTUBE_URL;
  });

  // --- Settings ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    return { userId: savedId || '', rememberMe: !!savedId, level: Level.LV1, targetDuration: 120 };
  });

  // --- Recording State ---
  const [recordingData, setRecordingData] = useState<{ blob: Blob; rawBlob?: Blob; url: string; transcript: string } | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>(MicStatus.UNAUTHORIZED);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [processingStatus, setProcessingStatus] = useState('');
  const [warningMsg, setWarningMsg] = useState('');
  const [canAnalyze, setCanAnalyze] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [showMicTestModal, setShowMicTestModal] = useState(false);
  const [testAudioBlob, setTestAudioBlob] = useState<Blob | null>(null);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [hasCompletedMicTest, setHasCompletedMicTest] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => { const s = localStorage.getItem(AI_STORAGE_KEY); return s === null ? true : s === 'true'; });
  const [adminClickCount, setAdminClickCount] = useState(0);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [unlockedLevels, setUnlockedLevels] = useState<Set<Level>>(() => {
    const saved = localStorage.getItem(UNLOCKED_LEVELS_KEY);
    return saved ? new Set(JSON.parse(saved)) : new Set([Level.LV1]);
  });

  // --- PREP Notes State ---
  const [prepNotes, setPrepNotes] = useState<{ p1: string; r: string; e: string; p2: string }>(() => {
    const saved = localStorage.getItem(PREP_NOTES_KEY);
    return saved ? JSON.parse(saved) : { p1: '', r: '', e: '', p2: '' };
  });

  // --- Refs ---
  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const testMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const shouldIgnoreStopRef = useRef(false);
  const currentSessionIdRef = useRef<number>(0);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // --- Persistence Effects ---
  useEffect(() => { const on = () => setIsOnline(true); const off = () => setIsOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); if (timerRef.current) clearInterval(timerRef.current); }; }, []);
  useEffect(() => { localStorage.setItem(UNLOCKED_LEVELS_KEY, JSON.stringify(Array.from(unlockedLevels))); }, [unlockedLevels]);
  useEffect(() => { localStorage.setItem(AI_STORAGE_KEY, aiEnabled.toString()); }, [aiEnabled]);
  useEffect(() => { if (settings.rememberMe) localStorage.setItem(STORAGE_KEY, settings.userId); else localStorage.removeItem(STORAGE_KEY); }, [settings.userId, settings.rememberMe]);
  useEffect(() => { localStorage.setItem(PREP_NOTES_KEY, JSON.stringify(prepNotes)); }, [prepNotes]);
  useEffect(() => { if (recordingData?.transcript) localStorage.setItem(TRANSCRIPT_KEY, recordingData.transcript); if (recordingData?.blob && recordingData.blob.size > 0) saveAudioBlob('rec_blob', recordingData.blob); }, [recordingData?.transcript, recordingData?.blob]);
  useEffect(() => {
    const loadStoredData = async () => {
      const t = localStorage.getItem(TRANSCRIPT_KEY); const b = await getAudioBlob('rec_blob');
      if (b) setRecordingData({ blob: b, url: URL.createObjectURL(b), transcript: t || '' });
      else if (t) setRecordingData({ blob: new Blob(), url: '', transcript: t });
    };
    loadStoredData();
  }, []);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (isRecordingRef.current) { e.preventDefault(); e.returnValue = '錄音正在進行中，確定離開嗎？'; return e.returnValue; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, []);

  // --- Timer ---
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(prev => {
          if (prev === 150) setWarningMsg("建議準備結尾");
          else if (prev === 180) setWarningMsg("錄音超時，請儘速結束");
          else if (prev >= 300) { stopRecording(); alert("錄音已達 5 分鐘上限。"); }
          return prev + 1;
        });
      }, 1000);
    } else { if (timerRef.current) clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording, isPaused]);

  // --- Level Change ---
  const handleLevelChange = (lv: Level) => {
    if (settings.level === lv) return;
    if (isRecording && !confirm('錄音中，切換關卡會遺失內容。確定？')) return;
    if (lv === Level.LV1 || unlockedLevels.has(lv)) {
      setSettings(prev => ({ ...prev, level: lv })); setElapsedSeconds(0); setHasDownloaded(false); setIsRecording(false); setIsPaused(false); setIsProcessing(false); setWarningMsg(''); setHasPlayed(false);
      return;
    }
    const code = window.prompt(`請輸入 ${lv} 解鎖代碼：`);
    if (code === PASSCODES[lv]) {
      setUnlockedLevels(prev => new Set([...prev, lv])); setSettings(prev => ({ ...prev, level: lv }));
      setElapsedSeconds(0); setHasDownloaded(false); setIsRecording(false); setIsPaused(false); setIsProcessing(false); setProcessingStatus(''); setWarningMsg(''); setHasPlayed(false);
    } else if (code !== null) alert('代碼錯誤，無法解鎖。');
  };

  // --- Recording Functions ---
  const copyTextToClipboard = async (text: string) => { try { await navigator.clipboard.writeText(text); alert('已複製到剪貼簿'); } catch { setError('複製失敗'); } };

  const startRecording = async () => {
    if (!settings.userId.trim()) { setError('請填寫你的名字'); return; }
    setError(null);
    if (streamRef.current && streamRef.current.active) {
      if (hasCompletedMicTest) { setIsProcessing(true); setProcessingStatus('麥克風熱啟動中...'); setTimeout(() => { setIsProcessing(false); setProcessingStatus(''); startOfficialRecording(); }, 500); }
      else setShowMicTestModal(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      streamRef.current = stream; setMicStatus(MicStatus.AVAILABLE);
      if (hasCompletedMicTest) { setIsProcessing(true); setProcessingStatus('麥克風對焦中...'); setTimeout(() => { setIsProcessing(false); setProcessingStatus(''); startOfficialRecording(); }, 1500); }
      else setShowMicTestModal(true);
    } catch { setMicStatus(MicStatus.UNAVAILABLE); setError('無法存取麥克風。'); }
  };

  const runMicTest = async () => {
    if (!streamRef.current) return;
    if (isTestingMic) { if (testMediaRecorderRef.current && testMediaRecorderRef.current.state !== 'inactive') testMediaRecorderRef.current.stop(); setIsTestingMic(false); }
    else {
      setIsTestingMic(true); setTestAudioBlob(null);
      const mr = new MediaRecorder(streamRef.current); testMediaRecorderRef.current = mr; const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => setTestAudioBlob(new Blob(chunks, { type: mr.mimeType }));
      mr.start();
    }
  };

  const handleStartOfficialRecording = () => { setShowMicTestModal(false); setHasCompletedMicTest(true); startOfficialRecording(); };

  const startOfficialRecording = async () => {
    const stream = streamRef.current; if (!stream) return;
    setWarningMsg(''); setCanAnalyze(false); setIsAnalyzing(false); setHasPlayed(false);
    const sessionId = Date.now(); currentSessionIdRef.current = sessionId; shouldIgnoreStopRef.current = false;
    const mr = new MediaRecorder(stream, { audioBitsPerSecond: 64000 }); mediaRecorderRef.current = mr; chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    setIsProcessing(true); setProcessingStatus('啟動收音軌道...');
    setTimeout(() => { if (mr.state === 'inactive') { mr.start(1000); setIsRecording(true); setIsPaused(false); setElapsedSeconds(0); setMicStatus(MicStatus.RECORDING); setHasDownloaded(false); setIsProcessing(false); setProcessingStatus(''); } }, 300);
    mr.onstop = async () => {
      if (currentSessionIdRef.current !== sessionId) return;
      if (shouldIgnoreStopRef.current) { shouldIgnoreStopRef.current = false; setIsProcessing(false); return; }
      setIsProcessing(true); setProcessingStatus('正在處理音訊...');
      try {
        const rawBlob = new Blob(chunksRef.current, { type: mr.mimeType }); if (rawBlob.size === 0) throw new Error("未偵測到音訊。");
        setProcessingStatus('封裝 WAV...'); const wavBlob = await convertToWav(rawBlob);
        setRecordingData({ blob: wavBlob, rawBlob, url: URL.createObjectURL(wavBlob), transcript: DEFAULT_TRANSCRIPT_PLACEHOLDER });
      } catch { setError("音訊處理失敗。"); }
      finally { setIsProcessing(false); setProcessingStatus(''); setMicStatus(MicStatus.AVAILABLE); setIsRecording(false); setIsPaused(false); setTimeout(() => setCanAnalyze(true), 3000); }
    };
  };

  const pauseRecording = () => { if (mediaRecorderRef.current?.state === 'recording') { mediaRecorderRef.current.pause(); setIsPaused(true); } };
  const stopRecording = () => { if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) mediaRecorderRef.current.stop(); };
  const resumeRecording = () => { if (mediaRecorderRef.current?.state === 'paused') { mediaRecorderRef.current.resume(); setIsPaused(false); } };

  const resetRecording = () => {
    if (!confirm('確定要重新錄製嗎？')) return;
    shouldIgnoreStopRef.current = true; currentSessionIdRef.current = 0;
    if (mediaRecorderRef.current) { try { if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop(); } catch {} mediaRecorderRef.current = null; }
    setElapsedSeconds(0); setHasDownloaded(false); setIsRecording(false); setIsPaused(false); setIsProcessing(false); setMicStatus(MicStatus.AVAILABLE); setProcessingStatus(''); setRecordingData(null); chunksRef.current = []; setHasPlayed(false);
  };

  const handleAnalyze = async () => {
    if (!recordingData?.blob) return;
    if (!isOnline) { setError("請檢查網路連線"); return; }
    if (!aiEnabled || !GLOBAL_TRANSCRIPT_ENABLED) { setError("轉錄功能暫不開放"); return; }
    try {
      const audio = recordingData.blob; const mime = "audio/wav";
      let result;
      if (new URLSearchParams(window.location.search).get('mock') === 'true') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        result = "這是一段測試用的虛擬逐字稿，因為您在網址加入了 mock=true 模式，所以這次測試沒有消耗任何 Gemini 的 API 額度。這段文字可以用來測試後續的 UI 功能。";
      } else {
        result = await transcribeAudioWithGemini(audio, mime);
      }      setRecordingData({ ...recordingData, transcript: result });
    } catch (e: any) { setError(`分析失敗: ${e.message}`); }
    finally { setIsAnalyzing(false); }
  };

  const downloadFile = (blob: Blob) => {
    const now = new Date(); const d = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;
    const t = `${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
    const name = `新課程_錄音_${settings.userId.replace(/\s+/g,'_')}_${d}_${t}.wav`;
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setHasDownloaded(true);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  // =============================================
  // INSTRUCTOR MODE
  // =============================================
  if (isInstructorMode) {
    const changeVideo = () => {
      const input = prompt('請輸入 YouTube 影片網址或 ID (例如: https://youtu.be/Mp3Msfw90BE)：');
      if (!input) return;
      const match = input.match(/(?:youtu\.be\/|youtube\.com\/.*(?:v=|embed\/|v\/))([\w-]{11})/);
      const id = match ? match[1] : input.trim();
      if (id) setYoutubeUrl(`https://www.youtube.com/embed/${id}`);
    };

    return (
      <div className="fixed inset-0 bg-brand-slate overflow-hidden flex flex-col">
        {/* Hidden Control Button (top right hover) */}
        <div className="absolute top-6 right-6 z-20 opacity-0 hover:opacity-100 transition-opacity duration-300">
          <button onClick={changeVideo} className="px-5 py-3 bg-brand-dark/90 text-white rounded-xl text-sm font-black border border-white/20 hover:bg-brand-orange hover:text-brand-dark hover:border-brand-orange transition-all shadow-xl">更換 YouTube 影片</button>
        </div>

        {/* YouTube Video Section */}
        <div className="flex-1 w-full bg-black relative z-0">
          <iframe
            src={`${youtubeUrl}?autoplay=1&rel=0&controls=1`}
            className="absolute inset-0 w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            title="Course Video"
          />
        </div>

        {/* Prompts Section */}
        <div className="w-full bg-brand-dark border-t border-white/10 px-8 py-4 z-10 flex-none bg-opacity-95 backdrop-blur-md">
          <div className="max-w-7xl mx-auto flex gap-4">
            <div className="flex-1 bg-white/5 border border-brand-orange/40 rounded-2xl p-4 shadow-lg flex flex-col justify-center">
              <div className="bg-brand-orange px-3 py-1 rounded-lg text-xs font-black text-brand-dark uppercase tracking-wider inline-block mb-2 w-max shadow-sm shadow-brand-orange/20">主線</div>
              <p className="text-white text-sm font-bold leading-relaxed">用你自己的話寫：<span className="text-brand-orange ml-1">它最想提醒我們什麼？</span></p>
            </div>
            <div className="flex-1 bg-white/5 border border-blue-500/40 rounded-2xl p-4 shadow-lg flex flex-col justify-center">
              <div className="bg-blue-500 px-3 py-1 rounded-lg text-xs font-black text-white uppercase tracking-wider inline-block mb-2 w-max shadow-sm shadow-blue-500/20">支撐</div>
              <p className="text-white text-sm font-bold leading-relaxed">記下你聽到的<span className="text-blue-400 mx-1">重點或做法</span>，快速條列就好。</p>
            </div>
            <div className="flex-1 bg-white/5 border border-emerald-500/40 rounded-2xl p-4 shadow-lg flex flex-col justify-center">
              <div className="bg-emerald-500 px-3 py-1 rounded-lg text-xs font-black text-white uppercase tracking-wider inline-block mb-2 w-max shadow-sm shadow-emerald-500/20">亮點</div>
              <p className="text-white text-sm font-bold leading-relaxed">記<span className="text-emerald-400 mx-1">一句原話</span>、一個具體做法、或一個能描述的場景</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =============================================
  // STUDENT MODE (Level 1 & Level 2)
  // =============================================
  return (
    <div className="min-h-screen pb-20 selection:bg-brand-orange selection:text-brand-dark">
      <header className="sticky top-0 z-30 w-full glass-panel border-b border-brand-slate/10 py-3 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-brand-orange p-2 rounded-xl shadow-lg shadow-brand-orange/20"><Volume2 className="w-6 h-6 text-brand-dark" /></div>
          <h1 className="text-xl font-black text-brand-dark tracking-tighter uppercase">表達力錄音工具</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-3 space-y-3">
        {/* Settings Panel */}
        <section className={`glass-panel rounded-2xl p-4 transition-all duration-500 ${isRecording ? 'opacity-30 blur-sm pointer-events-none' : 'hover:shadow-2xl shadow-xl'}`}>
          <div className="flex items-center gap-3 mb-4"><div className="w-1 h-5 bg-brand-orange rounded-full"></div><h3 className="text-xs font-black text-brand-slate uppercase tracking-widest">學員設定</h3></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-xs font-black text-brand-slate uppercase tracking-widest flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> 您的姓名</label>
              <input type="text" placeholder="請輸入姓名" className="w-full h-12 px-5 bg-brand-dark/5 border-2 border-transparent focus:border-brand-orange focus:bg-white rounded-xl text-base font-bold text-brand-dark transition-all outline-none placeholder:text-brand-slate/40" value={settings.userId} onChange={e => setSettings({ ...settings, userId: e.target.value })} />
            </div>
            <div className="space-y-3">
              <label className="text-xs font-black text-brand-slate uppercase tracking-widest flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> 當前學習進度</label>
              <select className="w-full h-12 px-5 bg-brand-dark/5 border-2 border-transparent focus:border-brand-orange focus:bg-white rounded-xl text-base font-bold text-brand-dark transition-all outline-none appearance-none cursor-pointer" value={settings.level} onChange={e => handleLevelChange(e.target.value as Level)}>
                {Object.entries(LevelLabels).map(([lv, label]) => { const v = lv as Level; const locked = v !== Level.LV1 && !unlockedLevels.has(v); return <option key={v} value={v}>{locked ? `🔒 ${label}` : label}</option>; })}
              </select>
            </div>
          </div>
        </section>

        {/* Level Mission Card */}
        <section className="glass-panel overflow-hidden rounded-3xl shadow-2xl border-0">
          <div className="bg-[#1D2D44] px-8 py-3 flex items-center gap-4">
            <div className="bg-[#495057] px-4 py-1.5 rounded-lg text-xs font-black text-white uppercase tracking-wider">Level {Object.values(Level).indexOf(settings.level) + 1}</div>
            <h3 className="text-xl font-black text-white tracking-wide">{getCleanLevelLabel(settings.level)}</h3>
          </div>

          <div className="p-4 space-y-4">
            {/* ===== LEVEL 1: PREP NOTES ===== */}
            {settings.level === Level.LV1 && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-[#FEF3E7] border-l-8 border-[#F4A261] p-8 rounded-3xl">
                  <p className="text-[#8E9AAF] text-xs font-black uppercase tracking-[0.3em] mb-2">Current Mission</p>
                  <h3 className="text-3xl font-black text-[#1D2D44]">將你的主線、支撐、亮點筆記，改寫成 PREP</h3>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-brand-slate/10 space-y-3">
                  <div className="flex items-start gap-4">
                    <div className="bg-[#E9ECEF] p-2.5 rounded-full"><Info className="w-5 h-5 text-[#495057]" /></div>
                    <div>
                      <h4 className="text-lg font-bold text-[#1D2D44] mb-1">改寫提示</h4>
                      <p className="text-[#6C757D] text-sm font-medium">請參考影片中記錄的主線、支撐與亮點，跟隨下方提示，一步步將它們轉化為完整、有說服力的 PREP 架構。</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {([
                    { key: 'p1' as const, label: 'P — 把主線轉成你的觀點', sub: '(不是搬過來，是用你的話重新講)', color: '[#F4A261]', hint: '可以參考以下句型：\n• 轉折：我原本以為 ____，但 ____ 讓我發現 ____\n• 濃縮：如果只留一個重點，我會說 ____\n• 認同：我最認同的是 ____', bgPattern: 'bg-[#FEF3E7]', textSub: 'text-[#F4A261]' },
                    { key: 'r' as const, label: 'R — 從支撐裡挑兩個最有力的', sub: '(不用全部講)', color: 'blue-500', hint: '挑 2 個最能支持你觀點的理由，其他的放掉', bgPattern: 'bg-[#FEF3E7]', textSub: 'text-blue-500' },
                    { key: 'e' as const, label: 'E — 把亮點的內容講出來', sub: '(不要只說「有提到一個方法」)', color: 'emerald-500', hint: '嘗試加一個數字、加一個場景或加一句話', bgPattern: 'bg-[#FEF3E7]', textSub: 'text-emerald-500' },
                    { key: 'p2' as const, label: 'P — 這是你自己要補的', sub: '(你的立場、建議、或打算怎麼做)', color: 'purple-500', hint: '立場可以是主張型、建議型或個人行動型', bgPattern: 'bg-[#FEF3E7]', textSub: 'text-purple-500' },
                  ]).map((item) => (
                    <div key={item.key} className="bg-white rounded-2xl shadow-sm border border-brand-slate/10 overflow-hidden hover:shadow-md transition-all flex flex-col">
                      <div className={`${item.bgPattern} px-6 py-4 flex flex-col justify-center gap-2 border-b border-[#F4A261]/20`}>
                        <div className="flex items-center gap-3">
                          <h4 className="text-base font-black text-[#1D2D44] tracking-wide">{item.label}</h4>
                        </div>
                        <p className={`text-xs font-black ${item.textSub} ml-1`}>{item.sub}</p>
                      </div>
                      <div className="p-4 flex flex-col flex-1">
                        <div className="text-xs text-brand-slate font-bold mb-3 italic whitespace-pre-wrap leading-relaxed">💬 {item.hint}</div>
                        <textarea
                          className="w-full h-32 mt-auto p-4 bg-brand-dark/5 rounded-xl text-base font-medium text-brand-dark resize-none outline-none border-2 border-transparent focus:border-brand-orange focus:bg-white transition-all placeholder:text-brand-slate/40 custom-scrollbar"
                          placeholder="在此輸入..."
                          value={prepNotes[item.key]}
                          onChange={(e) => setPrepNotes({ ...prepNotes, [item.key]: e.target.value })}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4 justify-center pt-2">
                  <button onClick={() => { const text = `【P 重點】\n${prepNotes.p1}\n\n【R 理由】\n${prepNotes.r}\n\n【E 例子】\n${prepNotes.e}\n\n【P 結尾】\n${prepNotes.p2}`; copyTextToClipboard(text); }} className="px-8 py-4 bg-brand-orange text-brand-dark rounded-xl font-black shadow-lg hover:bg-orange-400 transition-all active:scale-95 flex items-center gap-3"><Copy className="w-5 h-5" /> 複製筆記</button>
                  <button onClick={() => { if (confirm('確定要清除所有筆記嗎？')) setPrepNotes({ p1: '', r: '', e: '', p2: '' }); }} className="px-8 py-4 bg-brand-slate/10 text-brand-slate rounded-xl font-black hover:bg-brand-slate/20 transition-all active:scale-95 flex items-center gap-3"><RotateCcw className="w-5 h-5" /> 清除全部</button>
                </div>
              </div>
            )}

            {/* ===== LEVEL 2: RECORDING + AI ===== */}
            {settings.level === Level.LV2 && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-[#FEF3E7] border-l-8 border-[#F4A261] p-8 rounded-3xl">
                  <p className="text-[#8E9AAF] text-xs font-black uppercase tracking-[0.3em] mb-2">Current Mission</p>
                  <h3 className="text-3xl font-black text-[#1D2D44]">錄音並獲取 AI 回饋</h3>
                </div>

                {/* Recording Area & Notes Split */}
                <div className="flex flex-col xl:flex-row items-stretch gap-6">
                  
                  {/* Left: Recording Area */}
                  <div className={`flex-1 glass-panel-dark rounded-[2.5rem] p-8 flex flex-col items-center gap-8 shadow-2xl relative overflow-hidden transition-all duration-500 ${isProcessing ? 'ring-4 ring-brand-orange animate-pulse' : ''}`}>
                    {isRecording && !isPaused && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-brand-orange/10 rounded-full blur-[100px] pointer-events-none animate-pulse"></div>}

                    <div className={`w-full ${isProcessing ? 'hidden' : 'block'}`}>
                      <div className="w-full flex flex-col items-center justify-center gap-12 z-10 px-4">
                        {/* Timer */}
                        <div className="flex flex-col items-center w-full">
                          <div className="flex items-center gap-3 mb-4 h-8">
                            {isRecording && <div className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-[0.2em] shadow-2xl border-2 ${micStatus === MicStatus.RECORDING ? 'bg-red-500 text-white animate-pulse border-red-400' : 'bg-brand-slate/20 text-brand-slate border-brand-slate/30'}`}>錄製中</div>}
                          </div>
                          <div className={`text-6xl lg:text-8xl font-mono font-bold text-white mb-2 tabular-nums tracking-tighter transition-all duration-500 ${isRecording ? 'scale-110 text-brand-orange' : ''}`}>{formatTime(elapsedSeconds)}</div>
                          {!isRecording && !recordingData && <div className="bg-brand-orange/10 border border-brand-orange/20 px-8 py-4 rounded-3xl animate-fade-in mt-2"><p className="text-lg font-black text-brand-orange uppercase tracking-wider">✨ 建議在 3 分鐘內完成</p></div>}
                        </div>
                        {/* Visualizer & Controls container */}
                        <div className="flex flex-col md:flex-row items-center justify-center gap-12 w-full max-w-2xl">
                          <div className="flex flex-col items-center space-y-8 flex-1">
                            <VolumeVisualizer stream={streamRef.current} />
                            <div className="w-full max-w-xs flex flex-col gap-3 mt-4">
                              <div className="flex justify-between w-full px-1"><span className="text-[10px] font-black text-brand-orange/80 uppercase tracking-widest">建議長度</span><span className="text-[10px] font-black text-brand-slate uppercase tracking-widest">3:00</span></div>
                              <div className="w-full h-2 bg-brand-slate/20 rounded-full overflow-hidden border border-white/5 p-[1px]"><div className="h-full bg-gradient-to-r from-brand-orange to-orange-400 transition-all duration-500 rounded-full shadow-[0_0_15px_rgba(255,102,0,0.6)]" style={{ width: `${Math.min(100, (elapsedSeconds / 180) * 100)}%` }}></div></div>
                            </div>
                          </div>
                          {/* Controls */}
                          <div className="flex flex-col items-center justify-center flex-1 gap-6">
                            <div className="flex items-center gap-6">
                              {!isRecording && !recordingData ? (
                                <button onClick={startRecording} className="group relative w-32 h-32 bg-gradient-to-br from-brand-orange to-orange-600 text-white rounded-full flex items-center justify-center shadow-[0_20px_50px_rgba(255,102,0,0.4)] hover:scale-110 transition-all duration-500 active:scale-95"><Mic className="w-14 h-14 drop-shadow-lg" /></button>
                              ) : isRecording ? (
                                <div className="flex gap-6 items-center">
                                  <button onClick={isPaused ? resumeRecording : pauseRecording} className="w-16 h-16 bg-brand-slate/20 text-white rounded-full flex items-center justify-center hover:scale-110 transition-all border-2 border-brand-slate/30">{isPaused ? <Play className="w-6 h-6 ml-1" /> : <Pause className="w-6 h-6" />}</button>
                                  <button onClick={stopRecording} className="recording-pulse w-24 h-24 bg-red-500 text-white rounded-full flex items-center justify-center shadow-[0_20px_50px_rgba(239,68,68,0.4)] hover:scale-110 transition-all border-4 border-white/10"><Square className="w-8 h-8" /></button>
                                </div>
                              ) : (
                                <button onClick={resetRecording} className="group flex flex-col items-center gap-3"><div className="p-6 bg-brand-slate/10 text-brand-slate rounded-[2rem] hover:bg-brand-slate/20 transition-all border-2 border-brand-slate/20 shadow-2xl active:scale-95"><RotateCcw className="w-6 h-6 group-hover:rotate-180 transition-all duration-700" /></div><span className="text-[10px] font-black text-brand-slate/40 uppercase tracking-widest">重新錄製</span></button>
                              )}
                            </div>
                            {warningMsg && <div className="px-6 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl animate-pulse"><p className="text-[10px] font-black text-amber-500 text-center tracking-widest uppercase">{warningMsg}</p></div>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {isProcessing && (
                      <div className="w-full flex flex-col items-center justify-center py-12 space-y-6 animate-fade-in z-20">
                        <Loader2 className="w-20 h-20 text-brand-orange animate-spin" />
                        <span className="text-sm font-black text-brand-orange tracking-[0.3em] uppercase animate-bounce">{processingStatus || '處理中...'}</span>
                      </div>
                    )}

                    {/* Results */}
                    <div className="w-full mt-6 space-y-6">
                      {recordingData?.blob && !isRecording && !isProcessing && (
                        <div className="w-full space-y-4 animate-fade-in z-10">
                          <div className="bg-brand-dark/50 p-6 rounded-2xl space-y-6 border border-brand-slate/20 backdrop-blur-xl">
                            <audio src={recordingData.url} controls className="w-full h-10 filter invert contrast-75 opacity-90" onPlay={() => setHasPlayed(true)} />
                            {(!recordingData.transcript || recordingData.transcript === DEFAULT_TRANSCRIPT_PLACEHOLDER || isAnalyzing) && (
                              <button onClick={handleAnalyze} disabled={!aiEnabled || !GLOBAL_TRANSCRIPT_ENABLED || !canAnalyze || isAnalyzing || !isOnline || !hasPlayed} className={`w-full py-4 rounded-xl font-black flex items-center justify-center gap-3 shadow-xl transition-all text-base ${!aiEnabled || !GLOBAL_TRANSCRIPT_ENABLED || !canAnalyze || isAnalyzing || !isOnline || !hasPlayed ? 'bg-brand-slate/10 text-brand-slate cursor-not-allowed' : 'bg-[#1D2D44] text-white hover:bg-[#2A3F5F] active:scale-[0.98]'}`}>
                                {isAnalyzing ? <><Loader2 className="w-6 h-6 animate-spin" /> 正在產出逐字稿...</> : !hasPlayed ? <><Play className="w-6 h-6 text-brand-orange" /> 請先播放確認錄音內容</> : <><Sparkles className="w-6 h-6 text-brand-orange" /> 點我產出逐字稿</>}
                              </button>
                            )}
                            <div className="bg-brand-dark/30 p-6 rounded-2xl space-y-4 border border-brand-slate/10">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3"><div className="bg-brand-orange/20 p-2 rounded-lg"><FileText className="w-6 h-6 text-brand-orange" /></div><h3 className="text-base font-black text-brand-orange uppercase tracking-widest">逐字稿</h3></div>
                                {recordingData.transcript && recordingData.transcript !== DEFAULT_TRANSCRIPT_PLACEHOLDER && !isAnalyzing && <button onClick={handleAnalyze} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-orange/10 hover:bg-brand-orange/20 text-brand-orange rounded-lg text-[10px] font-black transition-all"><RotateCcw className="w-3 h-3" /> 重新辨識</button>}
                              </div>
                              <div className="bg-brand-dark/40 p-5 rounded-xl min-h-[120px] max-h-[300px] overflow-y-auto custom-scrollbar"><p className="text-lg text-white font-medium leading-relaxed whitespace-pre-wrap">{recordingData.transcript || DEFAULT_TRANSCRIPT_PLACEHOLDER}</p></div>
                            </div>
                            <div className="flex flex-col md:flex-row gap-4">
                              <div className="flex-1 bg-amber-500/10 border border-amber-500/20 p-5 rounded-2xl"><p className="text-amber-500 text-sm font-black uppercase tracking-widest flex items-center gap-3"><AlertTriangle className="w-5 h-5" /> 備份提醒</p><p className="text-amber-200/90 text-sm font-bold mt-2">建議下載備份音檔，避免頁面刷新後遺失。</p></div>
                              <div className="bg-brand-slate/10 p-5 rounded-2xl flex items-center justify-center"><button onClick={() => recordingData.blob && downloadFile(recordingData.blob)} className="flex items-center gap-2 px-6 py-3 bg-brand-slate/20 text-white rounded-xl font-black text-sm hover:bg-brand-orange transition-all active:scale-95"><Download className="w-4 h-4" /> 下載音檔</button></div>
                            </div>
                          </div>
                        </div>
                      )}
                      {error && <div className="mt-4 px-6 py-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 animate-fade-in"><AlertTriangle className="w-5 h-5 text-red-500" /><p className="text-sm text-red-400 font-bold">{error}</p></div>}
                    </div>
                  </div>
                  
                  {/* Right: PREP Notes View */}
                  <div className="xl:w-[360px] bg-white p-6 rounded-[2.5rem] shadow-xl border border-brand-slate/10 flex flex-col h-[500px] xl:h-auto max-h-[850px]">
                    <h4 className="font-black text-brand-dark text-xl mb-6 flex items-center gap-3 border-b border-brand-slate/10 pb-4"><FileText className="w-6 h-6 text-brand-orange"/>邊看邊錄，我的筆記</h4>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-5 pr-2">
                      <div className="space-y-2"><span className="inline-block text-[11px] px-3 py-1 rounded-lg bg-brand-orange/15 font-black text-brand-orange tracking-widest uppercase">P — 觀點</span><p className="text-[15px] font-bold text-brand-dark/90 bg-brand-dark/5 p-4 rounded-2xl min-h-[60px] shadow-inner">{prepNotes.p1 || '未填寫'}</p></div>
                      <div className="space-y-2"><span className="inline-block text-[11px] px-3 py-1 rounded-lg bg-blue-500/15 font-black text-blue-500 tracking-widest uppercase">R — 理由</span><p className="text-[15px] font-bold text-brand-dark/90 bg-brand-dark/5 p-4 rounded-2xl min-h-[60px] shadow-inner">{prepNotes.r || '未填寫'}</p></div>
                      <div className="space-y-2"><span className="inline-block text-[11px] px-3 py-1 rounded-lg bg-emerald-500/15 font-black text-emerald-500 tracking-widest uppercase">E — 例子</span><p className="text-[15px] font-bold text-brand-dark/90 bg-brand-dark/5 p-4 rounded-2xl min-h-[60px] shadow-inner">{prepNotes.e || '未填寫'}</p></div>
                      <div className="space-y-2"><span className="inline-block text-[11px] px-3 py-1 rounded-lg bg-purple-500/15 font-black text-purple-500 tracking-widest uppercase">P — 結尾</span><p className="text-[15px] font-bold text-brand-dark/90 bg-brand-dark/5 p-4 rounded-2xl min-h-[60px] shadow-inner">{prepNotes.p2 || '未填寫'}</p></div>
                    </div>
                  </div>
                </div>

                {/* Prompt Preview + ChatPwC */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-brand-slate/10 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="bg-[#E9ECEF] p-2.5 rounded-full"><Info className="w-5 h-5 text-[#495057]" /></div>
                    <div className="flex-1 space-y-4">
                      <div><h4 className="text-lg font-bold text-[#1D2D44]">任務提示</h4><p className="text-[#8E9AAF] text-sm font-medium">完成錄音與逐字稿後，點擊「一鍵複製」並貼入 ChatPwC 進行 AI 互動。</p></div>
                      <ContextPreviewBox
                        title="AI 回饋提示詞"
                        content={PROMPT_L2.replace('{TRANSCRIPT}', recordingData?.transcript || DEFAULT_TRANSCRIPT_PLACEHOLDER)}
                        onCopy={() => copyTextToClipboard(PROMPT_L2.replace('{TRANSCRIPT}', recordingData?.transcript || ''))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer with hidden admin */}
      <footer className="pt-20 pb-10 flex flex-col items-center gap-6 opacity-40">
        <p className="text-xs font-bold text-brand-slate" onClick={() => { const n = adminClickCount + 1; if (n >= 5) { setShowAdminPanel(!showAdminPanel); setAdminClickCount(0); } else { setAdminClickCount(n); setTimeout(() => setAdminClickCount(0), 2000); } }}>© 2026 表達力工作坊</p>
        {showAdminPanel && (
          <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-brand-orange/20 animate-fade-in">
            <div className="flex items-center gap-4 mb-2 border-b border-brand-orange/10 pb-2"><Lock className="w-4 h-4 text-brand-orange" /><span className="text-xs font-black text-brand-dark uppercase tracking-widest">Admin</span></div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-5 rounded-full transition-all relative ${aiEnabled ? 'bg-brand-orange' : 'bg-brand-slate/30'}`} onClick={() => setAiEnabled(!aiEnabled)}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${aiEnabled ? 'left-6' : 'left-1'}`} /></div>
              <span className="text-xs font-bold text-brand-dark">AI 逐字稿: {aiEnabled ? '開啟' : '關閉'}</span>
            </label>
          </div>
        )}
      </footer>

      <MicTestModal isOpen={showMicTestModal} onClose={() => { setShowMicTestModal(false); if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; } }} onConfirm={handleStartOfficialRecording} stream={streamRef.current} isTesting={isTestingMic} testAudioBlob={testAudioBlob} runTest={runMicTest} />
    </div>
  );
}

export default App;
