import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ActiveMention, findActiveMention, insertMention } from '../utils/chatMentions';
import type { AwardPlan, AwardComparisonChart } from '../../server/utils/awardAnalysis';
import { formatAmount } from '../utils/formatAmount';
import { 
  Send, 
  Bot, 
  Sparkles, 
  Copy, 
  Check, 
  ChevronDown, 
  Terminal, 
  Table, 
  FileSpreadsheet, 
  Download, 
  Database,
  AlertCircle,
  Trash2
} from 'lucide-react';

export interface ExecutionStep {
  step: number;
  phase: string;
  tool: string;
  input: Record<string, any>;
  output: Record<string, any>;
  latencyMs: number;
  status?: 'completed' | 'invoked';
}

export interface DataQueryInfo {
  sql: string;
  targetEntity: string;
  filterExplanation: string;
  recordsRetrieved: number;
  promptFile: string;
  isConsolidation?: boolean;
}

export interface ExecutedQuery {
  sql: string;
  params: unknown[];
  rowCount: number;
  durationMs: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  model?: string;
  isLive?: boolean;
  deterministicAnswer?: boolean;
  isError?: boolean;
  executionTrace?: ExecutionStep[];
  dataQuery?: DataQueryInfo | null;
  executedQueries?: ExecutedQuery[];
  isConsolidatedDemand?: boolean;
  isExcelDownloadReady?: boolean;
  excelDownloadUrl?: string;
  excelFilename?: string;
  supplierShortlist?: { supplierIds: string[]; candidateIds?: string[] };
  awardPlan?: AwardPlan;
  sourceQuoteIds?: string[];
  comparisonChart?: AwardComparisonChart;
}

interface ProcureChatProps {
  workspace: 'prs' | 'inbox' | 'award';
  onConsolidationGenerated?: () => void;
}

export const ProcureChat: React.FC<ProcureChatProps> = ({ 
  workspace, 
  onConsolidationGenerated 
}) => {
  // Use a fresh Award Studio conversation after removing its old seeded and stale replies.
  const storageKey = workspace === 'award' ? 'aerchain-chat-award-v2' : `aerchain-chat-${workspace}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved) && saved.every((item) => item && typeof item.text === 'string' && ['user', 'assistant'].includes(item.sender))) {
        return workspace === 'award' ? saved.filter((item) => item.id !== 'init-1') : saved;
      }
    } catch { /* Start a fresh conversation if stored data is unavailable. */ }
    if (workspace === 'award') return [];
    return [{
      id: 'init-1',
      sender: 'assistant',
      text: `Hello, I am your **Sourcing Copilot**.

I assist procurement teams with demand consolidation across factory requisitions, vendor discovery, commercial quote extraction, RFQ workbook creation, and autonomous RFQ management.

How can I help you today?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dataQuery: null,
    }];
  });

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); }
    catch { /* Keep the live conversation if browser storage is full. */ }
  }, [storageKey, messages]);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const [mentionOptions, setMentionOptions] = useState<{ id: string; label: string; detail: string }[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const sendingRef = useRef(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Controls for viewing tool calls and execution sequence (expanded by default so user always sees queries and tool calls)
  const [autoExpandTraces, setAutoExpandTraces] = useState<boolean>(true);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Record<string, boolean>>({});

  // Chat-internal filter for consolidated table inside message
  const [chatCategoryFilter, setChatCategoryFilter] = useState<'all' | 'bottles' | 'cartons'>('all');
  const [chatLines, setChatLines] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeMention) {
      setMentionOptions([]);
      setMentionLoading(false);
      return;
    }
    const controller = new AbortController();
    setMentionLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/chat/mention-options?type=${activeMention.type}&q=${encodeURIComponent(activeMention.term)}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Could not load records');
          return response.json();
        })
        .then((data) => { setMentionOptions(data.options || []); setMentionIndex(0); })
        .catch((error) => { if (error.name !== 'AbortError') setMentionOptions([]); })
        .finally(() => { if (!controller.signal.aborted) setMentionLoading(false); });
    }, 120);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeMention?.type, activeMention?.term]);

  const chooseMention = (option: { label: string }) => {
    if (!activeMention) return;
    const next = insertMention(input, activeMention, option.label);
    setInput(next.value);
    setActiveMention(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  // Fetch live RFx lines from SQLite database
  useEffect(() => {
    fetch('/api/rfx/lines')
      .then((r) => r.json())
      .then((data) => {
        if (data.lines && data.lines.length > 0) {
          setChatLines(
            data.lines.map((l: any) => ({
              id: l.rfx_line_id,
              skuCode: l.sku_code,
              name: l.item_name,
              category: l.category,
              sizeSpecification: l.size_specification,
              quantityBLR: l.quantity_blr,
              quantityCHN: l.quantity_chn,
              totalQuantity: l.total_quantity,
              baselineRate: l.baseline_rate,
            }))
          );
        }
      })
      .catch((err) => console.error('Failed to load lines from DB:', err));
  }, []);

  // Context-specific suggested prompts
  const getPromptSuggestions = () => {
    switch (workspace) {
      case 'prs':
        return [
          'Consolidate demand across PR-BLR-1088 & PR-CHN-1045',
          'List all suppliers',
          'Which suppliers have at least 95% delivery performance?',
          'Which suppliers match our RFQ categories and who can supply both bottles and cartons?',
          'Where will that be stored and how will they all be filtered?',
          'Send the RFQ',
          'Can I download the RFQ?',
        ];
      case 'inbox':
        return [
          'Explain Allied Packaging’s ₹75,000.00 tooling fee waiver',
          'Compare landed cost of Supplier A vs Supplier F for Chennai',
          'Why was Supplier E disqualified by the quality audit?',
        ];
      case 'award':
        return [
          'Can I split RFQ-2026-041 between Alpha-Pack and PrimePack 50/50?',
          'What is our net savings against the current baseline?',
          'Draft a negotiation message to PrimePack asking if they can match a target price',
        ];
    }
  };

  const suggestions = getPromptSuggestions();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (messageText?: string) => {
    const query = messageText || input;
    if (!query.trim() || sendingRef.current) return;
    sendingRef.current = true;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setActiveMention(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          history: messages.map(({ sender, text, supplierShortlist, awardPlan }) => ({ sender, text, supplierShortlist, awardPlan })),
          context: `Workspace: ${workspace.toUpperCase()}`,
        }),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error || `Chat API responded with status ${response.status}`);
      }

      const data = await response.json();

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'assistant',
        text: data.reply || 'Analysis completed.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: data.model,
        isLive: Boolean(data.liveLLM),
        deterministicAnswer: Boolean(data.deterministicAnswer),
        executionTrace: data.executionTrace,
        dataQuery: data.dataQuery,
        executedQueries: data.executedQueries,
        isConsolidatedDemand: Boolean(data.isConsolidatedDemand),
        isExcelDownloadReady: Boolean(data.isExcelDownloadReady),
        excelDownloadUrl: data.excelDownloadUrl,
        excelFilename: data.excelFilename,
        supplierShortlist: data.supplierShortlist,
        awardPlan: data.awardPlan,
        sourceQuoteIds: data.sourceQuoteIds,
        comparisonChart: data.comparisonChart,
      };

      setMessages((prev) => [...prev, aiMsg]);

      if (autoExpandTraces) {
        setExpandedTraceIds((prev) => ({ ...prev, [aiMsg.id]: true }));
      }

      if (aiMsg.isConsolidatedDemand) {
        onConsolidationGenerated?.();
      }

    } catch (err: unknown) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: `⚠️ **Chat unavailable:** ${(err as Error)?.message || String(err)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
        isLive: false,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      sendingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleTrace = (msgId: string) => {
    setExpandedTraceIds((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const clearChat = () => {
    setMessages([]);
    setInput('');
    setExpandedTraceIds({});
    setActiveMention(null);
    setChatLines([]);
    setChatCategoryFilter('all');
    inputRef.current?.focus();
  };

  const filteredChatLines = chatLines.filter((item) => {
    if (chatCategoryFilter === 'bottles') return item.category === 'PET Bottles';
    if (chatCategoryFilter === 'cartons') return item.category === 'Cartons';
    return true;
  });

  return (
    <div className="bg-white border border-[#dfe5de] rounded-2xl flex flex-col shadow-xs h-[720px] w-full min-w-0 overflow-hidden">
      {/* Chat Header with Tool Call Sequence & Query Toggle */}
      <div className="p-3 bg-[#edf1eb] border-b border-[#dfe5de] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#235848] text-white flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-[#20332e]">Sourcing Copilot</h3>
            </div>
            <p className="text-[10px] text-[#68766b]">Multi-Agent Autonomous Procurement Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(workspace === 'award' || workspace === 'prs') && (
            <button
              onClick={clearChat}
              disabled={messages.length === 0 || isLoading}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border border-[#dfe5de] bg-white text-[#68766b] transition-all hover:text-rose-700 hover:border-rose-200 disabled:cursor-not-allowed disabled:opacity-45"
              title="Clear this conversation"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear chat</span>
            </button>
          )}
          {/* Global Toggle to Auto-Expand / Collapse Tool Call Sequences & Data Queries */}
          <button
            onClick={() => setAutoExpandTraces(!autoExpandTraces)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all ${
              autoExpandTraces
                ? 'bg-[#235848] text-white border-[#235848]'
                : 'bg-white text-[#68766b] border-[#dfe5de] hover:text-[#20332e]'
            }`}
            title="Toggle whether data queries and tool traces are expanded by default"
          >
            <Terminal className="w-3 h-3" />
            <span>{autoExpandTraces ? 'Traces: Expanded' : 'Traces: Collapsed'}</span>
          </button>
        </div>
      </div>

      {/* Message Feed */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3.5 text-xs leading-relaxed">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isExpanded = expandedTraceIds[msg.id] !== undefined ? expandedTraceIds[msg.id] : autoExpandTraces;
          const totalLatency = msg.executionTrace?.reduce((acc, step) => acc + step.latencyMs, 0) || 0;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`p-3.5 rounded-xl min-w-0 space-y-2.5 ${isUser ? 'max-w-[96%]' : 'w-[96%]'} ${
                  isUser
                    ? 'bg-[#235848] text-white rounded-br-none shadow-xs'
                    : msg.isError
                    ? 'bg-rose-50 text-rose-950 border border-rose-200 rounded-bl-none shadow-xs'
                    : 'bg-[#f8faf7] text-[#20332e] border border-[#e4eae3] rounded-bl-none shadow-xs'
                }`}
              >
                {!isUser && msg.comparisonChart && msg.comparisonChart.rows.length > 0 && (() => {
                  const costs = msg.comparisonChart!.rows.map((row) => row.value);
                  const low = Math.min(...costs);
                  const high = Math.max(...costs);
                  const isWaterfall = msg.comparisonChart!.presentation === 'waterfall';
                  const referenceSpend = msg.comparisonChart!.rows[0]?.value || 0;
                  return (
                    <figure className="rounded-xl border border-[#dfe5de] bg-white p-3 space-y-3" aria-label={msg.comparisonChart!.title}>
                      <figcaption className="text-[11px] font-bold text-[#20332e]">{msg.comparisonChart!.title}</figcaption>
                      {isWaterfall && msg.comparisonChart!.budgetDiscrepancy && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                          <p className="font-bold">Budget control required</p>
                          <p>Combined budget across {msg.comparisonChart!.budgetDiscrepancy.prCount} linked purchase requests: ₹{formatAmount(msg.comparisonChart!.budgetDiscrepancy.prBudget)}. RFQ reference spend: ₹{formatAmount(msg.comparisonChart!.budgetDiscrepancy.referenceSpend)}. Resolve the governing spend baseline before approving an award.</p>
                        </div>
                      )}
                      {msg.comparisonChart!.rows.map((row) => (
                        <div key={row.label} className="space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                            <span className="font-semibold text-[#20332e]">{row.label}</span>
                            <span className="font-mono font-bold text-[#235848]">₹{formatAmount(row.value)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[#edf1eb] overflow-hidden">
                            <div className="h-full rounded-full bg-[#235848]" style={{ width: `${isWaterfall ? Math.max(4, Math.min(100, (row.value / referenceSpend) * 100)) : high === 0 ? 100 : Math.max(4, (row.value / high) * 100)}%` }} />
                          </div>
                          <p className="text-[10px] text-[#68766b]">
                            {isWaterfall
                              ? row.label === msg.comparisonChart!.rows[0]?.label ? 'RFQ line quantities x reference rates' : `${msg.comparisonChart!.savings && msg.comparisonChart!.savings >= 0 ? `₹${formatAmount(msg.comparisonChart!.savings)} below reference` : `₹${formatAmount(Math.abs(msg.comparisonChart!.savings || 0))} above reference`}`
                              : row.value === low ? 'Lowest shown' : `₹${formatAmount(row.value - low)} above lowest`}
                            {row.note ? ` · ${row.note}` : ''}
                          </p>
                        </div>
                      ))}
                      {isWaterfall ? (
                        <>
                          <div className="rounded-lg bg-[#eef6f0] px-3 py-2 text-[11px] text-[#1d5b43]">
                            <span className="font-bold">{msg.comparisonChart!.savings && msg.comparisonChart!.savings >= 0 ? 'Below RFQ reference:' : 'Above RFQ reference:'}</span>{' '}
                            ₹{formatAmount(Math.abs(msg.comparisonChart!.savings || 0))} ({Math.abs(msg.comparisonChart!.savingsPercent || 0).toFixed(2)}%)
                          </div>
                          <details className="text-[10px] text-[#68766b]">
                            <summary className="cursor-pointer font-semibold text-[#355c50]">Calculation details</summary>
                            <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md bg-[#f7f9f7] p-2">
                              <span>RFQ reference spend</span><span>₹{formatAmount(msg.comparisonChart!.rows[0]?.value || 0)}</span>
                              <span>Proposed award spend</span><span>₹{formatAmount(msg.comparisonChart!.rows[1]?.value || 0)}</span>
                              <span>Difference</span><span>₹{formatAmount(Math.abs(msg.comparisonChart!.savings || 0))}</span>
                            </div>
                          </details>
                        </>
                      ) : <p className="text-[10px] text-[#68766b]">Bars use the same zero-based cost scale.</p>}
                    </figure>
                  );
                })()}

                {/* Properly Rendered Markdown for Assistant, plain text for User */}
                {isUser ? (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                ) : (
                  <div className="prose prose-xs max-w-none text-xs text-[#20332e] leading-relaxed break-words">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ node, ...props }) => (
                          <div className="max-w-full overflow-x-auto my-2 border border-[#dfe5de] rounded-lg">
                            <table className="min-w-[720px] w-full text-left text-[11px] border-collapse bg-white break-normal" {...props} />
                          </div>
                        ),
                        thead: ({ node, ...props }) => (
                          <thead className="bg-[#f5f6f2] text-[#68766b] font-semibold border-b border-[#dfe5de]" {...props} />
                        ),
                        th: ({ node, ...props }) => (
                          <th className="p-2 border border-[#e4eae3] font-bold text-[#20332e] whitespace-nowrap" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="p-2 border border-[#f0f3ef] text-[#20332e] align-top" {...props} />
                        ),
                        h1: ({ node, ...props }) => (
                          <h1 className="text-sm font-bold text-[#20332e] mt-3 mb-1" {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 className="text-xs font-bold text-[#20332e] mt-2.5 mb-1" {...props} />
                        ),
                        h3: ({ node, ...props }) => (
                          <h3 className="text-xs font-bold text-[#235848] mt-2 mb-1" {...props} />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul className="list-disc pl-4 space-y-1 my-1.5" {...props} />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol className="list-decimal pl-4 space-y-1 my-1.5" {...props} />
                        ),
                        li: ({ node, ...props }) => (
                          <li className="text-[11px]" {...props} />
                        ),
                        p: ({ node, ...props }) => (
                          <p className="my-1.5 text-[11px] leading-relaxed" {...props} />
                        ),
                        strong: ({ node, ...props }) => (
                          <strong className="font-bold text-[#20332e]" {...props} />
                        ),
                        code: ({ node, ...props }) => (
                          <code className="bg-[#edf1eb] text-[#235848] px-1 py-0.2 rounded font-mono text-[10px]" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a className="text-[#235848] font-semibold underline hover:text-[#163b30]" {...props} />
                        ),
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}

                {!isUser && msg.sourceQuoteIds && msg.sourceQuoteIds.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#dfe5de] text-[10px]">
                    <span className="font-bold text-[#68766b]">Evidence:</span>
                    <a href="/api/rfq/excel" className="px-2 py-1 rounded-md bg-white border border-[#dfe5de] text-[#235848] font-semibold">RFQ workbook</a>
                    {msg.sourceQuoteIds.map((id) => (
                      <a key={id} href={`#quote=${encodeURIComponent(id)}`} className="px-2 py-1 rounded-md bg-white border border-[#dfe5de] text-[#235848] font-semibold hover:bg-[#edf1eb]">{id}</a>
                    ))}
                  </div>
                )}

                {/* RFQ EXCEL FILE GENERATION & DOWNLOAD CARD */}
                {!isUser && msg.isExcelDownloadReady && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2.5 mt-2 shadow-xs animate-fadeIn">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0 shadow-xs">
                          <FileSpreadsheet className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-xs text-emerald-950 flex items-center gap-1.5">
                            <span>{msg.excelFilename || 'A2B_Packaging_RFQ_2026_041.xlsx'}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono">
                              Live OpenXML
                            </span>
                          </div>
                          <div className="text-[11px] text-emerald-800">
                            Multi-sheet packet: Scope, 30 Consolidated Lines, 10 Questions, Terms
                          </div>
                        </div>
                      </div>

                      <a
                        href={msg.excelDownloadUrl || '/api/rfq/excel'}
                        download={msg.excelFilename || 'A2B_Packaging_RFQ_2026_041.xlsx'}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#235848] hover:bg-[#1b4538] text-white text-xs font-bold transition-all shadow-xs shrink-0 active:scale-98"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download RFQ Excel</span>
                      </a>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] pt-1.5 border-t border-emerald-200/80 text-emerald-900 font-medium">
                      <div className="bg-white/90 p-1.5 rounded-lg border border-emerald-200 text-center">
                        <span className="font-bold block text-emerald-950">Sheet 1</span>
                        <span>RFQ Scope Overview</span>
                      </div>
                      <div className="bg-white/90 p-1.5 rounded-lg border border-emerald-200 text-center">
                        <span className="font-bold block text-emerald-950">Sheet 2</span>
                        <span>30 Line Items Schedule</span>
                      </div>
                      <div className="bg-white/90 p-1.5 rounded-lg border border-emerald-200 text-center">
                        <span className="font-bold block text-emerald-950">Sheet 3</span>
                        <span>Vendor Questionnaire</span>
                      </div>
                      <div className="bg-white/90 p-1.5 rounded-lg border border-emerald-200 text-center">
                        <span className="font-bold block text-emerald-950">Sheet 4</span>
                        <span>Terms & Conditions</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* EXPLICIT DATA QUERY & TOOL TRACE SECTION */}
                {!isUser && ((msg.executedQueries?.length || 0) > 0 || msg.dataQuery || (msg.executionTrace && msg.executionTrace.length > 0)) && (
                  <div className="pt-2 border-t border-[#dfe5de]/80 space-y-2">
                    <button
                      type="button"
                      onClick={() => toggleTrace(msg.id)}
                      className="flex items-center justify-between w-full text-[11px] font-semibold text-[#235848] hover:text-[#1b4538] py-1 px-2.5 rounded-lg bg-[#edf1eb] hover:bg-[#e4eae3] transition-all border border-[#dfe5de]"
                    >
                      <span className="flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-[#235848]" />
                        <span>
                          {(msg.executedQueries?.length || 0) > 0
                            ? `Executed SQL (${msg.executedQueries?.length} queries) & Tool Trace`
                            : msg.dataQuery 
                            ? `SQL Query on Data (${msg.dataQuery.recordsRetrieved} records) & Tool Trace` 
                            : `Actual Execution Log (${msg.executionTrace?.length || 0} operations)`}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-[#68766b]">
                        <span>{isExpanded ? 'Collapse Details' : 'Expand Query & Trace'}</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="space-y-2.5 animate-fadeIn">
                        {msg.executedQueries && msg.executedQueries.length > 0 && (
                          <div className="rounded-xl border border-[#2a453e] bg-[#172622] p-2.5 text-white space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#a5d6a7]">
                              <span>SQL executed for this answer</span>
                              <span>{msg.executedQueries.length} queries</span>
                            </div>
                            <div className="max-h-[420px] overflow-y-auto space-y-1.5 pr-1">
                              {msg.executedQueries.map((query, index) => (
                                <details key={`${msg.id}-sql-${index}`} className="rounded-lg border border-[#254139] bg-[#0f1b18]" open={index === 0}>
                                  <summary className="cursor-pointer px-2.5 py-2 text-[10px] font-mono text-[#d7eadb]">
                                    Query {index + 1} · {query.rowCount} {query.rowCount === 1 ? 'row' : 'rows'} · {query.durationMs}ms
                                  </summary>
                                  <div className="border-t border-[#254139] px-2.5 pb-2.5">
                                    <pre className="overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-[#a5d6a7] mt-2">{query.sql}</pre>
                                    {query.params.length > 0 && (
                                      <div className="mt-2 break-all text-[10px] font-mono text-[#c1d8c7]">
                                        Bound values: {JSON.stringify(query.params)}
                                      </div>
                                    )}
                                  </div>
                                </details>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Data Query Box */}
                        {msg.dataQuery && (
                          <div className="p-2.5 bg-[#172622] text-white rounded-xl text-[11px] space-y-1.5 border border-[#2a453e] shadow-xs">
                            <div className="flex items-center justify-between text-[#81c784]">
                              <span className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider">
                                <Terminal className="w-3.5 h-3.5 text-[#81c784]" />
                                <span>SQL Query Formed on Database</span>
                              </span>
                              <span className="text-[10px] text-gray-300 font-mono">
                                Entity: {msg.dataQuery.targetEntity}
                              </span>
                            </div>

                            <pre className="bg-[#0f1b18] p-2 rounded-lg text-[10px] font-mono text-[#a5d6a7] overflow-x-auto whitespace-pre leading-relaxed border border-[#254139]">
                              {msg.dataQuery.sql}
                            </pre>

                            <div className="space-y-1 pt-1 text-[10px] text-gray-300 border-t border-[#254139]">
                              <div><strong>Filter Applied:</strong> {msg.dataQuery.filterExplanation}</div>
                              <div className="flex items-center justify-between text-[9px] text-emerald-300 font-mono">
                                <span>Prompt Template: <code>{msg.dataQuery.promptFile}</code></span>
                                <span>Matched Records: {msg.dataQuery.recordsRetrieved}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Tool Calls Execution Sequence */}
                        {msg.executionTrace && msg.executionTrace.length > 0 && (
                          <div className="space-y-1.5 pl-2 border-l-2 border-[#235848]/40">
                            <span className="text-[10px] font-bold text-[#68766b] uppercase tracking-wider block">
                              Actual Execution Log ({msg.executionTrace.length} operations · {totalLatency}ms)
                            </span>
                            {msg.executionTrace.map((step) => (
                              <div 
                                key={step.step} 
                                className="bg-white p-2 rounded-xl border border-[#dfe5de] space-y-1 text-[10px] shadow-xs"
                              >
                                <div className="flex items-center justify-between font-mono">
                                  <span className="font-bold text-[#20332e] flex items-center gap-1">
                                    <span className="w-3.5 h-3.5 rounded-full bg-[#edf1eb] text-[#235848] flex items-center justify-center text-[9px] font-bold">
                                      {step.step}
                                    </span>
                                    <span>{step.phase}</span>
                                  </span>
                                  <span className="text-[#68766b]">{step.latencyMs}ms</span>
                                </div>
                                <div className="font-mono text-[#235848]">tool: {step.tool}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Message Provenance & Badges */}
                <div
                  className={`flex flex-wrap items-center justify-between pt-1 gap-2 text-[10px] border-t ${
                    isUser ? 'border-white/20 text-white/70' : 'border-[#e4eae3] text-[#68766b]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{msg.timestamp}</span>

                    {/* Show errors and database provenance without exposing the model name. */}
                    {!isUser && (
                      <>
                        {msg.isError ? (
                          <span className="px-1.5 py-0.2 rounded-md bg-rose-100 text-rose-800 font-bold border border-rose-300 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            <span>Service Error</span>
                          </span>
                        ) : msg.deterministicAnswer ? (
                          <span className="px-1.5 py-0.2 rounded-md bg-blue-100 text-blue-800 font-bold border border-blue-300 flex items-center gap-1">
                            <Database className="w-3 h-3 text-blue-700" />
                            <span>Deterministic Database Answer (SQLite Grounded)</span>
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>

                  {!isUser && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.text)}
                      className="p-1 hover:text-[#20332e] transition-colors"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-[#235848]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Show the known first step; the completed response carries the actual execution trace. */}
        {isLoading && (
          <div className="p-3.5 rounded-2xl bg-white border border-[#235848]/30 shadow-md max-w-[95%] animate-fadeIn text-xs flex items-center gap-2 text-[#235848]">
            <Sparkles className="w-4 h-4 animate-spin" />
            <span>Gemini is routing your request and preparing a response...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Starter Question Chips (Docked at bottom above input) */}
      <div className="p-2.5 bg-[#f5f6f2] border-t border-[#dfe5de] space-y-1.5 shrink-0">
        <div className="flex items-center justify-between text-[10px] text-[#68766b] font-bold uppercase tracking-wider px-1">
          <span className="flex items-center gap-1 text-[#235848]">
            <Sparkles className="w-3 h-3 text-[#235848]" />
            <span>Starter Questions</span>
          </span>
          <span className="text-[10px] text-[#88988b] font-normal lowercase">click to ask</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {suggestions.map((prompt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSend(prompt)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-[#edf1eb] text-[#20332e] border border-[#dfe5de] whitespace-nowrap transition-all text-left shrink-0 active:scale-98 shadow-2xs hover:border-[#235848] font-medium"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={(e) => { e.preventDefault(); if (!activeMention) handleSend(); }} className="relative p-3 border-t border-[#dfe5de] bg-[#fafbf9] flex gap-2">
        {activeMention && (
          <div role="listbox" aria-label={`${activeMention.type.toUpperCase()} records`} className="absolute bottom-full left-3 right-3 mb-1 max-h-60 overflow-y-auto rounded-xl border border-[#dfe5de] bg-white shadow-lg z-50">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#68766b] border-b border-[#dfe5de]">
              {activeMention.type === 'vendor' ? 'Vendors' : activeMention.type === 'item' ? 'Items' : activeMention.type.toUpperCase()} · Add a search term after @{activeMention.type.toUpperCase()}
            </div>
            {mentionLoading ? <div className="px-3 py-3 text-xs text-[#68766b]">Searching…</div> : mentionOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-[#68766b]">No matching records</div>
            ) : mentionOptions.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                onMouseDown={(event) => { event.preventDefault(); chooseMention(option); }}
                className={`block w-full px-3 py-2 text-left text-xs border-b last:border-0 border-[#f0f3ef] ${index === mentionIndex ? 'bg-[#edf1eb]' : 'hover:bg-[#f5f6f2]'}`}
              >
                <span className="block font-bold text-[#20332e]">{option.label}</span>
                <span className="block text-[10px] text-[#68766b] truncate">{option.detail}</span>
              </button>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveMention(findActiveMention(e.target.value, e.target.selectionStart ?? e.target.value.length));
          }}
          onClick={(e) => setActiveMention(findActiveMention(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length))}
          onBlur={() => window.setTimeout(() => setActiveMention(null), 120)}
          onKeyDown={(e) => {
            if (!activeMention) return;
            if (e.key === 'Escape') { e.preventDefault(); setActiveMention(null); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((current) => Math.min(current + 1, Math.max(mentionOptions.length - 1, 0))); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((current) => Math.max(current - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); if (mentionOptions[mentionIndex]) chooseMention(mentionOptions[mentionIndex]); }
          }}
          placeholder="Ask a question · Type @PR, @RFQ, @Vendor, or @Item to choose a record"
          className="flex-1 bg-white border border-[#dfe5de] rounded-xl px-3.5 py-2 text-xs text-[#20332e] focus:outline-none focus:border-[#235848]"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="px-4 py-2 rounded-xl bg-[#235848] hover:bg-[#1b4538] text-white disabled:opacity-50 text-xs font-semibold transition-all shadow-xs flex items-center gap-1 active:scale-98"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
};
