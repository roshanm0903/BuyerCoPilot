import React from 'react';
import { ProcureChat } from './ProcureChat';

interface Workspace3Props {
  onGoToPrev: () => void;
  onGoToFirst: () => void;
}

export const Workspace3AwardStudio: React.FC<Workspace3Props> = ({ onGoToPrev }) => (
  <div className="space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#dfe5de] pb-4">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-[#235848]">Workspace 3 / 3 · Buying Decision</span>
        <h1 className="text-2xl font-serif font-bold text-[#20332e] mt-0.5">Award Studio</h1>
        <p className="text-xs text-[#68766b] mt-1">Ask the copilot to compare quotes, test allocations, check constraints, and explain an award recommendation.</p>
      </div>
      <button
        onClick={onGoToPrev}
        className="px-3.5 py-2 rounded-xl border border-[#dfe5de] bg-white text-xs font-semibold text-[#68766b] hover:text-[#20332e] transition-all"
      >
        ← Supplier Inbox
      </button>
    </div>
    <ProcureChat workspace="award" />
  </div>
);
