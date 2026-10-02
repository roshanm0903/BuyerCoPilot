import React, { useState, useEffect } from 'react';
import { formatAmount } from '../utils/formatAmount';
import { 
  Database, 
  Search, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Edit2, 
  Trash2, 
  Check, 
  X, 
  RefreshCw, 
  Table, 
  ShieldCheck, 
  Layers, 
  FileText,
  AlertCircle
} from 'lucide-react';

interface DatabaseVisualizerProps {
  onClose?: () => void;
}

const TABLES = [
  { id: 'items', name: 'Items (Item Master)', pk: 'item_id' },
  { id: 'item_specifications', name: 'Item Specifications', pk: 'spec_id' },
  { id: 'purchase_request_lines', name: 'Purchase Request Lines', pk: 'line_id' },
  { id: 'rfx_lines', name: 'RFx Lines', pk: 'rfx_line_id' },
  { id: 'quotes', name: 'Quotes', pk: 'quote_id' },
  { id: 'quote_lines', name: 'Quote Lines', pk: 'quote_line_id' },
  { id: 'field_assessments', name: 'Field Assessments', pk: 'assessment_id' },
  { id: 'suppliers', name: 'Suppliers (Vendor Master)', pk: 'supplier_id' },
  { id: 'supplier_categories', name: 'Supplier Categories (Mapping)', pk: 'id' },
  { id: 'supplier_products', name: 'Supplier Products (SKU Mapping)', pk: 'id' },
  { id: 'supplier_performance', name: 'Supplier Performance (OTIF)', pk: 'performance_id' },
  { id: 'factories', name: 'Factories', pk: 'factory_id' },
  { id: 'purchase_requests', name: 'Purchase Requests', pk: 'pr_id' },
  { id: 'attachments', name: 'Attachments', pk: 'attachment_id' },
];

const MONETARY_COLUMNS = new Set([
  'estimated_budget', 'baseline_rate', 'estimated_spend', 'stated_total_amount',
  'calculated_total_amount', 'amount_variance', 'unit_price',
  'normalized_unit_price', 'line_total_amount', 'amount', 'total_spend',
  'baseline_spend', 'savings',
]);

export const DatabaseVisualizer: React.FC<DatabaseVisualizerProps> = ({ onClose }) => {
  const [selectedTable, setSelectedTable] = useState<string>('items');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Inline edit state
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, any>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const activeTableMeta = TABLES.find((t) => t.id === selectedTable) || TABLES[0];
  const pk = activeTableMeta.pk;

  useEffect(() => {
    fetchTableData(selectedTable);
  }, [selectedTable]);

  const fetchTableData = async (tableName: string) => {
    setLoading(true);
    setEditingRowKey(null);
    try {
      const res = await fetch(`/api/db/table/${tableName}`);
      if (res.ok) {
        const data = await res.json();
        setColumns(data.columns || []);
        setRows(data.rows || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const startEdit = (row: any) => {
    setEditingRowKey(row[pk]);
    setEditFormData({ ...row });
  };

  const cancelEdit = () => {
    setEditingRowKey(null);
    setEditFormData({});
  };

  const saveEdit = async () => {
    if (!editingRowKey) return;

    try {
      const updates = { ...editFormData };
      delete updates[pk]; // don't update primary key

      const res = await fetch('/api/db/row', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: selectedTable,
          primaryKey: pk,
          primaryKeyValue: editingRowKey,
          updates,
        }),
      });

      if (res.ok) {
        setActionMessage(`Updated row in ${selectedTable}`);
        setTimeout(() => setActionMessage(null), 3000);
        setEditingRowKey(null);
        fetchTableData(selectedTable);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteRow = async (keyValue: any) => {
    if (!confirm(`Are you sure you want to delete this row from ${selectedTable}?`)) return;

    try {
      const res = await fetch('/api/db/row', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: selectedTable,
          primaryKey: pk,
          primaryKeyValue: keyValue,
        }),
      });

      if (res.ok) {
        setActionMessage(`Deleted row from ${selectedTable}`);
        setTimeout(() => setActionMessage(null), 3000);
        fetchTableData(selectedTable);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Filter & sort rows
  const filteredRows = rows
    .filter((row) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return Object.values(row).some(
        (val) => val !== null && val !== undefined && String(val).toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (!sortCol) return 0;
      const valA = a[sortCol];
      const valB = b[sortCol];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      if (sortDir === 'asc') {
        return valA > valB ? 1 : -1;
      } else {
        return valA < valB ? 1 : -1;
      }
    });

  return (
    <div className="bg-white border border-[#dfe5de] rounded-2xl shadow-xs overflow-hidden flex flex-col h-[700px]">
      {/* Top Header */}
      <div className="p-4 bg-[#edf1eb] border-b border-[#dfe5de] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-[#235848] text-white">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[#20332e]">SQLite Database Visualizer</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-[#235848] font-bold border border-[#dfe5de]">
                Embedded SQLite
              </span>
            </div>
            <p className="text-[11px] text-[#68766b]">
              Inspect, search, sort, update, and delete procurement database records in real-time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchTableData(selectedTable)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#dfe5de] bg-white text-xs font-semibold text-[#20332e] hover:bg-[#f5f6f2] transition-all shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#235848] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-[#68766b] hover:text-[#20332e] hover:bg-white border border-transparent hover:border-[#dfe5de] transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table Selector Tabs */}
      <div className="p-2.5 bg-[#f5f6f2] border-b border-[#dfe5de] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {TABLES.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setSelectedTable(t.id);
              setSearchQuery('');
              setSortCol(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              selectedTable === t.id
                ? 'bg-white text-[#235848] shadow-xs border border-[#dfe5de]'
                : 'text-[#68766b] hover:text-[#20332e] hover:bg-white/50'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      {/* Search Bar & Feedback Banner */}
      <div className="p-3 bg-white border-b border-[#dfe5de] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#68766b] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder={`Filter ${filteredRows.length} rows in ${activeTableMeta.name}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#f5f6f2] border border-[#dfe5de] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#20332e] focus:outline-none focus:border-[#235848]"
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-[#68766b]">
          {actionMessage && (
            <span className="text-[#235848] font-semibold bg-[#edf1eb] px-2.5 py-1 rounded-lg border border-[#235848]/20 animate-fadeIn">
              ✓ {actionMessage}
            </span>
          )}
          <span className="font-mono">
            Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> rows
          </span>
        </div>
      </div>

      {/* Table Data View */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-[#f5f6f2] text-[#68766b] font-semibold border-b border-[#dfe5de] sticky top-0 z-10 shadow-xs">
            <tr>
              <th className="p-3 w-16 text-center">Actions</th>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="p-3 font-mono cursor-pointer hover:text-[#20332e] select-none whitespace-nowrap"
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col}</span>
                    {sortCol === col ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="w-3 h-3 text-[#235848]" />
                      ) : (
                        <ArrowDown className="w-3 h-3 text-[#235848]" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f3ef]">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-8 text-center text-[#68766b]">
                  {loading ? 'Loading table data...' : 'No records found in this table.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isEditing = editingRowKey === row[pk];

                return (
                  <tr
                    key={row[pk] || Math.random()}
                    className={`hover:bg-[#fafbf9] transition-colors ${
                      isEditing ? 'bg-amber-50/50' : ''
                    }`}
                  >
                    {/* Action buttons: Edit & Delete */}
                    <td className="p-2.5 text-center whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={saveEdit}
                            className="p-1 rounded-md bg-[#235848] text-white hover:bg-[#1b4538]"
                            title="Save changes"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => startEdit(row)}
                            className="p-1 rounded-md hover:bg-[#edf1eb] text-[#68766b] hover:text-[#235848]"
                            title="Edit row"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteRow(row[pk])}
                            className="p-1 rounded-md hover:bg-rose-50 text-[#68766b] hover:text-rose-600"
                            title="Delete row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Column Cells */}
                    {columns.map((col) => {
                      const val = row[col];
                      const isPrimaryKey = col === pk;

                      if (isEditing && !isPrimaryKey) {
                        return (
                          <td key={col} className="p-2">
                            <input
                              type="text"
                              value={editFormData[col] !== undefined ? editFormData[col] : ''}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, [col]: e.target.value })
                              }
                              className="w-full bg-white border border-[#235848] rounded px-2 py-1 text-xs text-[#20332e] focus:outline-none"
                            />
                          </td>
                        );
                      }

                      // Badge rendering for confidence status
                      if (col === 'status' && (val === 'confident' || val === 'needs_confirmation' || val === 'missing_needs_follow_up')) {
                        return (
                          <td key={col} className="p-3">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                val === 'confident'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : val === 'needs_confirmation'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {val}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col}
                          className={`p-3 max-w-xs truncate ${
                            isPrimaryKey ? 'font-mono font-bold text-[#235848]' : 'text-[#20332e]'
                          }`}
                          title={String(val || '')}
                        >
                          {val === null || val === undefined ? (
                            <span className="text-gray-400 italic">null</span>
                          ) : (
                            MONETARY_COLUMNS.has(col) && typeof val === 'number'
                              ? `₹${formatAmount(val)}`
                              : String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Instructions */}
      <div className="p-3 bg-[#fafbf9] border-t border-[#dfe5de] flex items-center justify-between text-[11px] text-[#68766b]">
        <span>
          💡 Click any column header to sort • Click the ✏️ icon to edit any row inline • Click 🗑️ to delete
        </span>
        <span className="font-mono font-bold text-[#235848]">Primary Key: {pk}</span>
      </div>
    </div>
  );
};
