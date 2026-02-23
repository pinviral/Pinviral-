import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  PlusCircle, 
  History, 
  BarChart3, 
  Settings, 
  ChevronRight, 
  Search,
  Link as LinkIcon,
  Sparkles,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  ArrowRight,
  LayoutGrid,
  LogIn,
  UserPlus,
  LogOut,
  Mail,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { generatePinContent, generatePinImage, PinContent } from './services/geminiService';

// --- Types ---
interface Trend {
  id: number;
  keyword: string;
  source: string;
  category: string;
  momentum_score: number;
  search_volume: number;
  related_keywords?: string[];
  historical_data?: { date: string; value: number }[];
}

interface Metadata {
  title: string;
  description: string;
  image: string;
}

interface GeneratedPin extends PinContent {
  imageUrl: string | null;
  id: string;
}

// --- Components ---

const TabButton = ({ active, icon: Icon, label, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1 flex-1 transition-colors ${active ? 'text-ios-blue' : 'text-ios-gray'}`}
  >
    <Icon size={24} />
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);

const Header = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="px-6 pt-12 pb-6">
    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
    {subtitle && <p className="text-ios-gray text-sm mt-1">{subtitle}</p>}
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState('trends');
  const [trends, setTrends] = useState<Trend[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [generatedPins, setGeneratedPins] = useState<GeneratedPin[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [step, setStep] = useState(1); // 1: Input, 2: Metadata, 3: Generated
  const [isConnected, setIsConnected] = useState(false);
  const [searchResults, setSearchResults] = useState<Trend | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Trend[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState<{ show: boolean; url: string }>({ show: false, url: '' });
  const [editingPin, setEditingPin] = useState<GeneratedPin | null>(null);
  const [user, setUser] = useState<any>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    checkAuth();
    fetchTrends();
    fetchHistory();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsConnected(true);
        alert("Successfully connected to Pinterest!");
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setIsConnected(data.isConnected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });
      const data = await res.json();
      if (res.ok) {
        // Fetch full user data after auth to get connection status
        checkAuth();
      } else {
        alert(data.error || "Authentication failed");
      }
    } catch (e) {
      alert("An error occurred during authentication");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setActiveTab('trends');
  };

  const fetchTrends = async (query = '') => {
    try {
      const res = await fetch(`/api/trends${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      const data = await res.json();
      setTrends(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/pins');
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const { url } = await res.json();
      window.open(url, 'pinterest_oauth', 'width=600,height=700');
    } catch (e) {
      alert("Failed to initiate connection");
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    setIsSearching(true);
    setSearchResults(null);
    setShowSuggestions(false);
    try {
      const res = await fetch(`/api/trending/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (res.ok) {
        setSearchResults(data);
      } else {
        alert(data.error || "Search failed");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (!val) {
      setSearchResults(null);
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    // Simple autocomplete from existing trends
    const filtered = trends.filter(t => t.keyword.toLowerCase().includes(val.toLowerCase())).slice(0, 5);
    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
    fetchTrends(val);
  };

  const handleDownload = async (pin: GeneratedPin) => {
    if (!pin.imageUrl) return;
    const link = document.createElement('a');
    link.href = pin.imageUrl;
    link.download = `pin-${pin.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = async () => {
    const JSZip = (await import('jszip')).default;
    const saveAs = (await import('file-saver')).saveAs;
    const zip = new JSZip();

    generatedPins.forEach((pin, index) => {
      if (pin.imageUrl) {
        const base64Data = pin.imageUrl.split(',')[1];
        zip.file(`pin-${index + 1}.png`, base64Data, { base64: true });
      }
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'pinviral-pins.zip');
  };

  const handlePublish = async (pin: any, status: 'published' | 'scheduled' = 'published') => {
    if (!isConnected) {
      alert("Please connect your Pinterest account first.");
      setActiveTab('settings');
      return;
    }

    const pinId = pin.id;
    setPublishingId(pinId);
    try {
      const res = await fetch('/api/pins/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pin.title,
          description: pin.description,
          image_url: pin.imageUrl || pin.image_url,
          board_id: 'mock-board-id'
        })
      });
      
      const data = await res.json();

      if (res.ok) {
        // If it's a new pin (from generator), save it
        if (!pin.created_at) {
          await fetch('/api/pins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_url: url || pin.source_url || '',
              title: pin.title,
              description: pin.description,
              image_url: pin.imageUrl || pin.image_url,
              status
            })
          });
        } else {
          // If it's from history, update status
          await fetch(`/api/pins/${pin.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
          });
        }
        
        setShowSuccess({ show: true, url: data.pin_url });
        setTimeout(() => setShowSuccess({ show: false, url: '' }), 5000);
        fetchHistory();
      } else {
        if (data.code === 'AUTH_EXPIRED') {
          setIsConnected(false);
          alert(data.error);
        } else {
          alert(data.error || "Publishing failed");
        }
      }
    } catch (e) {
      alert("Failed to publish pin");
    } finally {
      setPublishingId(null);
    }
  };

  const handleExtract = async () => {
    if (!url) return;
    setLoading(true);
    setErrorDetails(null);
    setManualEntry(false);
    try {
      const res = await fetch('/api/extract-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setErrorDetails(data.error);
        if (data.can_manual) {
          setManualEntry(true);
          setMetadata({ title: '', description: '', image: '' });
          setStep(2);
        } else {
          alert(data.error);
        }
        return;
      }

      setMetadata(data);
      setStep(2);
    } catch (e) {
      setErrorDetails("A network error occurred.");
      setManualEntry(true);
      setMetadata({ title: '', description: '', image: '' });
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!metadata) return;
    setLoading(true);
    try {
      const selectedTrends = trends.slice(0, 3).map(t => t.keyword);
      const contents = await generatePinContent(metadata.title, metadata.description, selectedTrends);
      
      const pinsWithImages = await Promise.all(contents.map(async (c, i) => {
        const imageUrl = await generatePinImage(c.title);
        return { ...c, imageUrl, id: Math.random().toString(36).substr(2, 9) };
      }));
      
      setGeneratedPins(pinsWithImages);
      setStep(3);
    } catch (e) {
      alert("Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePin = (updatedPin: GeneratedPin) => {
    setGeneratedPins(prev => prev.map(p => p.id === updatedPin.id ? updatedPin : p));
    setEditingPin(null);
  };

  const handleSaveToHistory = async (pin: GeneratedPin) => {
    try {
      const res = await fetch('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: url || '',
          title: pin.title,
          description: pin.description,
          image_url: pin.imageUrl,
          status: 'draft'
        })
      });
      if (res.ok) {
        alert("Pin saved to history!");
        fetchHistory();
      }
    } catch (e) {
      alert("Failed to save pin");
    }
  };

  const renderAuth = () => (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ios-bg">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-20 h-20 bg-ios-blue rounded-3xl mx-auto flex items-center justify-center text-white shadow-xl mb-6">
            <Sparkles size={40} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">PinViral</h1>
          <p className="text-ios-gray">AI-Powered Pinterest Growth</p>
        </div>

        <form onSubmit={handleAuth} className="ios-card p-6 space-y-4">
          <div className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-gray" size={18} />
              <input 
                type="email" 
                placeholder="Email Address"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="ios-input w-full pl-10"
                required
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-gray" size={18} />
              <input 
                type="password" 
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="ios-input w-full pl-10"
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={authLoading}
            className="ios-button-primary w-full"
          >
            {authLoading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            ) : (
              authMode === 'login' ? 'Sign In' : 'Create Account'
            )}
          </button>

          <div className="text-center pt-2">
            <button 
              type="button"
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="text-ios-blue text-sm font-medium"
            >
              {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );

  const renderTrends = () => (
    <div className="space-y-6 pb-24">
      <Header title="Trends" subtitle="Real-time Pinterest intelligence" />
      
      <div className="px-6">
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-gray" size={18} />
          <input 
            type="text" 
            placeholder="Search keywords (Press Enter for deep search)..." 
            value={searchQuery}
            onChange={handleInputChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            className="ios-input w-full pl-10 pr-12"
          />
          <button 
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-blue font-bold text-xs"
          >
            {isSearching ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-ios-blue border-t-transparent" />
            ) : (
              'Search'
            )}
          </button>

          {/* Autocomplete Suggestions */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-xl border border-black/5 z-50 overflow-hidden"
              >
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSearchQuery(s.keyword);
                      setShowSuggestions(false);
                      handleSearch({ preventDefault: () => {} } as any);
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-ios-bg flex items-center justify-between transition-colors"
                  >
                    <span className="text-sm font-medium">{s.keyword}</span>
                    <span className="text-[10px] text-ios-gray uppercase font-bold">{s.category}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>

      <div className="px-6 space-y-4">
        <AnimatePresence>
          {searchResults && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="ios-card p-6 bg-ios-blue/5 border-ios-blue/20"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-ios-blue">{searchResults.keyword}</h3>
                  <p className="text-xs text-ios-gray uppercase font-bold">{searchResults.category}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-ios-blue">{searchResults.momentum_score}</div>
                  <p className="text-[10px] text-ios-gray uppercase font-bold">Trend Score</p>
                </div>
              </div>

              {/* Historical Graph */}
              {searchResults.historical_data && searchResults.historical_data.length > 0 && (
                <div className="h-40 w-full mb-6 mt-2">
                  <p className="text-[10px] font-bold text-ios-gray uppercase mb-2">7-Day Trend History</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={searchResults.historical_data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                      <XAxis 
                        dataKey="date" 
                        hide 
                      />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        labelStyle={{ fontWeight: 'bold', fontSize: '10px' }}
                        itemStyle={{ fontSize: '12px' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#007AFF" 
                        strokeWidth={3} 
                        dot={{ r: 4, fill: '#007AFF', strokeWidth: 0 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              
              <div className="space-y-3">
                <p className="text-xs font-bold text-ios-gray uppercase">Related Keywords</p>
                <div className="flex flex-wrap gap-2">
                  {searchResults.related_keywords?.map((kw: string) => (
                    <button 
                      key={kw}
                      onClick={() => {
                        setSearchQuery(kw);
                        handleSearch({ preventDefault: () => {} } as any);
                      }}
                      className="text-xs bg-white border border-ios-blue/20 text-ios-blue px-3 py-1 rounded-full hover:bg-ios-blue hover:text-white transition-colors"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={() => {
                  setUrl(`https://www.google.com/search?q=${encodeURIComponent(searchResults.keyword)}`);
                  setActiveTab('create');
                  setStep(1);
                }}
                className="ios-button-primary w-full mt-6 text-sm"
              >
                Use this trend
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <h2 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp size={20} className="text-ios-blue" />
          Rising Now
        </h2>
        <div className="space-y-3">
          {trends.map((trend) => (
            <motion.div 
              key={trend.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="ios-card p-4 flex items-center justify-between"
            >
              <div>
                <h3 className="font-semibold">{trend.keyword}</h3>
                <div className="flex gap-2 mt-1">
                  <span className="text-[10px] bg-ios-blue/10 text-ios-blue px-2 py-0.5 rounded-full font-bold uppercase">
                    {trend.source}
                  </span>
                  <span className="text-[10px] bg-ios-gray/10 text-ios-gray px-2 py-0.5 rounded-full font-bold uppercase">
                    {trend.category}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-ios-green font-bold text-sm">+{trend.momentum_score}%</div>
                <div className="text-[10px] text-ios-gray">{trend.search_volume.toLocaleString()} searches</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderGenerator = () => (
    <div className="space-y-6 pb-24">
      <Header title="Create" subtitle="Generate viral pins from any link" />
      
      <div className="px-6">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="ios-card p-6 space-y-4">
                <div className="flex items-center gap-3 text-ios-blue">
                  <LinkIcon size={24} />
                  <h3 className="font-bold">Paste Link</h3>
                </div>
                <p className="text-sm text-ios-gray">Enter a YouTube, TikTok, or blog URL to get started.</p>
                <input 
                  type="url" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..." 
                  className="ios-input w-full"
                />
                <button 
                  onClick={handleExtract}
                  disabled={loading || !url}
                  className="ios-button-primary w-full disabled:opacity-50"
                >
                  {loading ? 'Extracting...' : 'Next'}
                  {!loading && <ChevronRight size={20} />}
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && metadata && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="ios-card p-6 space-y-4">
                <div className="flex items-center gap-3 text-ios-blue">
                  <Sparkles size={24} />
                  <h3 className="font-bold">{manualEntry ? 'Manual Entry' : 'Review Content'}</h3>
                </div>

                {errorDetails && (
                  <div className="p-3 bg-ios-orange/10 border border-ios-orange/20 rounded-xl text-xs text-ios-orange font-medium">
                    {errorDetails} We couldn't fetch the details automatically.
                  </div>
                )}

                {!manualEntry && metadata.image && (
                  <img src={metadata.image} alt="Preview" className="w-full h-40 object-cover rounded-xl" referrerPolicy="no-referrer" />
                )}

                <div>
                  <label className="text-xs font-bold text-ios-gray uppercase">Title</label>
                  {manualEntry ? (
                    <input 
                      type="text"
                      value={metadata.title}
                      onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                      className="ios-input w-full mt-1"
                      placeholder="Enter pin title"
                    />
                  ) : (
                    <p className="font-semibold">{metadata.title || "No title found"}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-ios-gray uppercase">Description</label>
                  {manualEntry ? (
                    <textarea 
                      value={metadata.description}
                      onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                      className="ios-input w-full mt-1 h-24 resize-none"
                      placeholder="Enter pin description"
                    />
                  ) : (
                    <p className="text-sm text-ios-gray line-clamp-3">{metadata.description || "No description found"}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => {
                      setStep(1);
                      setManualEntry(false);
                      setErrorDetails(null);
                    }}
                    className="ios-button-secondary flex-1"
                  >
                    Back
                  </button>
                  <button 
                    onClick={handleGenerate}
                    disabled={loading || (manualEntry && (!metadata.title || !metadata.description))}
                    className="ios-button-primary flex-1"
                  >
                    {loading ? 'Generating...' : 'Generate Pins'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div 
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Generated Variations</h3>
                <div className="flex gap-3">
                  <button 
                    onClick={handleDownloadAll}
                    className="text-ios-blue text-sm font-semibold flex items-center gap-1"
                  >
                    <LayoutGrid size={16} />
                    Download All
                  </button>
                  <button onClick={() => setStep(1)} className="text-ios-blue text-sm font-semibold">Start Over</button>
                </div>
              </div>
              
              <div className="space-y-6">
                {generatedPins.map((pin, i) => (
                  <motion.div 
                    key={pin.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="ios-card"
                  >
                    <div className="flex flex-col md:flex-row">
                      <div className="w-full md:w-1/3 aspect-[9/16] bg-ios-light-gray relative group">
                        {pin.imageUrl ? (
                          <>
                            <img src={pin.imageUrl} alt="Pin" className="w-full h-full object-cover" />
                            <button 
                              onClick={() => handleDownload(pin)}
                              className="absolute top-3 right-3 bg-white/80 backdrop-blur p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ArrowRight size={18} className="rotate-90" />
                            </button>
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-ios-gray">
                            <ImageIcon size={48} />
                          </div>
                        )}
                      </div>
                      <div className="p-6 flex-1 space-y-4">
                        <h4 className="font-bold text-xl">{pin.title}</h4>
                        <p className="text-sm text-ios-gray">{pin.description}</p>
                        <div className="flex gap-2 pt-4">
                          <button 
                            onClick={() => setEditingPin(pin)}
                            className="ios-button-secondary px-3 text-sm"
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button 
                            onClick={() => handleSaveToHistory(pin)}
                            className="ios-button-secondary px-3 text-sm"
                            title="Save to History"
                          >
                            Save
                          </button>
                          <div className="flex-1 flex gap-2">
                            <button 
                              onClick={() => handleDownload(pin)}
                              className="ios-button-secondary flex-1 text-sm flex items-center justify-center gap-1"
                            >
                              <ArrowRight size={14} className="rotate-90" />
                              Download
                            </button>
                            <button 
                              onClick={() => handlePublish(pin, 'published')}
                              disabled={publishingId === pin.id}
                              className="ios-button-primary flex-1 text-sm"
                            >
                              {publishingId === pin.id ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                              ) : 'Publish'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  const renderAnalytics = () => (
    <div className="space-y-6 pb-24">
      <Header title="Analytics" subtitle="Track your viral growth" />
      <div className="px-6 grid grid-cols-2 gap-4">
        <div className="ios-card p-4">
          <div className="text-ios-gray text-xs font-bold uppercase mb-1">Impressions</div>
          <div className="text-2xl font-bold">12.4K</div>
          <div className="text-ios-green text-xs font-bold mt-1">+12%</div>
        </div>
        <div className="ios-card p-4">
          <div className="text-ios-gray text-xs font-bold uppercase mb-1">Clicks</div>
          <div className="text-2xl font-bold">842</div>
          <div className="text-ios-green text-xs font-bold mt-1">+5%</div>
        </div>
        <div className="ios-card p-4">
          <div className="text-ios-gray text-xs font-bold uppercase mb-1">Saves</div>
          <div className="text-2xl font-bold">156</div>
          <div className="text-ios-green text-xs font-bold mt-1">+24%</div>
        </div>
        <div className="ios-card p-4">
          <div className="text-ios-gray text-xs font-bold uppercase mb-1">Engagement</div>
          <div className="text-2xl font-bold">4.2%</div>
          <div className="text-ios-red text-xs font-bold mt-1">-1%</div>
        </div>
      </div>

      <div className="px-6">
        <div className="ios-card p-6 space-y-4">
          <h3 className="font-bold">Top Performing Keywords</h3>
          <div className="space-y-3">
            {[
              { label: 'Minimalist Decor', value: 85 },
              { label: 'Sustainable Fashion', value: 72 },
              { label: 'Vegan Recipes', value: 64 },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{item.label}</span>
                  <span className="font-bold">{item.value}%</span>
                </div>
                <div className="h-2 bg-ios-light-gray rounded-full overflow-hidden">
                  <div className="h-full bg-ios-blue" style={{ width: `${item.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-6 pb-24">
      <Header title="History" subtitle="Your generated pins and drafts" />
      <div className="px-6 space-y-4">
        {history.length === 0 && (
          <div className="text-center py-12 text-ios-gray">
            <History size={48} className="mx-auto mb-4 opacity-20" />
            <p>No pins generated yet.</p>
          </div>
        )}
        {history.map((pin) => (
          <div key={pin.id} className="ios-card p-4 flex flex-col gap-4">
            <div className="flex gap-4 items-center">
              <div className="w-16 h-16 bg-ios-light-gray rounded-lg overflow-hidden flex-shrink-0">
                {pin.image_url ? (
                  <img src={pin.image_url} alt="History" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ios-gray">
                    <ImageIcon size={20} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold truncate">{pin.title}</h4>
                <div className="flex items-center gap-2 text-[10px] text-ios-gray mt-1">
                  <Clock size={12} />
                  <span>{new Date(pin.created_at).toLocaleDateString()}</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                    pin.status === 'published' ? 'bg-ios-green/10 text-ios-green' : 'bg-ios-orange/10 text-ios-orange'
                  }`}>
                    {pin.status}
                  </span>
                </div>
              </div>
              <ChevronRight className="text-ios-gray" size={20} />
            </div>
            
            {pin.status !== 'published' && (
              <div className="flex gap-2">
                <button 
                  onClick={() => handlePublish(pin, 'published')}
                  disabled={publishingId === pin.id}
                  className="ios-button-primary flex-1 py-2 text-xs"
                >
                  {publishingId === pin.id ? (
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                  ) : 'Publish Now'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6 pb-24">
      <Header title="Settings" subtitle="Manage your account and connections" />
      <div className="px-6 space-y-4">
        <div className="ios-card p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-ios-blue/10 rounded-2xl flex items-center justify-center text-ios-blue">
              <LayoutGrid size={28} />
            </div>
            <div>
              <h3 className="font-bold text-lg">Pinterest Integration</h3>
              <p className="text-xs text-ios-gray">Required for direct publishing</p>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border ${isConnected ? 'bg-ios-green/5 border-ios-green/20' : 'bg-ios-orange/5 border-ios-orange/20'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${isConnected ? 'bg-ios-green' : 'bg-ios-orange'}`}>
                  {isConnected ? <CheckCircle2 size={20} /> : 'P'}
                </div>
                <div>
                  <p className="text-sm font-bold">{isConnected ? 'Account Connected' : 'Account Disconnected'}</p>
                  <p className="text-[10px] text-ios-gray">{isConnected ? 'You can now publish pins directly' : 'Connect your account to start publishing'}</p>
                </div>
              </div>
            </div>
            
            <button 
              onClick={handleConnect}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                isConnected 
                ? 'bg-white border border-ios-gray/20 text-ios-gray hover:bg-ios-bg' 
                : 'bg-ios-blue text-white shadow-lg shadow-ios-blue/20 hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {isConnected ? 'Reconnect Pinterest Account' : 'Connect Pinterest Account'}
            </button>
          </div>
        </div>

        <div className="ios-card p-6 space-y-4">
          <h3 className="font-bold">Subscription</h3>
          <div className="p-4 bg-ios-blue/5 border border-ios-blue/10 rounded-xl">
            <div className="flex justify-between items-center mb-2">
              <span className="text-ios-blue font-bold">Pro Plan</span>
              <span className="text-xs bg-ios-blue text-white px-2 py-0.5 rounded-full">Active</span>
            </div>
            <p className="text-xs text-ios-gray">Your next billing date is March 21, 2026.</p>
          </div>
          <button className="ios-button-secondary w-full text-sm">Manage Subscription</button>
        </div>

        <div className="ios-card overflow-hidden">
          <button className="w-full p-4 text-left flex items-center justify-between hover:bg-ios-bg transition-colors">
            <span className="text-sm font-medium">Account Details</span>
            <ChevronRight size={18} className="text-ios-gray" />
          </button>
          <div className="h-[1px] bg-black/5 mx-4" />
          <button className="w-full p-4 text-left flex items-center justify-between hover:bg-ios-bg transition-colors">
            <span className="text-sm font-medium">Privacy & Security</span>
            <ChevronRight size={18} className="text-ios-gray" />
          </button>
          <div className="h-[1px] bg-black/5 mx-4" />
          <button 
            onClick={() => alert("Thank you for your interest! Reviewing is currently enabled for beta testers.")}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-ios-bg transition-colors"
          >
            <span className="text-sm font-medium">Rate & Review App</span>
            <ChevronRight size={18} className="text-ios-gray" />
          </button>
          <div className="h-[1px] bg-black/5 mx-4" />
          <button 
            onClick={handleLogout}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-ios-bg transition-colors text-ios-red"
          >
            <span className="text-sm font-medium">Sign Out</span>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );

  if (!user) return renderAuth();

  return (
    <div className="max-w-md mx-auto min-h-screen relative shadow-2xl bg-ios-bg">
      {/* Success Toast */}
      <AnimatePresence>
        {showSuccess.show && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 20 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-0 left-0 right-0 z-[100] px-6 pointer-events-none"
          >
            <div className="bg-ios-green text-white p-4 rounded-2xl shadow-xl flex items-center justify-between pointer-events-auto max-w-sm mx-auto">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={24} />
                <div>
                  <p className="font-bold text-sm">Published Successfully!</p>
                  <a href={showSuccess.url} target="_blank" rel="noreferrer" className="text-[10px] underline opacity-80">View on Pinterest</a>
                </div>
              </div>
              <button onClick={() => setShowSuccess({ show: false, url: '' })} className="p-1">
                <ChevronRight size={20} className="rotate-90" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingPin && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-end justify-center p-6"
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="bg-white w-full max-w-sm rounded-3xl p-6 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Edit Pin</h3>
                <button onClick={() => setEditingPin(null)} className="text-ios-gray">
                  <ChevronRight size={24} className="rotate-90" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-ios-gray uppercase">Title</label>
                  <input 
                    type="text"
                    value={editingPin.title}
                    onChange={(e) => setEditingPin({ ...editingPin, title: e.target.value })}
                    className="ios-input w-full mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-ios-gray uppercase">Description</label>
                  <textarea 
                    value={editingPin.description}
                    onChange={(e) => setEditingPin({ ...editingPin, description: e.target.value })}
                    className="ios-input w-full mt-1 h-32 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setEditingPin(null)}
                  className="ios-button-secondary flex-1"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleUpdatePin(editingPin)}
                  className="ios-button-primary flex-1"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="min-h-screen">
        {activeTab === 'trends' && renderTrends()}
        {activeTab === 'create' && renderGenerator()}
        {activeTab === 'analytics' && renderAnalytics()}
        {activeTab === 'history' && renderHistory()}
        {activeTab === 'settings' && renderSettings()}
      </main>

      {/* Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/80 backdrop-blur-xl border-t border-black/5 px-6 py-3 pb-8 flex justify-between items-center z-50">
        <TabButton 
          active={activeTab === 'trends'} 
          icon={TrendingUp} 
          label="Trends" 
          onClick={() => setActiveTab('trends')} 
        />
        <TabButton 
          active={activeTab === 'create'} 
          icon={PlusCircle} 
          label="Create" 
          onClick={() => setActiveTab('create')} 
        />
        <TabButton 
          active={activeTab === 'analytics'} 
          icon={BarChart3} 
          label="Analytics" 
          onClick={() => setActiveTab('analytics')} 
        />
        <TabButton 
          active={activeTab === 'history'} 
          icon={History} 
          label="History" 
          onClick={() => setActiveTab('history')} 
        />
        <TabButton 
          active={activeTab === 'settings'} 
          icon={Settings} 
          label="Settings" 
          onClick={() => setActiveTab('settings')} 
        />
      </nav>
    </div>
  );
}
