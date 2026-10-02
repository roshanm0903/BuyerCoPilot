import React, { useEffect, useState } from 'react';
import { 
  Building2, 
  Mail, 
  Award, 
  Layers, 
  Database, 
  CheckCircle2, 
  ArrowRight, 
  Sparkles,
  Cpu
} from 'lucide-react';
import { Workspace1PurchaseRequests } from './components/Workspace1PurchaseRequests';
import { Workspace2SupplierInbox } from './components/Workspace2SupplierInbox';
import { Workspace3AwardStudio } from './components/Workspace3AwardStudio';
import { DatabaseVisualizer } from './components/DatabaseVisualizer';

export default function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<'prs' | 'inbox' | 'award' | 'database'>('prs');
  const [quoteFromLink, setQuoteFromLink] = useState<string | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((health) => setGeminiConfigured(Boolean(health.geminiConfigured)))
      .catch(() => setGeminiConfigured(false));
  }, []);

  useEffect(() => {
    const openLinkedRecord = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#quote=')) {
        setQuoteFromLink(decodeURIComponent(hash.slice('#quote='.length)));
        setActiveWorkspace('inbox');
      }
    };
    openLinkedRecord();
    window.addEventListener('hashchange', openLinkedRecord);
    return () => window.removeEventListener('hashchange', openLinkedRecord);
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f6f2] text-[#20332e] flex flex-col font-sans selection:bg-[#235848] selection:text-white">
      {/* Calm, Simplified Procure Header */}
      <header className="sticky top-0 z-40 bg-[#f5f6f2]/95 backdrop-blur-md border-b border-[#dfe5de]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Logo & Platform Title */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#235848] text-white flex items-center justify-center font-serif text-lg font-bold shadow-xs">
              P
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-tight text-sm uppercase text-[#20332e]">
                  Procure
                </span>
                <span className="text-xs text-[#68766b]">· Sourcing Copilot</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#edf1eb] text-[#235848] font-bold border border-[#dfe5de]">
                  A2B Packaging RFQ
                </span>
              </div>
              <p className="text-xs text-[#68766b]">
                Three connected workspaces: from factory request to buying decision
              </p>
            </div>
          </div>

          {/* Connected Workspaces Navigation + Database Visualizer */}
          <div className="flex items-center gap-1 bg-[#e9ece6] p-1 rounded-xl text-xs overflow-x-auto">
            <button
              onClick={() => setActiveWorkspace('prs')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeWorkspace === 'prs'
                  ? 'bg-white text-[#235848] shadow-xs'
                  : 'text-[#68766b] hover:text-[#20332e]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>1. Purchase Requests</span>
            </button>

            <button
              onClick={() => setActiveWorkspace('inbox')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeWorkspace === 'inbox'
                  ? 'bg-white text-[#235848] shadow-xs'
                  : 'text-[#68766b] hover:text-[#20332e]'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>2. Supplier Inbox</span>
            </button>

            <button
              onClick={() => setActiveWorkspace('award')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeWorkspace === 'award'
                  ? 'bg-white text-[#235848] shadow-xs'
                  : 'text-[#68766b] hover:text-[#20332e]'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>3. Award Studio</span>
            </button>

            <div className="h-4 w-px bg-[#dfe5de] mx-1"></div>

            <button
              onClick={() => setActiveWorkspace('database')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeWorkspace === 'database'
                  ? 'bg-[#235848] text-white shadow-xs'
                  : 'text-[#235848] hover:bg-white/60'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Database Visualizer</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeWorkspace === 'prs' && (
          <Workspace1PurchaseRequests
            onGoToNext={() => setActiveWorkspace('inbox')}
          />
        )}

        {activeWorkspace === 'inbox' && (
          <Workspace2SupplierInbox
            initialQuoteId={quoteFromLink}
            onGoToPrev={() => setActiveWorkspace('prs')}
            onGoToNext={() => setActiveWorkspace('award')}
            onOpenDbVisualizer={() => setActiveWorkspace('database')}
          />
        )}

        {activeWorkspace === 'award' && (
          <Workspace3AwardStudio
            onGoToPrev={() => setActiveWorkspace('inbox')}
            onGoToFirst={() => setActiveWorkspace('prs')}
          />
        )}

        {activeWorkspace === 'database' && (
          <div className="animate-fadeIn">
            <DatabaseVisualizer onClose={() => setActiveWorkspace('inbox')} />
          </div>
        )}
      </main>

      {/* Serene, Uncluttered Footer */}
      <footer className="border-t border-[#dfe5de] bg-[#f5f6f2] py-4 text-xs text-[#68766b]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#20332e]">PROCURE</span>
            <span>· A2B Foods Packaging Procurement</span>
            <span>· Bengaluru (PR-BLR-1088) & Chennai (PR-CHN-1045)</span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <a href="/setup.html" className="text-[#235848] font-medium hover:underline">Meet Ananya</a>
            <span>•</span>
            <button
              onClick={() => setActiveWorkspace('database')}
              className="text-[#235848] font-medium hover:underline flex items-center gap-1"
            >
              <Database className="w-3 h-3" />
              <span>SQLite Embedded Data Model</span>
            </button>
            <span>•</span>
            <span className="flex items-center gap-1 text-[#235848] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
              {geminiConfigured === null ? 'Checking Gemini configuration' : geminiConfigured ? 'Gemini configured' : 'Gemini unavailable'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
