import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Building2, 
  MapPin, 
  Mail, 
  ArrowRight, 
  ArrowLeft, 
  Upload, 
  FileText, 
  Database, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Eye, 
  X, 
  RefreshCw, 
  Search, 
  Filter, 
  Download, 
  Send, 
  MessageSquare, 
  Check, 
  AlertCircle,
  HelpCircle,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  FileCheck
} from 'lucide-react';
import { DatabaseVisualizer } from './DatabaseVisualizer';
import { formatAmount } from '../utils/formatAmount';

interface Workspace2Props {
  initialQuoteId?: string | null;
  onGoToNext: () => void;
  onGoToPrev: () => void;
  onOpenDbVisualizer?: () => void;
}

export const Workspace2SupplierInbox: React.FC<Workspace2Props> = ({ 
  initialQuoteId,
  onGoToNext, 
  onGoToPrev,
  onOpenDbVisualizer
}) => {
  // State
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quoteDetails, setQuoteDetails] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
  const [rfqMessages, setRfqMessages] = useState<any[]>([]);
  const [selectedInvitationId, setSelectedInvitationId] = useState<string | null>(null);

  // Filters
  const [activeRfq, setActiveRfq] = useState<string>('RFQ-2026-041');
  const [statusFilter, setStatusFilter] = useState<'all' | 'incomplete' | 'complete'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Upload & Sample Files Modal
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [sampleFiles, setSampleFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Follow-up conversation drafting
  const [newMessageText, setNewMessageText] = useState<string>('');
  const [newSubjectText, setNewSubjectText] = useState<string>('');
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [messageNotice, setMessageNotice] = useState<string | null>(null);
  const [generatingFollowUp, setGeneratingFollowUp] = useState<boolean>(false);
  const [supplierReplyText, setSupplierReplyText] = useState('');
  const [processingSupplierReply, setProcessingSupplierReply] = useState(false);

  // Database Visualizer inline toggle
  const [showDbVisualizer, setShowDbVisualizer] = useState<boolean>(false);

  useEffect(() => {
    fetchQuotes();
    fetchRfqMessages();
    fetchSampleFiles();
  }, [activeRfq]);

  const fetchRfqMessages = async () => {
    try {
      const res = await fetch('/api/inbox/rfq-messages');
      if (res.ok) setRfqMessages((await res.json()).messages || []);
    } catch (err) {
      console.error('Failed to load RFQ messages:', err);
    }
  };

  const handleGenerateAiFollowUp = async () => {
    if (!selectedQuoteId) return;
    setGeneratingFollowUp(true);
    try {
      const res = await fetch(`/api/quotes/${selectedQuoteId}/generate-follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setNewSubjectText(data.subject);
        setNewMessageText(data.body);
      }
    } catch (err) {
      console.error('Failed to generate follow-up email:', err);
    } finally {
      setGeneratingFollowUp(false);
    }
  };

  const fetchQuotes = async (preferredQuoteId?: string) => {
    setLoading(true);
    try {
      const params = activeRfq ? `?rfxId=${encodeURIComponent(activeRfq)}` : '';
      const res = await fetch(`/api/inbox/quotes${params}`);
      if (res.ok) {
        const data = await res.json();
        const uniqueQuotes = Array.from(new Map((data.quotes || []).map((quote: any) => [quote.quote_id, quote])).values()) as any[];
        setQuotes(uniqueQuotes);
        // Automatically select first quote if none selected
        if ((!selectedQuoteId || preferredQuoteId) && uniqueQuotes.length > 0) {
          loadQuoteDetails(preferredQuoteId || initialQuoteId || uniqueQuotes[0].quote_id);
        }
      }
    } catch (e) {
      console.error('Failed to fetch quotes:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchSampleFiles = async () => {
    try {
      const res = await fetch('/api/sample-files');
      if (res.ok) {
        const data = await res.json();
        setSampleFiles(data.files || []);
      }
    } catch (e) {
      console.warn('Failed to fetch sample files:', e);
    }
  };

  const loadQuoteDetails = async (quoteId: string) => {
    setSelectedInvitationId(null);
    setSelectedQuoteId(quoteId);
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/inbox/quote/${quoteId}`);
      if (res.ok) {
        const data = await res.json();
        setQuoteDetails(data);
        setNewSubjectText(data.drafts?.[0]?.subject || '');
        setNewMessageText(data.drafts?.[0]?.message_text || '');
        setMessageNotice(null);
      }
    } catch (e) {
      console.error('Failed to load quote details:', e);
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuoteId && initialQuoteId !== selectedQuoteId) loadQuoteDetails(initialQuoteId);
  }, [initialQuoteId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuoteId || !newMessageText.trim()) return;

    setSendingMessage(true);
    setMessageNotice(null);
    try {
      const res = await fetch(`/api/inbox/quote/${selectedQuoteId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: newSubjectText || 'Procurement Clarification Follow-Up',
          messageText: newMessageText,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (quoteDetails) {
          setQuoteDetails({
            ...quoteDetails,
            conversations: data.conversations,
          });
        }
        setMessageNotice('Draft saved in this supplier conversation. No email was sent.');
      } else {
        setMessageNotice('Could not save the draft. Please try again.');
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessageNotice('Could not save the draft. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadMessage('The file is larger than 10 MB. Please upload a smaller quote.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setUploadMessage('Could not read this file. Please try again.');
    reader.onload = async (evt) => {
      const dataUrl = (evt.target?.result as string) || '';
      const fileBase64 = dataUrl.split(',', 2)[1] || '';
      setUploading(true);
      setUploadMessage(null);

      try {
        const res = await fetch('/api/ingest-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            fileBase64,
            documentType: 'quotation',
            rfxId: activeRfq,
          }),
        });

        if (!res.ok) {
          const failure = await res.json().catch(() => null);
          throw new Error(failure?.details || failure?.error || 'Upload error');
        }
        const data = await res.json();
        setIsUploadModalOpen(false);
        setUploadMessage(`Quote uploaded: "${file.name}". Review the supplier conversation below.`);
        if (/^Unit_Clarification_Full_Quote\.(txt|pdf)$/i.test(file.name)) {
          const unitLine = data.extractedData?.lines?.find((line: any) => /kg/i.test(line.price_uom || '') && line.normalized_unit_price == null);
          const sku = unitLine?.rfx_line_id?.match(/(?:BTL|CTN)-\d{3}/)?.[0];
          if (sku) setSupplierReplyText(`For ${sku}, one item weighs 28 grams. The quoted rate is INR ${Number(unitLine.unit_price).toFixed(2)} per kg. All other terms in our quotation remain confirmed.`);
        } else {
          setSupplierReplyText('');
        }
        await fetchQuotes(data.quoteId);
        if (data.quoteId) {
          const list = await fetch('/api/inbox/quotes').then((response) => response.json());
          const uploaded = list.quotes?.find((quote: any) => quote.quote_id === data.quoteId);
          if (uploaded?.completeness_status !== 'complete') {
            const promptResponse = await fetch(`/api/quotes/${data.quoteId}/generate-follow-up`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (promptResponse.ok) {
              const followUp = await promptResponse.json();
              await fetch(`/api/inbox/quote/${data.quoteId}/message`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: followUp.subject, messageText: followUp.body, demo: true }),
              });
              await loadQuoteDetails(data.quoteId);
            }
          }
        }
      } catch (err) {
        console.error(err);
        setUploadMessage(`Could not review this file: ${(err as Error).message}`);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSupplierReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuoteId || !supplierReplyText.trim()) return;
    setProcessingSupplierReply(true);
    setMessageNotice(null);
    try {
      const response = await fetch(`/api/inbox/quote/${selectedQuoteId}/supplier-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText: supplierReplyText }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the supplier reply');
      setSupplierReplyText('');
      if (result.review?.completeness_status !== 'complete') {
        const promptResponse = await fetch(`/api/quotes/${selectedQuoteId}/generate-follow-up`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (promptResponse.ok) {
          const followUp = await promptResponse.json();
          await fetch(`/api/inbox/quote/${selectedQuoteId}/message`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: followUp.subject, messageText: followUp.body, demo: true }),
          });
        }
      }
      await loadQuoteDetails(selectedQuoteId);
      await fetchQuotes();
      setMessageNotice(`${result.message}${result.changed?.length ? ` Updated: ${result.changed.join('; ')}.` : ''}`);
    } catch (error) {
      setMessageNotice((error as Error).message);
    } finally {
      setProcessingSupplierReply(false);
    }
  };

  // Filter quotes based on status and search query
  const filteredQuotes = quotes.filter((q) => {
    // RFQ filter (default to RFQ-2026-041)
    if (activeRfq && q.rfx_id && q.rfx_id !== activeRfq) {
      return false;
    }

    // Status filter
    if (statusFilter === 'complete' && q.completeness_status !== 'complete') {
      return false;
    }
    if (statusFilter === 'incomplete' && q.completeness_status === 'complete') {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchSupplier = q.supplier_name?.toLowerCase().includes(query) || q.supplier_code?.toLowerCase().includes(query);
      const matchQuoteNum = q.quote_number?.toLowerCase().includes(query);
      const matchAction = q.action_needed?.toLowerCase().includes(query);
      return matchSupplier || matchQuoteNum || matchAction;
    }

    return true;
  });

  const incompleteCount = quotes.filter((q) => q.completeness_status !== 'complete').length;
  const completeCount = quotes.filter((q) => q.completeness_status === 'complete').length;
  const visibleRfqMessages = rfqMessages.filter((message) => !activeRfq || message.rfx_id === activeRfq);
  const selectedInvitation = rfqMessages.find((message) => message.message_id === selectedInvitationId);
  const selectedQuoteReview = quotes.find((quote) => quote.quote_id === selectedQuoteId);
  const openAssessments = (quoteDetails?.assessments || []).filter((assessment: any) =>
    assessment.status === 'needs_confirmation' || assessment.status === 'missing_needs_follow_up');
  const threadMessages = quoteDetails ? [
    quoteDetails.originalMessage,
    ...[
    ...(quoteDetails.rfqMessages || []).map((message: any) => ({
      conversation_id: message.message_id,
      sender: 'agent',
      sender_name: 'Sourcing Team',
      timestamp: message.created_at,
      subject: message.subject,
      message_text: message.message_text,
      delivery_status: message.delivery_status,
    })),
    ...(quoteDetails.conversations || []),
    ].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))),
  ].filter(Boolean) : [];

  return (
    <div className="space-y-5">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dfe5de] pb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#235848]">
            Workspace 2 / 3 · Supplier Inbox
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#20332e] mt-0.5">
            Vendor Quotations & Clarifications Desk
          </h1>
          <p className="text-xs text-[#68766b] mt-1">
            Review supplier quotes, check totals and terms, and follow up on anything missing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Compact Upload & Download Modal Button */}
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#235848] text-[#235848] hover:bg-[#edf1eb] text-xs font-semibold shadow-xs transition-all"
          >
            <Upload className="w-3.5 h-3.5 text-[#235848]" />
            <span>Upload Quote</span>
          </button>

          {/* Database Visualizer Quick Toggle */}
          <button
            onClick={() => setShowDbVisualizer(!showDbVisualizer)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
              showDbVisualizer
                ? 'bg-[#235848] text-white border-[#235848]'
                : 'bg-white border-[#dfe5de] text-[#68766b] hover:text-[#20332e]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>{showDbVisualizer ? 'Hide Database' : 'Database Visualizer'}</span>
          </button>

          <button
            onClick={onGoToPrev}
            className="px-3 py-2 rounded-xl border border-[#dfe5de] bg-white text-xs font-semibold text-[#68766b] hover:text-[#20332e] transition-all"
          >
            ← Purchase Requests
          </button>

          <button
            onClick={onGoToNext}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#235848] hover:bg-[#1b4538] text-white text-xs font-semibold transition-all shadow-xs"
          >
            <span>Proceed to Award Studio</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Database Visualizer Section (if open) */}
      {showDbVisualizer && (
        <div className="animate-fadeIn">
          <DatabaseVisualizer onClose={() => setShowDbVisualizer(false)} />
        </div>
      )}

      {/* RFQ Selector & Quick Filter Strip */}
      <div className="bg-white border border-[#dfe5de] rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* RFQ Dropdown Selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-[#68766b] whitespace-nowrap">Filter by RFQ:</span>
          <select
            value={activeRfq}
            onChange={(e) => setActiveRfq(e.target.value)}
            className="bg-[#f5f6f2] border border-[#dfe5de] rounded-xl px-3 py-1.5 text-xs font-semibold text-[#20332e] focus:outline-none focus:border-[#235848]"
          >
            <option value="RFQ-2026-041">RFQ-2026-041: A2B Packaging (PR-BLR-1088 & PR-CHN-1045)</option>
            <option value="">All RFQs</option>
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              statusFilter === 'all'
                ? 'bg-[#235848] text-white shadow-xs'
                : 'bg-[#f5f6f2] text-[#68766b] hover:text-[#20332e]'
            }`}
          >
            All Quotes ({quotes.length})
          </button>

          <button
            onClick={() => setStatusFilter('incomplete')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              statusFilter === 'incomplete'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-[#f5f6f2] text-amber-800 hover:bg-amber-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Needs Attention ({incompleteCount})</span>
          </button>

          <button
            onClick={() => setStatusFilter('complete')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              statusFilter === 'complete'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-[#f5f6f2] text-emerald-800 hover:bg-emerald-50'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Ready for Award Review ({completeCount})</span>
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 text-[#68766b] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search vendor, quote #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#f5f6f2] border border-[#dfe5de] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#20332e] focus:outline-none focus:border-[#235848]"
          />
        </div>
      </div>

      {/* Main Streamlined 2-Column Split: Quotes List (Left 5 cols) & Quote Details + Past Conversations (Right 7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Quotes List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-white border border-[#dfe5de] rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-[#20332e]">
              <span>Sent RFQ invitations ({visibleRfqMessages.length})</span>
              <button onClick={fetchRfqMessages} className="text-[#235848] hover:underline">Refresh</button>
            </div>
            {visibleRfqMessages.length === 0 ? (
              <p className="text-[11px] text-[#68766b]">No RFQ emails have been sent for this RFQ.</p>
            ) : visibleRfqMessages.map((message) => (
              <button
                key={message.message_id}
                onClick={() => { setSelectedInvitationId(message.message_id); setSelectedQuoteId(null); setQuoteDetails(null); }}
                className={`w-full text-left p-2.5 rounded-xl border text-xs ${selectedInvitationId === message.message_id ? 'border-[#235848] bg-[#edf1eb]' : 'border-[#dfe5de] hover:border-[#b8c5b6]'}`}
              >
                <span className="font-semibold text-[#20332e]">{message.supplier_name}</span>
                <span className="float-right text-[10px] font-bold text-emerald-700">Sent</span>
                <span className="block text-[11px] text-[#68766b] mt-0.5 truncate">{message.subject}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-[#68766b] px-1 font-semibold">
            <span>Showing {filteredQuotes.length} Vendor Proposals</span>
            <button
              onClick={() => fetchQuotes()}
              className="flex items-center gap-1 text-[#235848] hover:underline"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="space-y-2.5 max-h-[780px] overflow-y-auto pr-1">
            {filteredQuotes.length === 0 ? (
              <div className="bg-white border border-[#dfe5de] rounded-2xl p-8 text-center text-xs text-[#68766b]">
                No quotes match the selected filter.
              </div>
            ) : (
              filteredQuotes.map((q) => {
                const isSelected = selectedQuoteId === q.quote_id;
                const isComplete = q.completeness_status === 'complete';
                const isDisqualified = q.supplier_status === 'disqualified';

                return (
                  <div
                    key={q.quote_id}
                    onClick={() => loadQuoteDetails(q.quote_id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer text-xs ${
                      isSelected
                        ? 'bg-white border-[#235848] shadow-md ring-1 ring-[#235848]/20'
                        : 'bg-white border-[#dfe5de] hover:border-[#b8c5b6] hover:shadow-xs'
                    } ${isDisqualified ? 'opacity-70 bg-gray-50/50' : ''}`}
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-sm font-bold text-[#20332e]">
                            {q.supplier_name || q.supplier_id}
                          </strong>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#edf1eb] text-[#235848]">
                            {q.supplier_code || q.supplier_id}
                          </span>
                        </div>
                        <span className="text-[11px] text-[#68766b] font-mono">
                          {q.quote_number} • {q.quote_date}
                        </span>
                        {q.status === 'sample_ready_for_review' && (
                          <span className="ml-2 text-[10px] font-semibold text-[#68766b]">Sample quote</span>
                        )}
                      </div>

                      {/* Completeness Badge */}
                      <div>
                        {isComplete ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                            <span>Ready for award review</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                            <span>{q.completeness_status === 'partial' ? 'Partial quote' : 'Needs attention'}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-[#68766b] font-semibold">
                      {q.quoted_lines_count} of {q.rfx_lines_count} RFQ items quoted
                    </div>

                    {/* Quote totals */}
                    <div className="flex items-center justify-between bg-[#f5f6f2] p-2.5 rounded-xl border border-[#dfe5de] my-2 text-[11px]">
                      <div>
                        <span className="text-[#68766b] block text-[10px]">Stated Quote Total</span>
                        <strong className="font-mono text-[#20332e]">
                          {q.stated_total_amount && q.stated_total_amount > 0
                            ? `₹${formatAmount(q.stated_total_amount)}`
                            : 'Not Stated'}
                        </strong>
                      </div>

                      <div className="text-right">
                        <span className="text-[#68766b] block text-[10px]">Total of Quote Lines</span>
                        <strong className="font-mono text-[#235848]">
                          {q.calculated_total_amount && q.calculated_total_amount > 0
                            ? `₹${formatAmount(q.calculated_total_amount)}`
                            : '—'}
                        </strong>
                      </div>
                    </div>

                    {/* Action Needed Badge or Missing Term Tag */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="truncate max-w-[240px]">
                        {q.missing_fields && q.missing_fields.length > 0 ? (
                          <span className="text-rose-700 font-semibold text-[11px] flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span className="truncate">Missing: {q.missing_fields.join(', ')}</span>
                          </span>
                        ) : q.confirmation_fields && q.confirmation_fields.length > 0 ? (
                          <span className="text-amber-800 font-semibold text-[11px] flex items-center gap-1">
                            <HelpCircle className="w-3 h-3 shrink-0" />
                            <span className="truncate">Needs sign-off: {q.confirmation_fields.join(', ')}</span>
                          </span>
                        ) : q.completeness_status !== 'complete' ? (
                          <span className="text-amber-800 font-semibold text-[11px] flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate">{q.action_needed}</span>
                          </span>
                        ) : (
                          <span className="text-emerald-700 text-[11px] flex items-center gap-1 font-medium">
                            <FileCheck className="w-3 h-3 text-emerald-600" />
                            <span>Verified & Ready for Allocation</span>
                          </span>
                        )}
                      </div>

                      <span className="text-xs font-semibold text-[#235848] flex items-center gap-0.5">
                        <span>Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Supplier correspondence and quote details */}
        <div className="lg:col-span-7">
          {detailsLoading ? (
            <div className="bg-white border border-[#dfe5de] rounded-2xl p-12 text-center text-xs text-[#68766b] space-y-2">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#235848]" />
              <p>Loading quotation details & communication history...</p>
            </div>
          ) : quoteDetails ? (
            <div className="bg-white border border-[#dfe5de] rounded-2xl p-5 shadow-xs space-y-5 text-xs animate-fadeIn">
              {/* Header Banner */}
              <div className="flex items-start justify-between border-b border-[#f0f3ef] pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#20332e]">
                      {quoteDetails.quote.quote_number}
                    </h2>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#edf1eb] text-[#235848] font-bold">
                      {quoteDetails.quote.supplier_code || quoteDetails.quote.supplier_id}
                    </span>
                    <span className="text-xs text-[#68766b]">
                      {quoteDetails.quote.supplier_name}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#68766b] mt-0.5">
                    Date: <strong>{quoteDetails.quote.quote_date}</strong> • Payment Terms: <strong>Net {quoteDetails.quote.payment_terms_days} days</strong> • Validity: <strong>{quoteDetails.quote.valid_until}</strong>
                  </p>
                </div>

                {/* Source File Download Button */}
                {quoteDetails.quote.message_id && (
                  <a
                    href={`/api/attachments/${quoteDetails.quote.message_id}/download`}
                    download
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#dfe5de] bg-[#f5f6f2] hover:bg-[#edf1eb] text-xs font-semibold text-[#20332e] transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-[#235848]" />
                    <span>Download File</span>
                  </a>
                )}
              </div>

              <div className={`p-3.5 rounded-xl text-[11px] ${quoteDetails.coverage?.quotedLines === quoteDetails.coverage?.requiredLines && !quoteDetails.coverage?.outOfScopeLines ? 'bg-emerald-50 border border-emerald-200 text-emerald-950' : 'bg-amber-50 border border-amber-200 text-amber-950'}`}>
                <strong>{quoteDetails.coverage?.quotedLines || 0} of {quoteDetails.coverage?.requiredLines || 0} RFQ items quoted.</strong>
                {Number(quoteDetails.coverage?.outOfScopeLines || 0) > 0 && (
                  <span> {quoteDetails.coverage.outOfScopeLines} item(s) fall outside this supplier&apos;s approved categories and need review.</span>
                )}
              </div>

              <div className="p-3.5 bg-[#f5f6f2] border border-[#dfe5de] rounded-xl text-[11px] text-[#20332e]">
                <strong>Delivery and freight:</strong> {quoteDetails.quote.freight_treatment === 'included' ? 'Included in unit prices' : quoteDetails.quote.freight_treatment}.
                {' '}Bengaluru: {quoteDetails.deliveryCosts?.some((cost: any) => cost.factory_id === 'BLR') ? `₹${formatAmount(quoteDetails.deliveryCosts.find((cost: any) => cost.factory_id === 'BLR').amount)}` : 'Not stated'};
                {' '}Chennai: {quoteDetails.deliveryCosts?.some((cost: any) => cost.factory_id === 'CHN') ? `₹${formatAmount(quoteDetails.deliveryCosts.find((cost: any) => cost.factory_id === 'CHN').amount)}` : 'Not stated'}.
              </div>

              {quoteDetails.capabilities?.length > 0 && (
                <div className="p-3.5 bg-[#f5f6f2] border border-[#dfe5de] rounded-xl text-[11px] text-[#20332e]">
                  <strong className="block mb-2">Supplier capacity and qualification records</strong>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left">
                      <thead><tr className="text-[#68766b] border-b border-[#dfe5de]">
                        <th className="pb-1 pr-3">Category</th><th className="pb-1 pr-3">Category / month</th><th className="pb-1 pr-3">Product / month</th><th className="pb-1 pr-3">Lead time</th><th className="pb-1 pr-3">Qualification</th><th className="pb-1">Historical OTIF</th>
                      </tr></thead>
                      <tbody>{quoteDetails.capabilities.map((capability: any) => (
                        <tr key={capability.category} className="border-b border-[#e8ece7] last:border-0">
                          <td className="py-1.5 pr-3 font-semibold">{capability.category}</td>
                          <td className="pr-3">{capability.category_capacity == null ? 'Not recorded' : formatAmount(capability.category_capacity)}</td>
                          <td className="pr-3">{capability.product_capacity == null ? 'Not recorded' : formatAmount(capability.product_capacity)}</td>
                          <td className="pr-3">{capability.lead_time_days ?? 'Not recorded'} days</td>
                          <td className="pr-3">{capability.qualification_status}</td>
                          <td>{capability.otif_pct == null ? 'Not recorded' : `${capability.otif_pct}%`}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[#68766b]">Monthly capacity is a supplier master record, not confirmed available production time.</p>
                </div>
              )}

              {/* Quote total review */}
              <div className="p-3.5 bg-[#f5f6f2] border border-[#dfe5de] rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#68766b] block">
                    Quote Total Check
                  </span>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="text-xs">
                      <span className="text-[#68766b]">Stated Total: </span>
                      <strong className="font-mono text-[#20332e]">
                        {quoteDetails.quote.stated_total_amount && quoteDetails.quote.stated_total_amount > 0
                          ? `₹${formatAmount(quoteDetails.quote.stated_total_amount)}`
                          : 'Not Stated'}
                      </strong>
                    </div>
                    <span className="text-[#68766b]">•</span>
                    <div className="text-xs">
                      <span className="text-[#68766b]">Calculated Sum: </span>
                      <strong className="font-mono text-[#235848]">
                        {quoteDetails.quote.calculated_total_amount == null ? 'Pending clarification' : `₹${formatAmount(quoteDetails.quote.calculated_total_amount)}`}
                      </strong>
                    </div>
                  </div>
                </div>

                <div>
                  {quoteDetails.quote.amount_variance == null ? (
                    <span className="inline-flex px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold text-[11px]">Pending clarification</span>
                  ) : Number(quoteDetails.quote.amount_variance) <= 50 ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Totals match</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold text-[11px]">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                      <span>Variance: ₹{formatAmount(quoteDetails.quote.amount_variance)} (Review Needed)</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Missing Fields & Actionable Alerts Section */}
              {openAssessments.length > 0 && (
                <div className="space-y-2 border border-amber-200 bg-amber-50/40 rounded-xl p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      <span>Details needing clarification ({openAssessments.length})</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleGenerateAiFollowUp}
                        disabled={generatingFollowUp}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#235848] text-white hover:bg-[#1b4538] text-[11px] font-bold transition-all shadow-xs disabled:opacity-50"
                      >
                        <Sparkles className={`w-3.5 h-3.5 text-emerald-300 ${generatingFollowUp ? 'animate-spin' : ''}`} />
                        <span>{generatingFollowUp ? 'Preparing draft...' : 'Draft follow-up email'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-amber-200/60 text-xs">
                    {openAssessments.map((a: any) => (
                      <div key={a.assessment_id} className="py-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-[#20332e]">{a.field_name}</div>
                          <p className="text-[11px] text-[#68766b] mt-0.5">{a.reason}</p>
                          <span className="text-[10px] text-[#68766b] italic block mt-0.5">
                            Evidence: &ldquo;{a.evidence_snippet}&rdquo;
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            a.status === 'missing_needs_follow_up'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {a.status === 'missing_needs_follow_up' ? 'Missing Term' : 'Confirm'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Past Conversations Between Agent & Supplier */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#f0f3ef] pb-2">
                  <span className="text-xs font-bold text-[#20332e] flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#235848]" />
                    <span>Supplier conversation ({threadMessages.length})</span>
                  </span>
                  <span className="text-[11px] text-[#68766b]">Original quotation and follow-ups</span>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {threadMessages.length === 0 ? (
                    <div className="p-4 bg-[#f5f6f2] rounded-xl text-center text-[#68766b] text-xs">
                      No messages recorded for this supplier yet.
                    </div>
                  ) : (
                    threadMessages.map((msg: any) => {
                      const isAgent = msg.sender === 'agent';

                      return (
                        <div
                          key={msg.conversation_id}
                          className={`p-3 rounded-xl border text-xs space-y-1 ${
                            isAgent
                              ? 'bg-[#edf1eb] border-[#235848]/20 ml-4'
                              : 'bg-white border-[#dfe5de] mr-4 shadow-xs'
                          }`}
                        >
                          <div className="flex justify-between items-center text-[10px] font-semibold text-[#68766b]">
                            <span className={isAgent ? 'text-[#235848] font-bold' : 'text-[#20332e] font-bold'}>
                              {msg.sender_name || (isAgent ? 'Procure Agent' : 'Supplier')}
                            </span>
                            <span className="font-mono">{msg.timestamp}</span>
                          </div>
                          <div className={`text-[10px] font-bold ${msg.delivery_status === 'sent' || msg.delivery_status === 'received' ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {msg.delivery_status === 'sent' ? 'Sent' : msg.delivery_status === 'received' ? 'Received' : msg.delivery_status === 'demo' ? 'Demo clarification · no email sent' : msg.delivery_status === 'received_demo' ? 'Supplier reply · demo' : msg.delivery_status === 'source_record' ? 'Submission record' : 'Delivery not verified'}
                          </div>
                          {msg.subject && (
                            <div className="font-bold text-[#20332e] text-[11px]">
                              {msg.subject}
                            </div>
                          )}
                          <div className="text-[#20332e] leading-relaxed space-y-1.5">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                              p: ({ node, ...props }) => <p className="my-1.5" {...props} />,
                              ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-1.5" {...props} />,
                              ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-1.5" {...props} />,
                            }}>{msg.message_text}</ReactMarkdown>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {messageNotice && <p className="p-2 rounded-lg bg-[#edf1eb] text-[11px] text-[#235848]">{messageNotice}</p>}
                {(quoteDetails.quote.status === 'extracted' || quoteDetails.quote.status === 'ready_for_review') ? (
                  <form onSubmit={handleSupplierReply} className="space-y-2 pt-2 border-t border-[#f0f3ef]">
                    <label htmlFor="supplier-demo-reply" className="block text-[11px] font-bold text-[#20332e]">Reply as supplier · demo</label>
                    <p className="text-[11px] text-[#68766b]">Answer the clarification in the supplier&apos;s words. For a price per kg, include the SKU and the weight of one item in grams.</p>
                    <textarea id="supplier-demo-reply" rows={5} value={supplierReplyText}
                      onChange={(e) => setSupplierReplyText(e.target.value)}
                      placeholder="For BTL-009, one bottle weighs 28 grams. The quoted rate is per kg..."
                      className="w-full min-h-28 bg-[#f5f6f2] border border-[#dfe5de] rounded-xl p-3 text-xs text-[#20332e] focus:outline-none focus:border-[#235848] resize-y" />
                    <button type="submit" disabled={processingSupplierReply || !supplierReplyText.trim()}
                      className="px-4 py-2 rounded-xl bg-[#235848] text-white text-xs font-semibold hover:bg-[#1b4538] disabled:opacity-50 ml-auto block">
                      {processingSupplierReply ? 'Reviewing reply...' : 'Add supplier reply and update quote'}
                    </button>
                    {selectedQuoteReview?.completeness_status === 'complete' && (
                      <p className="text-[11px] text-emerald-800 font-semibold">All recorded fields pass review. This quote is available in Award Studio.</p>
                    )}
                  </form>
                ) : (
                <form onSubmit={handleSendMessage} className="space-y-2 pt-1 border-t border-[#f0f3ef]">
                  <input
                    type="text"
                    placeholder="Subject (e.g. Clarification on Freight Rate...)"
                    value={newSubjectText}
                    onChange={(e) => setNewSubjectText(e.target.value)}
                    className="w-full bg-[#f5f6f2] border border-[#dfe5de] rounded-xl px-3 py-1.5 text-xs text-[#20332e] focus:outline-none focus:border-[#235848]"
                  />
                  <div className="space-y-2">
                    <textarea
                      rows={9}
                      placeholder="Type a clarification follow-up message to this vendor..."
                      value={newMessageText}
                      onChange={(e) => setNewMessageText(e.target.value)}
                      className="w-full min-h-48 bg-[#f5f6f2] border border-[#dfe5de] rounded-xl p-3 text-xs text-[#20332e] focus:outline-none focus:border-[#235848] resize-y"
                    />
                    <button
                      type="submit"
                      disabled={sendingMessage || !newMessageText.trim()}
                      className="px-4 py-2 rounded-xl bg-[#235848] text-white text-xs font-semibold hover:bg-[#1b4538] transition-all disabled:opacity-50 flex items-center gap-1 shadow-xs ml-auto"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{sendingMessage ? 'Saving...' : 'Save draft'}</span>
                    </button>
                  </div>
                </form>
                )}
              </div>

              {/* Extracted Lines with item_name and line totals */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-[#20332e] block">
                  Quoted Items ({quoteDetails.lines?.length || 0})
                </span>

                <div className="border border-[#dfe5de] rounded-xl overflow-auto max-h-72">
                  <table className="w-full min-w-[1100px] text-left text-xs">
                    <thead className="bg-[#f5f6f2] text-[#68766b] font-semibold border-b border-[#dfe5de]">
                      <tr>
                        <th className="p-2">Line</th>
                        <th className="p-2">RFQ Item</th>
                        <th className="p-2 text-right">Quoted Price</th>
                        <th className="p-2 text-right font-bold text-[#20332e]">Price per Unit</th>
                        <th className="p-2 text-right">Qty</th>
                        <th className="p-2 text-right font-bold text-[#235848]">Line Total</th>
                        <th className="p-2 text-right">Lead Time</th>
                        <th className="p-2 text-right">MOQ</th>
                        <th className="p-2">Delivery</th>
                        <th className="p-2">Specification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f3ef] font-mono">
                      {quoteDetails.lines?.map((line: any) => (
                        <tr key={line.quote_line_id} className="hover:bg-[#fafbf9]">
                          <td className="p-2 font-bold text-[#235848]">{line.rfx_line_id}</td>
                          <td className="p-2 font-sans text-[#20332e]">
                            <span className="font-semibold">{line.item_name || line.rfx_line_id}</span>
                            {line.raw_item_description && line.raw_item_description !== line.item_name && (
                              <span className="block mt-0.5 text-[10px] text-amber-800">Supplier description: {line.raw_item_description}</span>
                            )}
                          </td>
                          <td className="p-2 text-right">₹{formatAmount(line.unit_price)} / {line.price_uom}</td>
                          <td className="p-2 text-right font-bold text-[#235848]">{Number(line.normalized_unit_price) > 0 ? `₹${formatAmount(line.normalized_unit_price)} / ${line.normalized_uom || 'EA'}` : 'Needs clarification'}</td>
                          <td className="p-2 text-right">{line.quoted_quantity?.toLocaleString()}</td>
                          <td className="p-2 text-right font-bold text-[#235848]">
                            {line.line_total_amount == null ? 'Pending' : `₹${formatAmount(line.line_total_amount)}`}
                          </td>
                          <td className="p-2 text-right font-sans text-[11px] text-[#68766b]">
                            {line.lead_time_days} days
                          </td>
                          <td className="p-2 text-right">{line.moq_quantity?.toLocaleString() ?? '—'} {line.moq_uom || 'EA'}</td>
                          <td className="p-2">{line.delivery_date || '—'}</td>
                          <td className="p-2 capitalize">{line.specification_status || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : selectedInvitation ? (
            <div className="bg-white border border-[#dfe5de] rounded-2xl p-5 shadow-xs space-y-3 text-xs">
              <h2 className="text-base font-bold text-[#20332e]">RFQ invitation · {selectedInvitation.supplier_name}</h2>
              <div className="flex items-center gap-2 text-[11px] text-[#68766b]">
                <span>{selectedInvitation.created_at}</span>
                <span className="text-emerald-700 font-bold">Sent</span>
              </div>
              <p className="font-bold text-[#20332e]">{selectedInvitation.subject}</p>
              <p className="whitespace-pre-wrap leading-relaxed text-[#20332e]">{selectedInvitation.message_text}</p>
            </div>
          ) : (
            <div className="bg-white border border-[#dfe5de] rounded-2xl p-12 text-center text-xs text-[#68766b]">
              Select an invitation or a supplier quote to review the conversation and commercial details.
            </div>
          )}
        </div>
      </div>

      {/* Compact Upload & Sample File Download Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#dfe5de] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-xs text-[#20332e] animate-fadeIn">
            <div className="flex justify-between items-center border-b border-[#dfe5de] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#20332e]">
                  Upload & Download Vendor Quotes
                </h3>
                <p className="text-xs text-[#68766b] mt-0.5">
                  Download a sample supplier quote, then upload it to review its items and commercial terms.
                </p>
              </div>

              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="p-1 rounded-lg text-[#68766b] hover:text-[#20332e] hover:bg-[#f5f6f2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 1. Download Sample Vendor Quotes */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-[#235848] uppercase tracking-wider block">
                1. Download Sample Vendor Quotation Files (to test upload):
              </span>

              <div className="space-y-2 border border-[#dfe5de] rounded-xl p-3 bg-[#f5f6f2]">
                {sampleFiles.map((sf) => (
                  <div
                    key={sf.filename}
                    className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-[#dfe5de] text-xs"
                  >
                    <div>
                      <div className="font-bold text-[#20332e]">{sf.title}</div>
                      <span className="text-[10px] text-[#68766b] font-mono">
                        {sf.filename} • {sf.supplier}
                      </span>
                    </div>

                    <a
                      href={`/api/sample-files/${sf.filename}/download`}
                      download={sf.filename}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#edf1eb] hover:bg-[#235848] text-[#235848] hover:text-white font-semibold transition-all shadow-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Upload Document Dropzone */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-[#235848] uppercase tracking-wider block">
                2. Upload Vendor Quotation Document:
              </span>

              <label className="border-2 border-dashed border-[#dfe5de] hover:border-[#235848] rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer bg-[#fafbf9] hover:bg-[#edf1eb]/30 transition-all text-center">
                <Upload className="w-8 h-8 text-[#235848] mb-2" />
                <span className="font-bold text-[#20332e]">Click to select a file from your computer</span>
                <span className="text-[11px] text-[#68766b] mt-1">
                  PDF, Word, Excel, CSV, text, email, or image quotes · up to 10 MB
                </span>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".pdf,.docx,.xlsx,.xls,.csv,.tsv,.txt,.eml,.png,.jpg,.jpeg,.webp"
                />
              </label>

              {uploading && (
                <div className="p-3 bg-[#edf1eb] text-[#235848] font-semibold rounded-xl text-center flex items-center justify-center gap-2 animate-pulse">
                  <Sparkles className="w-4 h-4 animate-spin text-[#235848]" />
                  <span>Reviewing the uploaded quote...</span>
                </div>
              )}

              {uploadMessage && (
                <div className="p-3 bg-[#edf1eb] border border-[#235848]/30 rounded-xl text-xs text-[#235848] font-medium flex items-center justify-between">
                  <span>{uploadMessage}</span>
                  <button onClick={() => setUploadMessage(null)}>
                    <X className="w-3.5 h-3.5 text-[#68766b]" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-[#dfe5de]">
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#235848] text-white text-xs font-semibold hover:bg-[#1b4538] transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
