import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SystemStatus {
  channels: Record<string, any>;
  totals: {
    channels: number;
    total_messages: number;
    connections: number;
  };
}

interface RecentMessage {
  text: string;
  user: string;
  timestamp: string;
  sentiment: number;
}

interface ChannelStats {
  channel: string;
  timestamp: number;
  stats: {
    viewer_count: number;
    raw_velocity: number;
    velocity_zscore: number;
    velocity_relative: number;
    burst_score: number;
    burst_relative: number;
    rule_score: number;
    ml_score: number;
    clip_worthy_score: number;
    sentiment: number;
  };
  ml_status: {
    model_loaded: boolean;
    training_samples: number;
    baseline_samples: number;
    model_status: string;
    last_prediction: number;
    current_baseline_count: number;
    samples_used_for_training: number;
  };
  data_status: {
    total_messages: number;
    emote_window_size: number;
    memory_stats: {
      tracked_users: number;
      tracked_emotes: number;
      total_events: number;
      max_users_limit: number;
    };
  };
}

interface RealTimeData {
  channel: string;
  timestamp: number;
  stats: any;
  recent_messages: RecentMessage[];
  ml_metrics: {
    feature_count: number;
    model_status: string;
  };
  connection_info: {
    connected_clients: number;
  };
}

interface Clip {
  url: string;
  edit_url: string;
  id: string;
  embed_url: string;
  created_at: number;
  title?: string;
  broadcaster_name?: string;
  view_count?: number;
  duration?: number;
  download_url?: string;
}

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const getWebSocketUrl = (channel: string) => {
  const proto = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
  const host = API_BASE_URL.replace(/^https?:\/\//, '');
  return `${proto}://${host}/ws/${channel}`;
};

// 5 game wallpapers as requested by user
const WALLPAPERS = [
  'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1920&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1920&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?q=80&w=1920&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1593305841991-05c297ba4575?q=80&w=1920&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?q=80&w=1920&auto=format&fit=crop',
];

const WALLPAPER_LABELS = ['🎮 Valorant', '⚔️ League of Legends', '🏆 CS2', '🌸 Genshin Impact', '🦅 Apex Legends'];

const THEMES: Record<string, {
  name: string; emoji: string;
  bg: string; headerBg: string; border: string; cardBg: string; subCardBg: string;
  text: string; textStrong: string; textMuted: string; accent: string;
  accentBg: string; accentHover: string; accentText: string; inputBg: string;
  inputText: string; inputBorder: string; activeTabBg: string; chartGrid: string;
  scrollbar: string; gradient: string;
}> = {
  'twitch-dark': {
    name: 'Twitch Dark', emoji: '🟣',
    bg: 'bg-[#0e0e10]', headerBg: 'bg-[#18181b]/95', border: 'border-[#2f2f35]',
    cardBg: 'bg-[#18181b]', subCardBg: 'bg-[#1f1f23]',
    text: 'text-[#efeff1]', textStrong: 'text-white', textMuted: 'text-[#adadb8]',
    accent: '#9146ff', accentBg: 'bg-[#9146ff]', accentHover: 'hover:bg-[#772ce8]',
    accentText: 'text-[#bf94ff]', inputBg: 'bg-[#1f1f23]', inputText: 'text-white',
    inputBorder: 'border-[#3e3e47]', activeTabBg: 'bg-[#9146ff]/20 text-[#bf94ff] border-[#9146ff]/40',
    chartGrid: '#2f2f35', scrollbar: 'scrollbar-thumb-zinc-700',
    gradient: 'from-[#9146ff]/20 via-transparent to-[#ff4081]/10',
  },
  'twitch-light': {
    name: 'Twitch Light', emoji: '☀️',
    bg: 'bg-[#f0f0f5]', headerBg: 'bg-white/95', border: 'border-[#d4d4e0]',
    cardBg: 'bg-white', subCardBg: 'bg-[#f5f5fa]',
    text: 'text-[#1a1a2e]', textStrong: 'text-[#0a0a18]', textMuted: 'text-[#5a5a7a]',
    accent: '#7b2ff7', accentBg: 'bg-[#7b2ff7]', accentHover: 'hover:bg-[#6622d9]',
    accentText: 'text-[#6622d9]', inputBg: 'bg-[#f5f5fa]', inputText: 'text-[#1a1a2e]',
    inputBorder: 'border-[#c0c0d4]', activeTabBg: 'bg-[#7b2ff7]/10 text-[#6622d9] border-[#7b2ff7]/25',
    chartGrid: '#d4d4e0', scrollbar: 'scrollbar-thumb-purple-300',
    gradient: 'from-[#7b2ff7]/10 via-transparent to-[#ff6eb4]/5',
  },
  'cyberpunk': {
    name: 'Cyberpunk', emoji: '⚡',
    bg: 'bg-[#05050d]', headerBg: 'bg-[#080810]/95', border: 'border-[#00ffff]/20',
    cardBg: 'bg-[#08080f]', subCardBg: 'bg-[#0d0d1a]',
    text: 'text-[#e0f8ff]', textStrong: 'text-[#00ffff]', textMuted: 'text-[#7ecddf]',
    accent: '#ff007f', accentBg: 'bg-[#ff007f]', accentHover: 'hover:bg-[#d4006a]',
    accentText: 'text-[#ff5eb5]', inputBg: 'bg-[#0d0d1a]', inputText: 'text-[#e0f8ff]',
    inputBorder: 'border-[#00ffff]/30', activeTabBg: 'bg-[#ff007f]/15 text-[#ff5eb5] border-[#ff007f]/40',
    chartGrid: '#1a1a2e', scrollbar: 'scrollbar-thumb-cyan-700',
    gradient: 'from-[#00ffff]/10 via-transparent to-[#ff007f]/10',
  },
  'slate': {
    name: 'Slate Night', emoji: '🌌',
    bg: 'bg-[#0a1628]', headerBg: 'bg-[#0f1e38]/95', border: 'border-[#2a3f5f]',
    cardBg: 'bg-[#0f1e38]', subCardBg: 'bg-[#152440]',
    text: 'text-[#c8d8f0]', textStrong: 'text-[#e8f0ff]', textMuted: 'text-[#7a9ccc]',
    accent: '#6366f1', accentBg: 'bg-[#6366f1]', accentHover: 'hover:bg-[#4f52d4]',
    accentText: 'text-[#a5b4fc]', inputBg: 'bg-[#152440]', inputText: 'text-[#c8d8f0]',
    inputBorder: 'border-[#2a3f5f]', activeTabBg: 'bg-[#6366f1]/20 text-[#a5b4fc] border-[#6366f1]/40',
    chartGrid: '#2a3f5f', scrollbar: 'scrollbar-thumb-indigo-700',
    gradient: 'from-[#6366f1]/20 via-transparent to-[#06b6d4]/10',
  },
};

const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'landing' | 'live' | 'settings' | 'drafts'>('landing');
  const [activeTheme, setActiveTheme] = useState<keyof typeof THEMES>(
    (localStorage.getItem('clipper-theme') as any) || 'twitch-dark'
  );
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  const [wallpaperIdx, setWallpaperIdx] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [channelStats, setChannelStats] = useState<ChannelStats | null>(null);
  const [realtimeData, setRealtimeData] = useState<RealTimeData | null>(null);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<RecentMessage[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);

  const [settings, setSettings] = useState({
    twitch_username: '',
    twitch_client_id: '',
    twitch_client_secret: '',
    twitch_refresh_token: '',
    twitch_access_token: '',
    clip_threshold: 0.75,
    clip_cooldown: 60,
    clip_delay: 15.0,
  });

  const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [registerMessage, setRegisterMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newChannel, setNewChannel] = useState('');
  const [activeClip, setActiveClip] = useState<Clip | null>(null);
  const [downloadingClipId, setDownloadingClipId] = useState<string | null>(null);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string>('');
  const websocketRef = useRef<WebSocket | null>(null);

  // Auto-dismiss alerts after 4 seconds
  useEffect(() => {
    if (settingsMessage) {
      const t = setTimeout(() => setSettingsMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [settingsMessage]);

  useEffect(() => {
    if (registerMessage) {
      const t = setTimeout(() => setRegisterMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [registerMessage]);

  const fetchChannels = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/channels`);
      setChannels(response.data.channels);
      if (response.data.channels.length > 0 && !selectedChannel) {
        setSelectedChannel(response.data.channels[0]);
      }
    } catch (err) {
      console.error('Error fetching channels:', err);
    }
  }, [selectedChannel]);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/system/status`);
      setSystemStatus(response.data);
    } catch (err) {
      console.error('Error fetching system status:', err);
    }
  }, []);

  const fetchClips = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/clips`);
      setClips(response.data.clips);
    } catch (err) {
      console.error('Error fetching clips:', err);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/settings`);
      setSettings(response.data);
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  }, []);

  const fetchChannelStats = useCallback(async (channel: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/channels/${channel}/stats`);
      const stats: ChannelStats = response.data;
      setChannelStats(stats);
      const timeLabel = new Date(stats.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setHistoricalData(prev => {
        const next = [
          ...prev,
          {
            time: timeLabel,
            viewer_count: stats.stats.viewer_count,
            raw_velocity: parseFloat(stats.stats.raw_velocity.toFixed(3)),
            burst_score: parseFloat(stats.stats.burst_score.toFixed(3)),
            ml_score: parseFloat(((stats.stats.ml_score || 0) * 100).toFixed(3)),
            clip_worthy_score: parseFloat(((stats.stats.clip_worthy_score || 0) * 100).toFixed(3)),
            sentiment: parseFloat(stats.stats.sentiment.toFixed(3)),
            rule_score: parseFloat(((stats.stats.rule_score || 0) * 100).toFixed(3)),
          },
        ];
        return next.slice(-20);
      });
    } catch (err) {
      console.error('Error fetching channel stats:', err);
    }
  }, []);

  const connectWebSocket = useCallback((channel: string) => {
    if (websocketRef.current) {
      websocketRef.current.close();
    }
    const ws = new WebSocket(getWebSocketUrl(channel));
    websocketRef.current = ws;
    ws.onopen = () => { setIsConnected(true); setError(''); };
    ws.onmessage = (event) => {
      const data: RealTimeData = JSON.parse(event.data);
      setRealtimeData(data);
      if (data.recent_messages) setChatMessages(data.recent_messages);
    };
    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);
  }, []);

  const selectTheme = (themeName: keyof typeof THEMES) => {
    setActiveTheme(themeName);
    localStorage.setItem('clipper-theme', themeName);
    setShowThemeMenu(false);
  };

  // Inject Google Fonts + wallpaper carousel + preload images
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Outfit:wght@400;600;800;900&display=swap';
    document.head.appendChild(link);

    // Preload all wallpapers so crossfade is instant
    WALLPAPERS.forEach(url => {
      const img = new Image();
      img.src = url;
    });

    const wallInterval = setInterval(() => {
      setWallpaperIdx(prev => (prev + 1) % WALLPAPERS.length);
    }, 5000);

    return () => {
      clearInterval(wallInterval);
      document.head.removeChild(link);
    };
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchSystemStatus();
    fetchClips();
    fetchSettings();
    const statusInterval = setInterval(fetchSystemStatus, 6000);
    return () => clearInterval(statusInterval);
  }, [fetchChannels, fetchSystemStatus, fetchClips, fetchSettings]);

  useEffect(() => {
    if (selectedChannel) {
      setHistoricalData([]);
      fetchChannelStats(selectedChannel);
      connectWebSocket(selectedChannel);
      const statsInterval = setInterval(() => fetchChannelStats(selectedChannel), 2000);
      return () => {
        clearInterval(statsInterval);
        if (websocketRef.current) websocketRef.current.close();
      };
    }
  }, [selectedChannel, fetchChannelStats, connectWebSocket]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMessage(null);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/settings`, settings);
      if (response.data.success) {
        setSettingsMessage({ type: 'success', text: '✅ Settings saved and applied instantly!' });
      } else {
        setSettingsMessage({ type: 'error', text: `❌ ${response.data.message || 'Failed to update settings'}` });
      }
    } catch (err: any) {
      setSettingsMessage({ type: 'error', text: `❌ ${err.response?.data?.detail || 'An error occurred while saving'}` });
    }
  };

  const handleRegisterChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterMessage(null);
    const cleanedChannel = newChannel.toLowerCase().trim();
    if (!cleanedChannel) {
      setRegisterMessage({ type: 'error', text: '❌ Please enter a valid channel name' });
      return;
    }
    try {
      const response = await axios.post(`${API_BASE_URL}/api/register?channel=${cleanedChannel}`);
      if (response.data.success) {
        setRegisterMessage({ type: 'success', text: `✅ ${response.data.message}` });
        setNewChannel('');
        await fetchChannels();
        setSelectedChannel(cleanedChannel);
      } else {
        setRegisterMessage({ type: 'error', text: `⚠️ ${response.data.message}` });
      }
    } catch (err: any) {
      setRegisterMessage({ type: 'error', text: `❌ ${err.response?.data?.detail || 'Failed to register channel'}` });
    }
  };

  const handleDownloadClip = async (clipId: string) => {
    setDownloadingClipId(clipId);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/clips/${clipId}/download`);
      const downloadUrl = response.data.download_url;
      if (downloadUrl) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', `${clipId}.mp4`);
        link.setAttribute('target', '_blank');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert('⚠️ Could not retrieve direct download link for this clip.');
      }
    } catch (err) {
      alert('❌ Error fetching download link. Make sure your Twitch keys are configured correctly.');
    } finally {
      setDownloadingClipId(null);
    }
  };

  const handleDeleteClip = async (clipId: string) => {
    if (!window.confirm('🗑️ Are you sure you want to delete this highlight clip?')) return;
    setDeletingClipId(clipId);
    try {
      const response = await axios.delete(`${API_BASE_URL}/api/clips/${clipId}`);
      if (response.data.success) await fetchClips();
    } catch (err) {
      alert('❌ Failed to delete clip from catalog.');
    } finally {
      setDeletingClipId(null);
    }
  };

  const handleRefreshDrafts = async () => {
    setIsRefreshing(true);
    await fetchClips();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  // Memoize so these never cause cascading re-renders
  const theme = useMemo(() => THEMES[activeTheme] || THEMES['twitch-dark'], [activeTheme]);
  const accentColor = useMemo(() => theme.accent, [theme]);
  const fontStyle = useMemo(() => ({ fontFamily: "'Plus Jakarta Sans', 'Outfit', sans-serif" }), []);

  const getSentimentDetails = useCallback((sentiment: number) => {
    if (sentiment > 0.05) return { text: '🔥 Hype', color: 'text-emerald-300 bg-emerald-950/50 border border-emerald-800/60' };
    if (sentiment < -0.05) return { text: '😤 Mad', color: 'text-rose-300 bg-rose-950/50 border border-rose-800/60' };
    return { text: '😐 Neutral', color: 'text-slate-300 bg-slate-800/50 border border-slate-700/60' };
  }, []);

  return (
    // transition-colors only — not transition-all (which recalculates every CSS prop on every state change)
    <div className={`min-h-screen ${theme.bg} ${theme.text} antialiased transition-colors duration-200`} style={fontStyle}>

      {/* Global CSS — GPU-accelerated, fast animations */}
      <style>{`
        * { font-family: 'Plus Jakarta Sans', 'Outfit', sans-serif; }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes modalPop {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes spinOnce {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideAlert {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Fast, GPU-composited animations */
        .animate-fadein { animation: fadeSlideIn 0.22s ease-out both; }
        .animate-modal { animation: modalPop 0.18s ease-out both; }
        .animate-spin-once { animation: spinOnce 0.5s ease-out both; }
        .animate-spin-smooth { animation: spinOnce 0.7s linear infinite; }
        .animate-alert { animation: slideAlert 0.2s ease-out both; }
        /* GPU hint for cards that animate on hover */
        .gpu-card { will-change: transform; transform: translateZ(0); }
        /* Specific transitions — avoid transition-all */
        .t-transform { transition: transform 0.18s ease, opacity 0.18s ease; }
        .t-colors { transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 18px; height: 18px;
          border-radius: 50%; background: ${accentColor};
          box-shadow: 0 0 6px ${accentColor}80; cursor: pointer;
          margin-top: -6.5px;
          transition: transform 0.1s ease;
        }
        input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.15); }
        input[type="range"]::-webkit-slider-runnable-track { height: 5px; border-radius: 3px; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${accentColor}50; border-radius: 4px; }
        /* Smooth wallpaper crossfade via opacity only (GPU layer) */
        .wallpaper-slide { will-change: opacity; transform: translateZ(0); }
      `}</style>

      {/* ─── Top Navigation ─── */}
      <header className={`sticky top-0 z-40 ${theme.headerBg} border-b ${theme.border} backdrop-blur-xl shadow-2xl`}>
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => setActiveTab('landing')}>
            <div className="relative p-2.5 rounded-xl shadow-lg group-hover:scale-110 t-transform" style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)` }}>
              <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
              </svg>
            </div>
            <div>
              <span className="text-xl font-black tracking-tight" style={{ color: accentColor }}>
                Twitch Clipper
              </span>
              <div className={`text-[11px] font-semibold ${theme.textMuted} -mt-0.5`}>🤖 AI Highlight Detection</div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 items-center">
            {[
              { id: 'landing', label: '🏠 Home' },
              { id: 'live', label: '📡 Live Monitor' },
              { id: 'settings', label: '🔑 Credentials' },
              { id: 'drafts', label: '🎬 Drafts' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={fontStyle}
                className={`px-4 py-2.5 rounded-xl text-[15px] font-bold t-colors active:scale-95 ${
                  activeTab === tab.id
                    ? `border ${theme.activeTabBg} shadow-md`
                    : `${theme.textMuted} hover:bg-white/5`
                }`}
              >
                {tab.label}
              </button>
            ))}

            {/* Theme Switcher */}
            <div className="relative ml-2">
              <button
                onClick={() => setShowThemeMenu(!showThemeMenu)}
                className={`p-2.5 rounded-xl border ${theme.border} ${theme.textMuted} hover:bg-white/5 t-colors active:scale-95`}
                title="🎨 Change Theme"
              >
                🎨
              </button>
              {showThemeMenu && (
                <div className={`absolute right-0 mt-2.5 w-44 rounded-2xl ${theme.cardBg} border ${theme.border} shadow-2xl p-2 z-50 animate-fadein`}>
                  <p className={`text-[10px] uppercase font-black tracking-wider ${theme.textMuted} px-2.5 pt-1 pb-2`}>🎨 Theme</p>
                  {Object.entries(THEMES).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => selectTheme(key as any)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-[13px] font-semibold t-colors flex items-center space-x-2 ${
                        activeTheme === key
                          ? `${theme.accentText} bg-white/10`
                          : `${theme.text} hover:bg-white/5`
                      }`}
                    >
                      <span className="text-base">{value.emoji}</span>
                      <span className="flex-1">{value.name}</span>
                      {activeTheme === key && <span className="text-[11px] font-black" style={{ color: accentColor }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* ─── Main ─── */}
      <main className="max-w-screen-2xl mx-auto px-6 py-5 xl:px-12">

        {/* ═══════════════════════════════════════════════════ */}
        {/* LANDING PAGE */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === 'landing' && (
          <div className="space-y-5 animate-fadein">

            {/* Hero with wallpaper slideshow */}
            <div className="relative overflow-hidden rounded-2xl border min-h-[340px] flex flex-row items-center justify-between p-8 xl:p-12 gap-8 shadow-xl gpu-card" style={{ borderColor: `${accentColor}30` }}>
              {/* Wallpaper slideshow background */}
              <div className="absolute inset-0 z-0">
                {WALLPAPERS.map((wp, idx) => (
                  <div
                    key={idx}
                    className="absolute inset-0 bg-cover bg-center wallpaper-slide"
                    style={{
                      backgroundImage: `url(${wp})`,
                      opacity: wallpaperIdx === idx ? 1 : 0,
                      transition: 'opacity 1s ease-in-out',
                    }}
                  />
                ))}
                {/* Dark overlay for readability */}
                <div className="absolute inset-0 bg-black/72 backdrop-blur-[2px]" />
                {/* Gradient accent overlay */}
                <div className={`absolute inset-0 bg-gradient-to-br ${theme.gradient} opacity-60`} />
              </div>

              {/* Wallpaper indicator dots */}
              <div className="absolute bottom-4 right-6 z-10 flex items-center space-x-2">
                <span className="text-white/50 text-[11px] font-semibold mr-1">{WALLPAPER_LABELS[wallpaperIdx]}</span>
                {WALLPAPERS.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setWallpaperIdx(idx)}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${wallpaperIdx === idx ? 'bg-white scale-125' : 'bg-white/35'}`}
                  />
                ))}
              </div>

              {/* Hero Content */}
              <div className="relative z-10 max-w-lg space-y-7">
                <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full text-[12px] font-black uppercase tracking-wider" style={{ background: `${accentColor}30`, border: `1px solid ${accentColor}50`, color: '#fff' }}>
                  <span className="w-2.5 h-2.5 rounded-full animate-ping" style={{ background: accentColor }} />
                  <span>🤖 Your Smart Stream Buddy</span>
                </div>

                <h1 className="text-5xl md:text-6xl font-black text-white leading-none tracking-tight" style={{ fontFamily: "'Outfit', sans-serif", textShadow: `0 0 40px ${accentColor}60` }}>
                  Twitch<br /><span style={{ color: accentColor }}>Clipper</span> ✂️
                </h1>

                <p className="text-white/90 text-lg leading-relaxed font-medium">
                  🎮 <strong>Think of it like a super smart friend</strong> watching your Twitch stream! When the chat goes crazy with emojis like <strong>PogChamp 😱 LUL 😂 OMEGALUL 💀</strong> — our AI brain automatically clips that exact epic moment. <strong>You never miss a highlight again!</strong>
                </p>

                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={() => setActiveTab('live')}
                    className="px-8 py-3.5 rounded-2xl text-white font-black text-[15px] flex items-center space-x-2.5 shadow-xl t-transform hover:-translate-y-0.5 active:scale-95 gpu-card"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)`, boxShadow: `0 6px 20px ${accentColor}45` }}
                  >
                    <span>📡 Launch Monitor</span>
                    <span>→</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`px-8 py-3.5 rounded-2xl ${theme.text} font-bold text-[15px] border border-white/20 bg-white/10 backdrop-blur-sm hover:bg-white/20 t-colors`}
                  >
                    🔑 Setup Keys
                  </button>
                </div>
              </div>

              {/* Status Card */}
              <div className="relative z-10 flex-shrink-0 w-full md:w-80 bg-black/50 border border-white/15 rounded-2xl p-6 backdrop-blur-sm shadow-2xl space-y-4">
                <p className="text-white/70 text-[12px] font-black uppercase tracking-wider">📊 System Status</p>
                <div className="space-y-3">
                  {[
                    { label: '🎯 Channels Watched', value: systemStatus?.totals?.channels || 0, color: '#bf94ff' },
                    { label: '💬 Messages Analyzed', value: (systemStatus?.totals?.total_messages || 0).toLocaleString(), color: '#ff80b0' },
                    { label: '🎬 Clips Saved', value: clips.length, color: '#34d399' },
                    { label: '🔌 Live Connections', value: systemStatus?.totals?.connections || 0, color: '#60a5fa' },
                  ].map((item, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-white/60 text-[13px] font-semibold">{item.label}</span>
                      <span className="text-xl font-black" style={{ color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-white/10">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-emerald-300 text-[13px] font-bold">🟢 API Connected</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature Cards + How It Works side by side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* Features */}
              <div className="grid grid-cols-3 gap-4">
              {[
                {
                  emoji: '🧠',
                  title: 'Smart AI Brain',
                  desc: 'An AI model learns YOUR channel\'s normal chat patterns. When chat suddenly goes 10x more active than usual — it knows something amazing just happened!',
                  glow: '#9146ff',
                },
                {
                  emoji: '🔥',
                  title: 'Emoji Spike Detection',
                  desc: 'Detects explosions of emotes like PogChamp, OMEGALUL, W, PepeJam, GG. These emoji storms pinpoint the exact hype moment so clips are always perfectly timed.',
                  glow: '#ff4081',
                },
                {
                  emoji: '🎬',
                  title: 'Instant Draft Library',
                  desc: 'Every detected highlight gets saved to your Drafts gallery automatically. Watch them in-browser, download as MP4, or delete the ones you don\'t need.',
                  glow: '#6366f1',
                },
              ].map((card, i) => (
                <div
                  key={i}
                  className={`${theme.cardBg} border ${theme.border} rounded-xl p-4 hover:-translate-y-0.5 t-transform gpu-card`}
                >
                  <div className="text-3xl mb-2">{card.emoji}</div>
                  <h3 className={`text-[15px] font-black ${theme.textStrong} mb-1.5`}>{card.title}</h3>
                  <p className={`${theme.textMuted} text-[13px] leading-relaxed`}>{card.desc}</p>
                </div>
              ))}
              </div>

              {/* How It Works — 4 steps stacked */}
              <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-5`}>
                <h3 className={`text-[16px] font-black ${theme.textStrong} mb-4 flex items-center space-x-2`}>
                  <span>⚙️</span><span>How It Works</span>
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { step: '1️⃣', title: 'Add Channel', desc: 'Type your Twitch channel name in Live Monitor.' },
                    { step: '2️⃣', title: 'AI Learns', desc: 'AI studies normal chat speed for ~2 minutes.' },
                    { step: '3️⃣', title: 'Hype Detected', desc: 'Chat goes wild → AI triggers a clip.' },
                    { step: '4️⃣', title: 'Clip Saved', desc: 'Highlight lands in Drafts. Play or download!' },
                  ].map((s, i) => (
                    <div key={i} className={`${theme.subCardBg} rounded-xl p-3.5 border ${theme.border}`}>
                      <div className="text-xl mb-1">{s.step}</div>
                      <h4 className={`font-black text-[13px] ${theme.textStrong} mb-1`}>{s.title}</h4>
                      <p className={`${theme.textMuted} text-[12px] leading-relaxed`}>{s.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* LIVE MONITOR TAB */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === 'live' && (
          <div className="space-y-4 animate-fadein">
            {/* Control Board */}
            <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-4`}>
              <div className="flex flex-row items-end justify-between gap-4 flex-wrap">
                <div className="flex flex-row gap-4 items-end flex-wrap">
                  {/* Channel Selector */}
                  <div>
                    <label className={`${theme.textMuted} block text-[12px] uppercase tracking-wider font-black mb-2`}>📺 Watching Channel</label>
                    <select
                      value={selectedChannel}
                      onChange={e => setSelectedChannel(e.target.value)}
                      className={`${theme.inputBg} ${theme.inputText} border ${theme.inputBorder} focus:border-[${accentColor}] px-5 py-3 rounded-xl text-[15px] font-semibold focus:outline-none focus:ring-2 w-52 cursor-pointer transition-all`}
                      style={{ accentColor }}
                    >
                      {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                      {channels.length === 0 && <option value="">⚠️ No Channels Yet</option>}
                    </select>
                  </div>

                  {/* Connection status */}
                  <div className="flex items-center space-x-4">
                    <div className={`flex items-center space-x-2.5 px-4 py-2.5 rounded-full text-[13px] font-bold ${
                      isConnected
                        ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/60'
                        : 'bg-rose-950/50 text-rose-300 border border-rose-800/60'
                    }`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                      <span>{isConnected ? '🟢 Live Connected' : '🔴 Disconnected'}</span>
                    </div>
                    <div className={`${theme.textMuted} text-[14px] font-semibold`}>
                      👁️ <span className={`${theme.textStrong} font-black`}>{channelStats?.stats?.viewer_count?.toLocaleString() || '—'}</span> viewers
                    </div>
                  </div>
                </div>

                {/* Add Channel Form */}
                <form onSubmit={handleRegisterChannel} className="flex items-end space-x-3">
                  <div>
                    <label className={`${theme.textMuted} block text-[12px] uppercase tracking-wider font-black mb-2`}>➕ Add New Channel</label>
                    <input
                      type="text"
                      placeholder="channelname"
                      value={newChannel}
                      onChange={e => setNewChannel(e.target.value)}
                      className={`${theme.inputBg} ${theme.inputText} border ${theme.inputBorder} px-5 py-3 rounded-xl text-[15px] font-semibold focus:outline-none focus:ring-2 w-52 placeholder-opacity-40 transition-all`}
                      style={{ '--tw-ring-color': `${accentColor}60` } as any}
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-xl text-white font-black text-[14px] flex items-center space-x-2 shadow-lg t-transform hover:scale-105 active:scale-95 gpu-card"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)` }}
                  >
                    <span>➕</span><span>Join</span>
                  </button>
                </form>
              </div>

              {/* Register alert */}
              {registerMessage && (
                <div className={`mt-4 p-4 rounded-xl flex items-center space-x-3 border animate-alert text-[14px] font-semibold ${
                  registerMessage.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-800 text-rose-200'
                }`}>
                  <span className="text-xl">{registerMessage.type === 'success' ? '✅' : '❌'}</span>
                  <span>{registerMessage.text}</span>
                </div>
              )}
            </div>

            {selectedChannel ? (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* Left: Chart + Score Cards — 3 of 5 cols */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Chart */}
                  <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-5`}>
                    <div className="flex justify-between items-center mb-4">
                      <h3 className={`text-[15px] font-black ${theme.textStrong} flex items-center space-x-2`}>
                        <span>📈</span><span>Live Chat Metrics</span>
                      </h3>
                      <span className={`${theme.textMuted} text-[11px] font-semibold`}>🔄 Updates every 2s</span>
                    </div>
                    <div className="h-56 w-full">
                      {historicalData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={historicalData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
                            <XAxis dataKey="time" stroke={theme.textMuted.replace('text-', '')} tick={{ fontSize: 11, fill: '#888' }} />
                            <YAxis stroke={theme.textMuted.replace('text-', '')} tick={{ fontSize: 11, fill: '#888' }} />
                            <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', color: '#fff', borderRadius: 12, fontSize: 13 }} />
                            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                            <Line type="monotone" dataKey="raw_velocity" name="💬 Chat Speed" stroke="#bf94ff" strokeWidth={2.5} dot={false} />
                            <Line type="monotone" dataKey="burst_score" name="🔥 Emote Burst" stroke="#ff80b0" strokeWidth={2.5} dot={false} />
                            <Line type="monotone" dataKey="clip_worthy_score" name="⭐ Clip Score (%)" stroke="#fbbf24" strokeWidth={3} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className={`h-full flex flex-col items-center justify-center ${theme.textMuted} text-[15px] space-y-2`}>
                          <span className="text-4xl">📊</span>
                          <p className="font-semibold">Collecting data... chat on Twitch to start seeing metrics!</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Score Cards — horizontal row */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: '💬 Chat Speed', value: (channelStats?.stats?.raw_velocity || 0).toFixed(3), unit: 'msg/sec', color: '#bf94ff' },
                      { label: '🔥 Emote Burst', value: (channelStats?.stats?.burst_score || 0).toFixed(3), unit: 'spike score', color: '#ff80b0' },
                      { label: '😊 Vibe', value: getSentimentDetails(channelStats?.stats?.sentiment || 0).text, unit: `${(channelStats?.stats?.sentiment || 0).toFixed(3)}`, color: '#34d399' },
                    ].map((card, i) => (
                      <div key={i} className={`${theme.cardBg} border ${theme.border} rounded-xl p-3.5`}>
                        <p className={`${theme.textMuted} text-[11px] uppercase tracking-wider font-black`}>{card.label}</p>
                        <p className="text-xl font-black mt-1" style={{ color: card.color }}>{card.value}</p>
                        <p className={`${theme.textMuted} text-[11px] font-semibold mt-0.5`}>{card.unit}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Gauge + Chat — 2 of 5 cols */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Clip Worthiness Gauge */}
                  <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-4 flex flex-col items-center`}>
                    <h3 className={`text-[12px] font-black ${theme.textStrong} uppercase tracking-wider self-start mb-3`}>⭐ Clip Score</h3>

                    <div className="relative w-32 h-32 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        {/* Background track — uses inline style so theme.chartGrid value is applied correctly */}
                        <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="9" fill="transparent"
                          style={{ color: theme.chartGrid }}
                        />
                        {/* Filled arc — accent color with glow */}
                        <circle cx="50" cy="50" r="42" strokeWidth="9" fill="transparent"
                          stroke={accentColor}
                          strokeDasharray="263.89"
                          strokeDashoffset={263.89 - (263.89 * (channelStats?.stats?.clip_worthy_score || 0))}
                          strokeLinecap="round"
                          className="transition-all duration-700 ease-out"
                          style={{ filter: `drop-shadow(0 0 5px ${accentColor}90)` }}
                        />
                      </svg>
                      {/* Inner text — centered absolutely over the SVG */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-black leading-none" style={{ color: accentColor }}>
                          {((channelStats?.stats?.clip_worthy_score || 0) * 100).toFixed(1)}%
                        </span>
                        <span className={`${theme.textMuted} text-[9px] font-bold uppercase tracking-wider mt-1`}>
                          score
                        </span>
                      </div>
                    </div>

                    <div className="w-full space-y-2 mt-4 text-[12px]">
                      <div className="flex justify-between">
                        <span className={theme.textMuted}>📐 Rule:</span>
                        <span className="font-black" style={{ color: accentColor }}>{((channelStats?.stats?.rule_score || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={theme.textMuted}>🤖 AI:</span>
                        <span className="font-black text-yellow-400">{((channelStats?.stats?.ml_score || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className={`border-t ${theme.border} pt-2 flex justify-between font-black`}>
                        <span className={theme.textMuted}>🎯 Threshold:</span>
                        <span style={{ color: accentColor }}>{(settings.clip_threshold * 100).toFixed(0)}%</span>
                      </div>
                    </div>

                    {(channelStats?.stats?.clip_worthy_score || 0) >= settings.clip_threshold ? (
                      <div className="w-full mt-3 py-2.5 rounded-xl text-center font-black text-white text-[13px] animate-pulse"
                        style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)` }}>
                        🔥 CLIPPING NOW!
                      </div>
                    ) : (
                      <div className={`w-full mt-3 py-2.5 rounded-xl text-center ${theme.textMuted} text-[12px] font-semibold border ${theme.border}`}>
                        👂 Listening...
                      </div>
                    )}
                  </div>


                  {/* Live Chat Buffer */}
                  <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-4 flex flex-col`} style={{ height: 'calc(100vh - 420px)', minHeight: '260px' }}>
                    <h3 className={`text-[14px] font-black ${theme.textStrong} mb-4 flex items-center space-x-2`}>
                      <span className="w-2.5 h-2.5 rounded-full animate-ping" style={{ background: accentColor }} />
                      <span>💬 Live Chat</span>
                    </h3>
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                      {chatMessages.length > 0 ? chatMessages.map((msg, idx) => (
                        <div key={idx} className={`${theme.subCardBg} p-3 rounded-xl border ${theme.border} text-[13px]`}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-black" style={{ color: accentColor }}>{msg.user}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${getSentimentDetails(msg.sentiment).color}`}>
                              {getSentimentDetails(msg.sentiment).text}
                            </span>
                          </div>
                          <p className={`${theme.text} break-words leading-relaxed`}>{msg.text}</p>
                        </div>
                      )) : (
                        <div className={`h-full flex flex-col items-center justify-center ${theme.textMuted} text-center text-[14px] space-y-2`}>
                          <span className="text-4xl">💬</span>
                          <p className="font-semibold">Waiting for chat messages on <strong>"{selectedChannel}"</strong>...</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${theme.cardBg} border ${theme.border} rounded-2xl p-16 text-center space-y-4`}>
                <span className="text-6xl">📺</span>
                <p className={`text-xl font-black ${theme.textStrong}`}>No Channel Selected</p>
                <p className={`${theme.textMuted} text-[15px] max-w-sm mx-auto`}>Add a Twitch channel above to start monitoring live chat and detecting highlight moments.</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* CREDENTIALS / SETTINGS TAB */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-fadein">

            {/* Settings Form — 2 of 3 cols */}
            <div className="xl:col-span-2 space-y-5">
              <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-6`}>
                <h2 className={`text-xl font-black ${theme.textStrong} mb-1`}>🔑 Twitch Credentials</h2>
                <p className={`${theme.textMuted} text-[14px] mb-5`}>Configure your keys to enable AI clipping. Saved to your <code className="text-[12px] bg-black/20 px-1.5 py-0.5 rounded-md">.env</code> file.</p>

                <form onSubmit={handleSaveSettings} className="space-y-5">
                  {/* Threshold Slider */}
                  <div className={`${theme.subCardBg} p-4 rounded-xl border ${theme.border} space-y-3`}>
                    <div className="flex justify-between items-center">
                      <div>
                        <label className={`text-[15px] font-black ${theme.textStrong}`}>🎯 Clip Sensitivity</label>
                        <p className={`${theme.textMuted} text-[12px] mt-0.5`}>Higher = clips only the most extreme hype moments</p>
                      </div>
                      <span className="text-2xl font-black" style={{ color: accentColor }}>{(settings.clip_threshold * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range" min="0.10" max="0.95" step="0.05"
                      value={settings.clip_threshold}
                      onChange={e => setSettings({ ...settings, clip_threshold: parseFloat(e.target.value) })}
                      className="w-full h-2 rounded-full cursor-pointer"
                      style={{ accentColor }}
                    />
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className={theme.textMuted}>🔓 10% — Everything</span>
                      <span style={{ color: accentColor }}>✨ 75% — Best</span>
                      <span className={theme.textMuted}>🔒 95% — Rare</span>
                    </div>
                  </div>

                  {/* Credential Inputs — 2 cols always */}
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: '🆔 Client ID', key: 'twitch_client_id', type: 'text' },
                      { label: '🤫 Client Secret', key: 'twitch_client_secret', type: 'password' },
                      { label: '🎫 Access Token', key: 'twitch_access_token', type: 'text' },
                      { label: '🔄 Refresh Token', key: 'twitch_refresh_token', type: 'text' },
                    ].map(field => (
                      <div key={field.key}>
                        <label className={`block ${theme.textMuted} text-[11px] font-black uppercase tracking-wider mb-1.5`}>{field.label}</label>
                        <input
                          type={field.type} required
                          value={(settings as any)[field.key]}
                          onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                          className={`w-full ${theme.inputBg} ${theme.inputText} border ${theme.inputBorder} px-3 py-2.5 rounded-lg text-[14px] font-medium focus:outline-none focus:ring-2 transition-all`}
                          style={{ '--tw-ring-color': `${accentColor}50` } as any}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: '🤖 Bot Username', key: 'twitch_username', type: 'text' },
                      { label: '⏱️ Cooldown (sec)', key: 'clip_cooldown', type: 'number' },
                      { label: '⏰ Delay (sec)', key: 'clip_delay', type: 'number' },
                    ].map(field => (
                      <div key={field.key}>
                        <label className={`block ${theme.textMuted} text-[11px] font-black uppercase tracking-wider mb-1.5`}>{field.label}</label>
                        <input
                          type={field.type} required
                          value={(settings as any)[field.key]}
                          onChange={e => setSettings({
                            ...settings,
                            [field.key]: field.type === 'number'
                              ? (field.key === 'clip_delay' ? parseFloat(e.target.value) : parseInt(e.target.value))
                              : e.target.value
                          })}
                          className={`w-full ${theme.inputBg} ${theme.inputText} border ${theme.inputBorder} px-3 py-2.5 rounded-lg text-[14px] font-medium focus:outline-none focus:ring-2 transition-all`}
                          style={{ '--tw-ring-color': `${accentColor}50` } as any}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: `${accentColor}20` }}>
                    <button
                      type="submit"
                      className="px-7 py-3 rounded-xl text-white font-black text-[15px] shadow-lg t-transform hover:scale-105 active:scale-95 gpu-card"
                      style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)`, boxShadow: `0 6px 25px ${accentColor}40` }}
                    >
                      💾 Save Configuration
                    </button>
                    <span className={`${theme.textMuted} text-[12px] font-semibold`}>Writes to .env file instantly</span>
                  </div>
                </form>

                {/* Settings feedback — auto-dismissing */}
                {settingsMessage && (
                  <div className={`mt-5 p-4 rounded-xl flex items-center space-x-3 border animate-alert text-[15px] font-semibold ${
                    settingsMessage.type === 'success'
                      ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                      : 'bg-rose-950/50 border-rose-800 text-rose-200'
                  }`}>
                    <span className="text-2xl">{settingsMessage.type === 'success' ? '✅' : '❌'}</span>
                    <span>{settingsMessage.text}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Setup Guide — 1 of 3 cols */}
            <div className="xl:col-span-1 space-y-4">
              <div className={`${theme.cardBg} border ${theme.border} rounded-xl p-5 space-y-4`}>
                <h3 className={`text-[16px] font-black ${theme.textStrong} flex items-center space-x-2`}>
                  <span>📖</span><span>How to Get Keys</span>
                </h3>
                <p className={`${theme.textMuted} text-[14px]`}>Don't worry — it's free and takes about 5 minutes! Follow these steps:</p>

                <div className="space-y-5">
                  {[
                    {
                      step: '1️⃣',
                      title: 'Create a Twitch Developer Account',
                      desc: 'Go to',
                      link: { text: 'dev.twitch.tv', url: 'https://dev.twitch.tv/console' },
                      extra: 'and log in with your Twitch account. Click "Register Your Application".',
                    },
                    {
                      step: '2️⃣',
                      title: 'Register a New Application',
                      desc: 'Name it anything (e.g. "My Clipper"). Set the Redirect URI to',
                      code: 'https://twitchtokengenerator.com/',
                      extra: 'Set Category to "Application Integration". Click "Create".',
                    },
                    {
                      step: '3️⃣',
                      title: 'Copy Your Client ID & Secret',
                      desc: 'After creating the app, click "Manage". Copy the',
                      bold: 'Client ID',
                      extra: 'then click "New Secret" to generate and copy your Client Secret.',
                    },
                    {
                      step: '4️⃣',
                      title: 'Generate Access & Refresh Tokens',
                      desc: 'Visit',
                      link: { text: 'Twitch Token Generator', url: 'https://twitchtokengenerator.com/' },
                      extra: 'Enter your Client ID & Secret. Request scopes: clips:edit and user:read:chat. Copy the Access Token and Refresh Token shown.',
                    },
                    {
                      step: '5️⃣',
                      title: 'Paste Everything Above',
                      desc: 'Fill in all 5 fields in the form and click',
                      bold: '💾 Save Configuration',
                      extra: 'The bot will immediately start using your new credentials!',
                    },
                  ].map((s, i) => (
                    <div key={i} className={`${theme.subCardBg} p-5 rounded-xl border ${theme.border} space-y-2`}>
                      <div className="flex items-start space-x-3">
                        <span className="text-2xl flex-shrink-0 mt-0.5">{s.step}</span>
                        <div>
                          <p className={`font-black text-[15px] ${theme.textStrong}`}>{s.title}</p>
                          <p className={`${theme.textMuted} text-[13px] leading-relaxed mt-1`}>
                            {s.desc}{' '}
                            {s.link && <a href={s.link.url} target="_blank" rel="noreferrer" className="font-bold underline" style={{ color: accentColor }}>{s.link.text}</a>}
                            {s.code && <code className={`text-[12px] px-2 py-0.5 rounded-lg mx-1 ${theme.subCardBg} border ${theme.border} ${theme.text}`}>{s.code}</code>}
                            {s.bold && <strong className={theme.textStrong}>{s.bold}</strong>}
                            {s.extra && ` ${s.extra}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Token refresh note */}
                <div className="p-4 rounded-xl border" style={{ background: `${accentColor}12`, borderColor: `${accentColor}30` }}>
                  <p className="font-black text-[14px] mb-1" style={{ color: accentColor }}>🔄 Auto Token Refresh</p>
                  <p className={`${theme.textMuted} text-[13px] leading-relaxed`}>
                    Twitch tokens expire every few hours. Don't worry — Twitch Clipper automatically refreshes them using your Refresh Token. You only need to set up once! 🎉
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* DRAFTS / VIDEO GALLERY TAB */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === 'drafts' && (
          <div className="space-y-4 animate-fadein">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className={`text-2xl font-black ${theme.textStrong}`}>🎬 Highlight Drafts</h2>
                <p className={`${theme.textMuted} text-[14px] mt-0.5`}>{clips.length} clip{clips.length !== 1 ? 's' : ''} saved — play, download or delete</p>
              </div>

              {/* Refresh Button — clean circular arrow */}
              <button
                onClick={handleRefreshDrafts}
                title="Refresh"
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl border ${theme.border} ${theme.cardBg} ${theme.textMuted} t-colors hover:scale-105 active:scale-95`}
                style={isRefreshing ? { borderColor: accentColor, color: accentColor } : {}}
              >
                <svg
                  className={`w-5 h-5 ${isRefreshing ? 'animate-spin-smooth' : ''}`}
                  style={{ color: isRefreshing ? accentColor : undefined }}
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
                </svg>
                <span className="text-[13px] font-semibold">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>

            {/* Clips Grid — 4 cols on xl */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {clips.map((clip, idx) => (
                <div
                  key={clip.id}
                  className={`${theme.cardBg} border ${theme.border} rounded-xl overflow-hidden hover:-translate-y-0.5 t-transform gpu-card flex flex-col`}
                >
                  {/* Thumbnail / Play area */}
                  <div
                    className="aspect-video relative group cursor-pointer overflow-hidden"
                    style={{ background: `linear-gradient(135deg, #1a0533, #0a0015)` }}
                    onClick={() => setActiveClip(clip)}
                  >
                    {/* Subtle gradient background */}
                    <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at center, ${accentColor}40, transparent)` }} />

                    {/* Play button */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 group-hover:scale-125 group-hover:shadow-purple-500/50"
                        style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)` }}
                      >
                        <svg className="w-6 h-6 fill-white translate-x-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      </div>
                      <span className={`text-[13px] font-bold text-white/70 group-hover:text-white transition-colors`}>▶ Click to Preview</span>
                    </div>

                    {/* Clip number badge */}
                    <div className="absolute top-3 left-3 px-3 py-1 rounded-full text-[11px] font-black text-white" style={{ background: `${accentColor}cc` }}>
                      🎬 Clip #{clips.length - idx}
                    </div>
                  </div>

                  {/* Card Info */}
                  <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className={`font-black text-[16px] ${theme.textStrong}`}>🏆 Highlight Clip #{clips.length - idx}</h4>
                      <p className={`${theme.textMuted} text-[12px] mt-1 truncate`}>
                        🔗 <a href={clip.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: accentColor }}>{clip.url}</a>
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2 pt-3 border-t" style={{ borderColor: `${accentColor}15` }}>
                      {/* Play */}
                      <button
                        onClick={() => setActiveClip(clip)}
                        className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-black flex items-center justify-center space-x-1.5 transition-all duration-200 active:scale-95 hover:scale-105"
                        style={{ background: `${accentColor}25`, color: accentColor, border: `1px solid ${accentColor}40` }}
                      >
                        <span>▶️</span><span>Play</span>
                      </button>

                      {/* Download */}
                      <button
                        disabled={downloadingClipId === clip.id}
                        onClick={() => handleDownloadClip(clip.id)}
                        className={`px-3 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center space-x-1 border transition-all duration-200 active:scale-95 hover:scale-105 ${
                          downloadingClipId === clip.id ? 'opacity-50 cursor-not-allowed' : ''
                        } ${theme.subCardBg} ${theme.textMuted} border-${theme.border}`}
                      >
                        {downloadingClipId === clip.id
                          ? <svg className="w-4 h-4 animate-spin-smooth" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" /></svg>
                          : <span>💾</span>
                        }
                        <span>Save</span>
                      </button>

                      {/* Delete */}
                      <button
                        disabled={deletingClipId === clip.id}
                        onClick={() => handleDeleteClip(clip.id)}
                        className={`px-3 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center transition-all duration-200 active:scale-95 hover:scale-105 bg-rose-950/30 text-rose-400 border border-rose-900/40 hover:bg-rose-900/60 hover:text-white ${
                          deletingClipId === clip.id ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        title="🗑️ Delete"
                      >
                        {deletingClipId === clip.id
                          ? <svg className="w-4 h-4 animate-spin-smooth" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" /></svg>
                          : <span>🗑️</span>
                        }
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {clips.length === 0 && (
                <div className={`col-span-full ${theme.cardBg} border ${theme.border} rounded-2xl p-16 text-center space-y-4`}>
                  <span className="text-7xl block">🎬</span>
                  <p className={`text-2xl font-black ${theme.textStrong}`}>No Clips Yet!</p>
                  <p className={`${theme.textMuted} text-[15px] max-w-xs mx-auto leading-relaxed`}>
                    Highlights will appear here automatically when chat goes crazy and the AI detects a peak moment. Start monitoring a channel to begin! 🚀
                  </p>
                  <button
                    onClick={() => setActiveTab('live')}
                    className="mt-4 px-8 py-3.5 rounded-2xl text-white font-black text-[15px] shadow-xl inline-flex items-center space-x-2 transition-all duration-300 hover:scale-105"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, #ff4081)` }}
                  >
                    <span>📡</span><span>Go to Live Monitor</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* ─── Video Playback Modal ─── */}
      {activeClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadein" onClick={e => { if (e.target === e.currentTarget) setActiveClip(null); }}>
          <div className="bg-[#0e0e10] border border-[#3f3f46] rounded-2xl overflow-hidden shadow-2xl max-w-3xl w-full flex flex-col animate-modal">
            {/* Modal Header */}
            <div className="px-6 py-4 flex justify-between items-center border-b border-[#2f2f35]" style={{ background: `linear-gradient(90deg, ${accentColor}15, transparent)` }}>
              <div className="flex items-center space-x-3">
                <span className="w-3 h-3 rounded-full animate-ping" style={{ background: accentColor }} />
                <h4 className="font-black text-white text-[16px]">🎬 Highlight Player — Clip #{clips.findIndex(c => c.id === activeClip.id) !== -1 ? clips.length - clips.findIndex(c => c.id === activeClip.id) : '?'}</h4>
              </div>
              <button onClick={() => setActiveClip(null)} className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* IFrame Player */}
            <div className="aspect-video bg-black relative">
              <iframe
                src={`${activeClip.embed_url}&parent=${window.location.hostname}`}
                className="absolute inset-0 w-full h-full border-0"
                allowFullScreen={true}
                scrolling="no"
                title={`Highlight-${activeClip.id}`}
              />
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 flex justify-between items-center border-t border-[#2f2f35] bg-[#111113]">
              <div className="flex space-x-2">
                <a href={activeClip.url} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl text-[13px] font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors">🔗 Twitch Page</a>
                {activeClip.edit_url && (
                  <a href={activeClip.edit_url} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl text-[13px] font-bold border transition-colors" style={{ background: `${accentColor}25`, color: accentColor, borderColor: `${accentColor}40` }}>✂️ Edit Clip</a>
                )}
              </div>
              <div className="flex space-x-2">
                <button
                  disabled={downloadingClipId === activeClip.id}
                  onClick={() => handleDownloadClip(activeClip.id)}
                  className="px-4 py-2 rounded-xl text-[13px] font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center space-x-1.5 transition-colors"
                >
                  <span>💾</span><span>Download MP4</span>
                </button>
                <button
                  disabled={deletingClipId === activeClip.id}
                  onClick={() => { handleDeleteClip(activeClip.id); setActiveClip(null); }}
                  className="px-4 py-2 rounded-xl text-[13px] font-bold bg-rose-950/40 hover:bg-rose-800 text-rose-300 hover:text-white border border-rose-900/50 flex items-center space-x-1.5 transition-colors"
                >
                  <span>🗑️</span><span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;