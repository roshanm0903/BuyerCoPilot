import React, { useState } from 'react';
import { 
  Building2, 
  MapPin, 
  Package, 
  ArrowRight, 
  Download, 
  Check, 
  Layers, 
  Calendar,
  Box,
  Cylinder,
  Search,
  Filter,
  Mail,
  Send,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  ShieldCheck,
  FileSpreadsheet,
  Table,
  CheckSquare,
  Database
} from 'lucide-react';
import { ProcureChat } from './ProcureChat';
import { formatAmount } from '../utils/formatAmount';

interface Workspace1Props {
  onGoToNext: () => void;
}

export const Workspace1PurchaseRequests: React.FC<Workspace1Props> = ({ onGoToNext }) => {
  // State for PR selection
  const [prs, setPrs] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [prLoadState, setPrLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedFocusedPr, setSelectedFocusedPr] = useState<'pr-blr' | 'pr-chn'>('pr-blr');
  const [downloaded, setDownloaded] = useState(false);
  const [plantFilter, setPlantFilter] = useState<'all' | 'BLR' | 'CHN'>('all');
  const [prSearch, setPrSearch] = useState('');

  // Product Filter LOV (List of Values) state
  const [productLovFilter, setProductLovFilter] = useState<string>('all');
  const [lineSearch, setLineSearch] = useState('');

  // PR Detail View Tab State: lines, questionnaire, terms, specifications
  const [prDetailTab, setPrDetailTab] = useState<'lines' | 'questionnaire' | 'terms' | 'specifications'>('lines');
  const [hasInteractedWithCopilot, setHasInteractedWithCopilot] = useState<boolean>(false);

  // RFQ Dispatch status (demonstrating the knowledge work outcome)

  // Fetch real data from SQLite database on mount
  React.useEffect(() => {
    fetch('/api/purchase-requests')
      .then((r) => r.json())
      .then((data) => {
        if (data.purchaseRequests && data.purchaseRequests.length > 0) {
          setPrs(
            data.purchaseRequests.map((p: any) => ({
              id: p.pr_id,
              prNumber: p.pr_number,
              factoryName: p.factory_name,
              factoryCity: p.factory_city,
              plantCode: p.factory_id,
              address: p.factory_address || '',
              requestor: p.requester,
              dateCreated: p.request_date,
              deliveryCommittedBy: p.required_by_date,
              costCenter: p.cost_center,
              bottleLinesCount: 20,
              cartonLinesCount: 10,
              totalQuantity: p.total_quantity,
              estimatedBudget: p.calculated_budget || p.estimated_budget,
            }))
          );
          setPrLoadState('ready');
        } else {
          setPrLoadState('error');
        }
      })
      .catch((err) => {
        console.error('Failed to load PRs from database:', err);
        setPrLoadState('error');
      });

    fetch('/api/rfx/lines')
      .then((r) => r.json())
      .then((data) => {
        if (data.lines && data.lines.length > 0) {
          setLines(
            data.lines.map((l: any) => ({
              id: l.rfx_line_id,
              skuCode: l.sku_code,
              category: l.category,
              name: l.item_name,
              sizeSpecification: l.size_specification,
              weightGramsOrGsm: l.weight_or_gsm,
              quantityBLR: l.quantity_blr,
              quantityCHN: l.quantity_chn,
              totalQuantity: l.total_quantity,
              uom: l.uom,
              baselineRate: l.baseline_rate,
            }))
          );
        }
      })
      .catch((err) => console.error('Failed to load RFx lines from database:', err));

  }, []);

  // Filter Purchase Requests Table
  const filteredPrs = prs.filter((pr) => {
    if (plantFilter === 'BLR' && !pr.factoryCity.toLowerCase().includes('bengaluru')) return false;
    if (plantFilter === 'CHN' && !pr.factoryCity.toLowerCase().includes('chennai')) return false;
    if (prSearch.trim()) {
      const q = prSearch.toLowerCase();
      return (
        pr.prNumber.toLowerCase().includes(q) ||
        pr.factoryName.toLowerCase().includes(q) ||
        pr.factoryCity.toLowerCase().includes(q) ||
        pr.requestor.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Active PR object for single-PR lines view
  const activePrObj = prs.find((p) => p.id === selectedFocusedPr) || prs[0];

  // Filter Line Items using Product LOV (List of Values) for the selected PR
  const filteredSinglePrLines = lines.filter((item) => {
    // 1. LOV Filter
    if (productLovFilter === 'bottles' && item.category !== 'PET Bottles') return false;
    if (productLovFilter === 'cartons' && item.category !== 'Cartons') return false;
    if (productLovFilter !== 'all' && productLovFilter !== 'bottles' && productLovFilter !== 'cartons') {
      if (item.skuCode !== productLovFilter) return false;
    }

    // 2. Line search
    if (lineSearch.trim()) {
      const q = lineSearch.toLowerCase();
      return (
        item.skuCode.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.sizeSpecification.toLowerCase().includes(q)
      );
    }

    return true;
  });

  // Calculate volume and budget for selected single PR
  const singlePrVolume = filteredSinglePrLines.reduce((acc, curr) => {
    const qty = selectedFocusedPr === 'pr-blr' ? curr.quantityBLR : curr.quantityCHN;
    return acc + qty;
  }, 0);

  const singlePrSpend = filteredSinglePrLines.reduce((acc, curr) => {
    const qty = selectedFocusedPr === 'pr-blr' ? curr.quantityBLR : curr.quantityCHN;
    return acc + qty * curr.baselineRate;
  }, 0);

  const handleDownloadRfq = () => {
    window.location.href = '/api/rfq/excel';
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  if (!activePrObj) {
    return (
      <div className="bg-white border border-[#dfe5de] rounded-2xl p-8 text-sm text-[#20332e]">
        {prLoadState === 'error' ? 'Purchase requests could not be loaded. Refresh the page to try again.' : 'Loading purchase requests…'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Workspace Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dfe5de] pb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#235848]">
            Workspace 1 / 3 · Requisition Consolidation & RFQ Launch
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#20332e] mt-0.5">
            Purchase Requisitions Demand & RFQ Dispatch
          </h1>
          <p className="text-xs text-[#68766b] mt-1">
            Review individual factory requisitions, inspect line items per plant, and use Sourcing Copilot to consolidate multi-plant demand and dispatch RFQ.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadRfq}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#dfe5de] bg-white hover:bg-[#edf1eb] text-xs font-semibold text-[#20332e] transition-all shadow-xs"
          >
            {downloaded ? <Check className="w-3.5 h-3.5 text-[#235848]" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-[#235848]" />}
            <span>{downloaded ? 'Downloaded RFQ.xlsx' : 'Download Demand (.xlsx)'}</span>
          </button>

          <button
            onClick={onGoToNext}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#235848] hover:bg-[#1b4538] text-white text-xs font-semibold transition-all shadow-xs active:scale-98"
          >
            <span>Proceed to Supplier Inbox</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main 2-Column Layout: Left Side (7 cols: Enterprise Tables) + Right Side (5 cols: Sourcing Copilot) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Side: Tables (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* SECTION 1: Purchase Requisitions Table (NOT cards!) */}
          <div className="bg-white border border-[#dfe5de] rounded-2xl shadow-xs overflow-hidden">
            <div className="p-3.5 bg-[#edf1eb] border-b border-[#dfe5de] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#235848]" />
                <span className="text-xs font-bold text-[#20332e] uppercase tracking-wider">
                  Purchase Requisitions Queue ({filteredPrs.length})
                </span>
                <span className="text-[11px] text-[#68766b]">Click row to inspect PR lines</span>
              </div>

              {/* Plant Filter LOV & Search */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-bold text-[#68766b]">Facility:</span>
                  <select
                    value={plantFilter}
                    onChange={(e) => setPlantFilter(e.target.value as 'all' | 'BLR' | 'CHN')}
                    className="bg-white border border-[#dfe5de] rounded-lg px-2.5 py-1 text-xs font-semibold text-[#20332e] focus:outline-none focus:border-[#235848]"
                  >
                    <option value="all">All Facilities (Bengaluru &amp; Chennai)</option>
                    <option value="BLR">Bengaluru Facility (Whitefield Plant)</option>
                    <option value="CHN">Chennai Facility (Sriperumbudur Plant)</option>
                  </select>
                </div>

                <div className="relative w-36 hidden sm:block">
                  <Search className="w-3 h-3 text-[#68766b] absolute left-2.5 top-2" />
                  <input
                    type="text"
                    placeholder="Search PR..."
                    value={prSearch}
                    onChange={(e) => setPrSearch(e.target.value)}
                    className="w-full bg-white border border-[#dfe5de] rounded-lg pl-7 pr-2 py-1 text-[11px] text-[#20332e] focus:outline-none focus:border-[#235848]"
                  />
                </div>
              </div>
            </div>

            {/* PRs Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f5f6f2] text-[#68766b] font-semibold border-b border-[#dfe5de]">
                  <tr>
                    <th className="p-3">Requisition #</th>
                    <th className="p-3">Manufacturing Plant</th>
                    <th className="p-3">Requester</th>
                    <th className="p-3">Date / Need Date</th>
                    <th className="p-3 text-right">Items</th>
                    <th className="p-3 text-right font-bold text-[#20332e]">Est. Budget</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center">RFQ Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f3ef] text-[#20332e]">
                  {filteredPrs.map((pr) => {
                    const isFocused = selectedFocusedPr === pr.id;

                    return (
                      <tr 
                        key={pr.id} 
                        onClick={() => setSelectedFocusedPr(pr.id as 'pr-blr' | 'pr-chn')}
                        className={`hover:bg-[#fafbf9] cursor-pointer transition-colors ${
                          isFocused ? 'bg-[#edf1eb]/60 ring-1 ring-inset ring-[#235848]/30 font-medium' : ''
                        }`}
                      >
                        <td className="p-3 font-mono font-bold text-[#235848]">
                          {pr.prNumber}
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-[#20332e]">{pr.factoryName}</div>
                          <span className="text-[11px] text-[#68766b] flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-[#88988b]" />
                            {pr.factoryCity}
                          </span>
                        </td>
                        <td className="p-3 text-[#68766b] text-[11px]">
                          <div className="font-medium text-[#20332e] flex items-center gap-1">
                            <User className="w-3 h-3 text-[#88988b]" />
                            {pr.requestor.split(' ')[0]} {pr.requestor.split(' ')[1]}
                          </div>
                          <span className="text-[10px]">Operations Lead</span>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-[#68766b]">
                          <div>Req: {pr.dateCreated}</div>
                          <div className="text-[#20332e] font-semibold">Need: {pr.deliveryCommittedBy}</div>
                        </td>
                        <td className="p-3 text-right font-mono">
                          <span className="font-bold text-[#20332e]">{pr.bottleLinesCount + pr.cartonLinesCount} SKUs</span>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-[#235848]">
                          ₹{formatAmount(pr.estimatedBudget)}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                            Approved
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>Ready for RFQ</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Requisition Table Summary Footer */}
            <div className="p-3 bg-[#fafbf9] border-t border-[#dfe5de] flex flex-wrap items-center justify-between text-xs text-[#68766b] gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#20332e]">
                  Active Inspecting PR: <strong className="text-[#235848] font-mono">{activePrObj.prNumber}</strong> ({activePrObj.factoryCity})
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-[#235848] bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                <Sparkles className="w-3.5 h-3.5 text-[#235848]" />
                <span>Ask the Sourcing Copilot to prepare recipients from its supplier shortlist.</span>
              </div>
            </div>
          </div>

          {/* SECTION 2: Tabbed Details for Selected Purchase Request (Lines, Questionnaire, Payment/Delivery Terms, Specifications) */}
          <div className="bg-white border border-[#dfe5de] rounded-2xl shadow-xs overflow-hidden">
            <div className="p-3.5 bg-[#edf1eb] border-b border-[#dfe5de] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#235848]" />
                <div>
                  <span className="text-xs font-bold text-[#20332e] uppercase tracking-wider block">
                    Requisition Package: {activePrObj.prNumber} ({activePrObj.factoryCity.split(',')[0]})
                  </span>
                  <span className="text-[11px] text-[#68766b]">
                    Requester: {activePrObj.requestor} · Target Arrival: {activePrObj.deliveryCommittedBy}
                  </span>
                </div>
              </div>

              <div className="text-right text-[11px] text-[#68766b]">
                <span className="block font-semibold text-[#235848]">Viewing {activePrObj.prNumber}</span>
                <span>Select another row above to inspect its details</span>
              </div>
            </div>

            {/* 4 Detail Tabs */}
            <div className="flex items-center gap-1 border-b border-[#dfe5de] bg-[#f5f6f2] px-3 pt-2 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setPrDetailTab('lines')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition-all border-t border-x flex items-center gap-1.5 whitespace-nowrap ${
                  prDetailTab === 'lines'
                    ? 'bg-white text-[#235848] border-[#dfe5de] -mb-[1px] pb-2'
                    : 'bg-transparent text-[#68766b] border-transparent hover:text-[#20332e]'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>1. Lines ({filteredSinglePrLines.length} Items)</span>
              </button>
              <button
                type="button"
                onClick={() => setPrDetailTab('questionnaire')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition-all border-t border-x flex items-center gap-1.5 whitespace-nowrap ${
                  prDetailTab === 'questionnaire'
                    ? 'bg-white text-[#235848] border-[#dfe5de] -mb-[1px] pb-2'
                    : 'bg-transparent text-[#68766b] border-transparent hover:text-[#20332e]'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>2. Questionnaire (6 Sections)</span>
              </button>
              <button
                type="button"
                onClick={() => setPrDetailTab('terms')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition-all border-t border-x flex items-center gap-1.5 whitespace-nowrap ${
                  prDetailTab === 'terms'
                    ? 'bg-white text-[#235848] border-[#dfe5de] -mb-[1px] pb-2'
                    : 'bg-transparent text-[#68766b] border-transparent hover:text-[#20332e]'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>3. Payment and Delivery Terms</span>
              </button>
              <button
                type="button"
                onClick={() => setPrDetailTab('specifications')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition-all border-t border-x flex items-center gap-1.5 whitespace-nowrap ${
                  prDetailTab === 'specifications'
                    ? 'bg-white text-[#235848] border-[#dfe5de] -mb-[1px] pb-2'
                    : 'bg-transparent text-[#68766b] border-transparent hover:text-[#20332e]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>4. Specifications (Technical Standards)</span>
              </button>
            </div>

            {/* TAB 1: Lines */}
            {prDetailTab === 'lines' && (
              <div className="space-y-0 animate-fadeIn">
                {/* Product LOV Toolbar */}
                <div className="p-3 bg-[#fafbf9] border-b border-[#dfe5de] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-[#68766b]">Product LOV:</span>
                    <select
                      value={productLovFilter}
                      onChange={(e) => setProductLovFilter(e.target.value)}
                      className="bg-white border border-[#dfe5de] rounded-lg px-2.5 py-1 text-xs font-semibold text-[#20332e] focus:outline-none focus:border-[#235848]"
                    >
                      <option value="all">All Products (30 Items · Bottles &amp; Cartons)</option>
                      <option value="bottles">Product 1: PET Bottles (20 Size Variants · 60ml - 1000ml)</option>
                      <option value="cartons">Product 2: Cartons (10 RFQ Items)</option>
                      <optgroup label="Popular Specific Items">
                        <option value="BTL-009">BTL-009 · PET Bottle 500 ml</option>
                        <option value="BTL-008">BTL-008 · PET Bottle 500 ml</option>
                        <option value="BTL-001">BTL-001 · PET Bottle 60 ml</option>
                        <option value="CTN-003">CTN-003 · Carton for 24 × 500 ml bottles</option>
                        <option value="CTN-004">CTN-004 · Carton for 12 × 1000 ml bottles</option>
                      </optgroup>
                    </select>
                  </div>

                  <div className="relative w-40">
                    <Search className="w-3 h-3 text-[#68766b] absolute left-2.5 top-2" />
                    <input
                      type="text"
                      placeholder="Search SKU..."
                      value={lineSearch}
                      onChange={(e) => setLineSearch(e.target.value)}
                      className="w-full bg-white border border-[#dfe5de] rounded-lg pl-7 pr-2 py-1 text-[11px] text-[#20332e] focus:outline-none focus:border-[#235848]"
                    />
                  </div>
                </div>

                {/* Single PR Line Items Table */}
                <div className="max-h-[340px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#f5f6f2] text-[#68766b] font-semibold border-b border-[#dfe5de] sticky top-0 z-10">
                      <tr>
                        <th className="p-2.5">SKU Code</th>
                        <th className="p-2.5">Item Name &amp; Size Specification</th>
                        <th className="p-2.5">Category</th>
                        <th className="p-2.5 text-right">
                          {selectedFocusedPr === 'pr-blr' ? 'Bengaluru Qty' : 'Chennai Qty'}
                        </th>
                        <th className="p-2.5 text-right">Target Rate</th>
                        <th className="p-2.5 text-right font-bold text-[#235848]">Line Spend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f3ef] font-mono text-[#20332e]">
                      {filteredSinglePrLines.map((item) => {
                        const plantQty = selectedFocusedPr === 'pr-blr' ? item.quantityBLR : item.quantityCHN;
                        const lineCost = plantQty * item.baselineRate;

                        return (
                          <tr key={item.id} className="hover:bg-[#fafbf9]">
                            <td className="p-2.5 font-bold text-[#235848]">{item.skuCode}</td>
                            <td className="p-2.5 font-sans">
                              <div className="font-semibold text-[#20332e]">{item.name}</div>
                              <div className="text-[11px] text-[#68766b]">{item.sizeSpecification}</div>
                            </td>
                            <td className="p-2.5 font-sans">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                item.category === 'PET Bottles' 
                                  ? 'bg-blue-50 text-blue-800 border border-blue-200' 
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}>
                                {item.category === 'PET Bottles' ? 'Bottle' : 'Carton'}
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-bold text-[#20332e]">
                              {plantQty.toLocaleString()} EA
                            </td>
                            <td className="p-2.5 text-right font-semibold text-[#20332e]">
                              ₹{formatAmount(item.baselineRate)}
                            </td>
                            <td className="p-2.5 text-right font-bold text-[#235848]">
                              ₹{formatAmount(lineCost)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Line Table Summary Footer */}
                <div className="p-3 bg-[#fafbf9] border-t border-[#dfe5de] flex flex-wrap items-center justify-between text-xs text-[#68766b] gap-2">
                  <div className="flex items-center gap-3">
                    <span>{activePrObj.prNumber} Volume: <strong className="text-[#20332e] font-mono">{singlePrVolume.toLocaleString()} EA</strong></span>
                    <span>•</span>
                    <span>Subtotal Spend: <strong className="text-[#235848] font-mono">₹{formatAmount(singlePrSpend)}</strong></span>
                  </div>
                  <span className="text-[11px] text-[#68766b]">
                    Delivery Target: {activePrObj.deliveryCommittedBy}
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: Questionnaire */}
            {prDetailTab === 'questionnaire' && (
              <div className="p-4 bg-[#fafbf9] space-y-3 text-xs animate-fadeIn max-h-[380px] overflow-y-auto">
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 flex items-center justify-between">
                  <span className="font-semibold">Mandatory Vendor Compliance &amp; Audit Questionnaire</span>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-blue-200">Sheet: Vendor_Questionnaire</span>
                </div>

                <div className="space-y-2.5">
                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Q1. Food-Grade Laboratory Migration Certification</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">Mandatory Gate</span>
                    </div>
                    <p className="text-[#68766b] text-[11px]">
                      Are all supplied PET bottles and master resins certified under FSSAI / NABL food-contact migration test protocols with overall migration &lt; 10 mg/dm²? (Attach accredited lab test report within 6 months).
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Q2. Automated Monthly Blow-Molding &amp; Corrugation Capacity</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">Capacity SLA</span>
                    </div>
                    <p className="text-[#68766b] text-[11px]">
                      What is your dedicated monthly production capacity for the PET bottles and cartons listed in this RFQ? Can your facility meet the requested quantities without subcontracting?
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Q3. Tooling Fees &amp; Mold Amortization Policy</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">Commercial Term</span>
                    </div>
                    <p className="text-[#68766b] text-[11px]">
                      Does your quotation include complete tooling fee amortization across committed volumes, or will separate upfront mold charges apply? (Specify tooling waiver threshold terms).
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Q4. Quality Rejection &amp; Replacement Turnaround</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200">Quality SLA</span>
                    </div>
                    <p className="text-[#68766b] text-[11px]">
                      In case of dimensional variance (weight +/- 0.5g deviation or neck finish non-conformance), do you contractually agree to replace rejected consignments within 48 hours at your expense?
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Q5. Corrugated Bursting Strength &amp; Fluting Spec</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">Packaging Spec</span>
                    </div>
                    <p className="text-[#68766b] text-[11px]">
                      Confirm that all corrugated cases use 150+ GSM kraft paper with minimum 12.0 kg/cm² bursting factor and moisture resistance for cold room storage.
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Q6. Business Continuity &amp; Dual Facility Backup</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">Resilience</span>
                    </div>
                    <p className="text-[#68766b] text-[11px]">
                      Do you maintain secondary manufacturing lines or partner plants in South India capable of fulfilling orders in the event of equipment downtime or grid outages?
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Payment and Delivery Terms */}
            {prDetailTab === 'terms' && (
              <div className="p-4 bg-[#fafbf9] space-y-3 text-xs animate-fadeIn max-h-[380px] overflow-y-auto">
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 flex items-center justify-between">
                  <span className="font-semibold">Commercial Payment &amp; Logistics Delivery Terms</span>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-emerald-200">Corporate Sourcing Policy</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1">
                    <span className="text-[10px] text-[#68766b] font-bold uppercase tracking-wider">Payment Credit Terms</span>
                    <div className="text-sm font-bold text-[#20332e]">Net 45 Days</div>
                    <p className="text-[11px] text-[#68766b]">
                      Payable 45 days from invoice date and receipt/quality inspection acceptance at plant dock. Upfront cash advances are strictly prohibited by procurement policy.
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1">
                    <span className="text-[10px] text-[#68766b] font-bold uppercase tracking-wider">Incoterms 2020</span>
                    <div className="text-sm font-bold text-[#20332e]">DDP (Delivered Duty Paid)</div>
                    <p className="text-[11px] text-[#68766b]">
                      Delivered directly to designated plant receiving docks. Quoted freight must be clearly itemized per delivery destination (Bengaluru vs Chennai).
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1">
                    <span className="text-[10px] text-[#68766b] font-bold uppercase tracking-wider">Delivery SLA &amp; OTIF Target</span>
                    <div className="text-sm font-bold text-emerald-800 font-mono">≥ 95.0% OTIF SLA</div>
                    <p className="text-[11px] text-[#68766b]">
                      Vendors must maintain on-time in-full delivery compliance. Late shipments are subject to liquidated damages of 0.5% per week of delay (capped at 5%).
                    </p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-1">
                    <span className="text-[10px] text-[#68766b] font-bold uppercase tracking-wider">Receiving Facility &amp; Dock Hours</span>
                    <div className="text-sm font-bold text-[#20332e]">{activePrObj.factoryCity}</div>
                    <p className="text-[11px] text-[#68766b]">
                      Receiving dock operational Mon - Sat, 08:00 AM - 06:00 PM IST. Delivery appointments must be booked 24 hours prior to dispatch.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: Specifications */}
            {prDetailTab === 'specifications' && (
              <div className="p-4 bg-[#fafbf9] space-y-3 text-xs animate-fadeIn max-h-[380px] overflow-y-auto">
                <div className="p-2.5 bg-purple-50 border border-purple-200 rounded-xl text-purple-900 flex items-center justify-between">
                  <span className="font-semibold">Packaging Technical Engineering Specifications</span>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-purple-200">Approved Quality Standards</span>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-2">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Group 1: Food-Grade PET Containers (20 SKUs)</span>
                      <span className="text-[10px] font-mono text-[#235848]">60 ml - 1000 ml Formats</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Raw Material</span>
                        <strong className="text-[#20332e]">100% Virgin Food-Grade PET</strong>
                      </div>
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Neck Finish</span>
                        <strong className="text-[#20332e]">28mm PCO 1810 / Alaska</strong>
                      </div>
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Weight Tolerances</span>
                        <strong className="text-[#20332e]">± 0.5 grams</strong>
                      </div>
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Migration Limit</span>
                        <strong className="text-emerald-800">&lt; 10 mg/dm² (IS 9845)</strong>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#dfe5de] space-y-2">
                    <div className="flex items-center justify-between font-bold text-[#20332e]">
                      <span>Group 2: Corrugated Shipping Cartons (10 Formats)</span>
                      <span className="text-[10px] font-mono text-[#235848]">5-Ply Heavy Duty Shippers</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Board Construction</span>
                        <strong className="text-[#20332e]">5-Ply Kraft Fluting</strong>
                      </div>
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Bursting Strength</span>
                        <strong className="text-[#20332e]">Min 12.5 kg/cm² (IS 2771)</strong>
                      </div>
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Edge Crush (ECT)</span>
                        <strong className="text-[#20332e]">Min 6.5 kN/m</strong>
                      </div>
                      <div className="p-2 bg-[#fafbf9] rounded border border-[#dfe5de]">
                        <span className="text-[10px] text-[#68766b] block">Marking / Printing</span>
                        <strong className="text-[#20332e]">2-Color Flexo + QR Trace</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Sourcing Copilot for Knowledge Work & Consolidated List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          {/* Live Procure Chat Copilot Component */}
          <ProcureChat 
            workspace="prs" 
            onConsolidationGenerated={() => {
              setHasInteractedWithCopilot(true);
            }}
          />
        </div>
      </div>
    </div>
  );
};
