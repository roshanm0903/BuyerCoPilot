import initSqlJs, { Database } from 'sql.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    up: (db: Database) => {
      // Enable Foreign Keys
      db.run('PRAGMA foreign_keys = ON;');

      // 1. Factories
      db.run(`
        CREATE TABLE IF NOT EXISTS factories (
          factory_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          city TEXT NOT NULL,
          address TEXT NOT NULL,
          active INTEGER DEFAULT 1
        );
      `);

      // 2. Suppliers Master
      db.run(`
        CREATE TABLE IF NOT EXISTS suppliers (
          supplier_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          supplier_type TEXT NOT NULL,
          status TEXT NOT NULL,
          default_currency TEXT DEFAULT 'INR'
        );
      `);

      // 3. Item Catalog
      db.run(`
        CREATE TABLE IF NOT EXISTS item_catalog (
          item_id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          shape TEXT,
          volume_ml INTEGER,
          carton_format TEXT,
          active INTEGER DEFAULT 1
        );
      `);

      // 4. Item Specifications
      db.run(`
        CREATE TABLE IF NOT EXISTS item_specifications (
          spec_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          version TEXT DEFAULT 'V1',
          bottle_weight_g REAL,
          food_grade_requirement TEXT,
          neck_finish TEXT,
          carton_ply INTEGER,
          board_weight_g REAL,
          quality_criteria TEXT,
          status TEXT DEFAULT 'approved',
          FOREIGN KEY (item_id) REFERENCES item_catalog(item_id) ON DELETE CASCADE
        );
      `);

      // 5. Purchase Requests (PR Headers)
      db.run(`
        CREATE TABLE IF NOT EXISTS purchase_requests (
          pr_id TEXT PRIMARY KEY,
          pr_number TEXT NOT NULL UNIQUE,
          factory_id TEXT NOT NULL,
          request_date TEXT NOT NULL,
          required_by_date TEXT NOT NULL,
          status TEXT NOT NULL,
          requester TEXT NOT NULL,
          cost_center TEXT,
          estimated_budget REAL DEFAULT 0,
          FOREIGN KEY (factory_id) REFERENCES factories(factory_id)
        );
      `);

      // 6. Purchase Request Lines (Per-PR line items with quantities, baseline rates)
      db.run(`
        CREATE TABLE IF NOT EXISTS purchase_request_lines (
          line_id TEXT PRIMARY KEY,
          pr_id TEXT NOT NULL,
          sku_code TEXT NOT NULL,
          item_name TEXT NOT NULL,
          category TEXT NOT NULL,
          size_specification TEXT NOT NULL,
          weight_or_gsm TEXT,
          quantity INTEGER NOT NULL,
          uom TEXT DEFAULT 'EA',
          baseline_rate REAL NOT NULL,
          estimated_spend REAL NOT NULL,
          FOREIGN KEY (pr_id) REFERENCES purchase_requests(pr_id) ON DELETE CASCADE
        );
      `);

      // 7. RFx Master
      db.run(`
        CREATE TABLE IF NOT EXISTS rfxs (
          rfx_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          issue_date TEXT NOT NULL,
          due_date TEXT NOT NULL,
          currency TEXT DEFAULT 'INR',
          buyer_name TEXT NOT NULL,
          status TEXT NOT NULL
        );
      `);

      // 8. RFx Lines (The consolidated 30 sourcing lines)
      db.run(`
        CREATE TABLE IF NOT EXISTS rfx_lines (
          rfx_line_id TEXT PRIMARY KEY,
          rfx_id TEXT NOT NULL,
          sku_code TEXT NOT NULL,
          item_name TEXT NOT NULL,
          category TEXT NOT NULL,
          size_specification TEXT NOT NULL,
          weight_or_gsm TEXT,
          quantity_blr INTEGER DEFAULT 0,
          quantity_chn INTEGER DEFAULT 0,
          total_quantity INTEGER NOT NULL,
          uom TEXT DEFAULT 'EA',
          baseline_rate REAL NOT NULL,
          estimated_spend REAL NOT NULL,
          FOREIGN KEY (rfx_id) REFERENCES rfxs(rfx_id) ON DELETE CASCADE
        );
      `);

      // 9. Attachments
      db.run(`
        CREATE TABLE IF NOT EXISTS attachments (
          attachment_id TEXT PRIMARY KEY,
          message_id TEXT,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          document_type TEXT NOT NULL,
          processed_at TEXT NOT NULL,
          file_size_bytes INTEGER,
          file_content TEXT
        );
      `);

      // 10. Quotes
      db.run(`
        CREATE TABLE IF NOT EXISTS quotes (
          quote_id TEXT PRIMARY KEY,
          rfx_id TEXT NOT NULL,
          supplier_id TEXT NOT NULL,
          message_id TEXT,
          quote_number TEXT NOT NULL,
          quote_date TEXT NOT NULL,
          currency TEXT DEFAULT 'INR',
          stated_total_amount REAL,
          calculated_total_amount REAL,
          amount_variance REAL,
          valid_until TEXT,
          payment_terms_days INTEGER,
          freight_treatment TEXT NOT NULL,
          status TEXT NOT NULL,
          FOREIGN KEY (rfx_id) REFERENCES rfxs(rfx_id),
          FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        );
      `);

      // 11. Quote Lines
      db.run(`
        CREATE TABLE IF NOT EXISTS quote_lines (
          quote_line_id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL,
          rfx_line_id TEXT NOT NULL,
          item_name TEXT,
          raw_item_description TEXT NOT NULL,
          quoted_quantity INTEGER,
          quoted_uom TEXT,
          unit_price REAL NOT NULL,
          price_uom TEXT NOT NULL,
          normalized_unit_price REAL NOT NULL,
          normalized_uom TEXT DEFAULT 'EA',
          line_total_amount REAL,
          moq_quantity INTEGER,
          moq_uom TEXT DEFAULT 'EA',
          lead_time_days INTEGER,
          delivery_date TEXT,
          specification_status TEXT DEFAULT 'confirmed',
          FOREIGN KEY (quote_id) REFERENCES quotes(quote_id) ON DELETE CASCADE
        );
      `);

      // 12. Quote Delivery Costs (Freight)
      db.run(`
        CREATE TABLE IF NOT EXISTS quote_delivery_costs (
          delivery_cost_id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL,
          quote_line_id TEXT,
          factory_id TEXT,
          treatment TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT DEFAULT 'INR',
          basis TEXT,
          allocation_method TEXT,
          FOREIGN KEY (quote_id) REFERENCES quotes(quote_id) ON DELETE CASCADE,
          FOREIGN KEY (factory_id) REFERENCES factories(factory_id)
        );
      `);

      // 13. Field Assessments
      db.run(`
        CREATE TABLE IF NOT EXISTS field_assessments (
          assessment_id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL,
          quote_line_id TEXT,
          field_name TEXT NOT NULL,
          raw_value TEXT NOT NULL,
          normalized_value TEXT NOT NULL,
          status TEXT NOT NULL,
          reason TEXT,
          evidence_snippet TEXT,
          buyer_override TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (quote_id) REFERENCES quotes(quote_id) ON DELETE CASCADE
        );
      `);

      // 14. Supplier Performance
      db.run(`
        CREATE TABLE IF NOT EXISTS supplier_performance (
          performance_id TEXT PRIMARY KEY,
          supplier_id TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          received_deliveries INTEGER NOT NULL,
          on_time_deliveries INTEGER NOT NULL,
          otif_pct REAL NOT NULL,
          rejection_rate_pct REAL NOT NULL,
          notes TEXT,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
        );
      `);

      // 15. Quote Conversations
      db.run(`
        CREATE TABLE IF NOT EXISTS quote_conversations (
          conversation_id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          subject TEXT,
          message_text TEXT NOT NULL,
          action_type TEXT DEFAULT 'inquiry',
          FOREIGN KEY (quote_id) REFERENCES quotes(quote_id) ON DELETE CASCADE
        );
      `);

      // 16. Sourcing Scenarios
      db.run(`
        CREATE TABLE IF NOT EXISTS sourcing_scenarios (
          scenario_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tagline TEXT NOT NULL,
          is_recommended INTEGER DEFAULT 0,
          primary_supplier_id TEXT NOT NULL,
          primary_supplier_name TEXT NOT NULL,
          primary_share_percent REAL NOT NULL,
          secondary_supplier_id TEXT,
          secondary_supplier_name TEXT,
          secondary_share_percent REAL DEFAULT 0,
          total_spend REAL NOT NULL,
          baseline_spend REAL NOT NULL,
          savings REAL NOT NULL,
          savings_percent REAL NOT NULL,
          resilience_score REAL NOT NULL,
          notes_json TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: '002_indexes_and_integrity',
    up: (db: Database) => {
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_pr_lines_pr_id ON purchase_request_lines(pr_id);
        CREATE INDEX IF NOT EXISTS idx_pr_lines_sku ON purchase_request_lines(sku_code);
        CREATE INDEX IF NOT EXISTS idx_rfx_lines_rfx_id ON rfx_lines(rfx_id);
        CREATE INDEX IF NOT EXISTS idx_rfx_lines_sku ON rfx_lines(sku_code);
        CREATE INDEX IF NOT EXISTS idx_quotes_supplier ON quotes(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_quotes_rfx ON quotes(rfx_id);
        CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);
        CREATE INDEX IF NOT EXISTS idx_quote_lines_rfx_line ON quote_lines(rfx_line_id);
        CREATE INDEX IF NOT EXISTS idx_assessments_quote ON field_assessments(quote_id);
        CREATE INDEX IF NOT EXISTS idx_delivery_costs_quote ON quote_delivery_costs(quote_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_quote ON quote_conversations(quote_id);
        CREATE INDEX IF NOT EXISTS idx_perf_supplier ON supplier_performance(supplier_id);
      `);
    },
  },
  {
    version: 3,
    name: '003_seed_demo_data',
    up: (db: Database) => {
      // 1. Seed Factories
      db.run(`
        INSERT OR IGNORE INTO factories (factory_id, name, city, address) VALUES
        ('BLR', 'Bengaluru Packaging Facility (Whitefield Plant)', 'Bengaluru, Karnataka', 'Plot 42-B, EPIP Industrial Zone, Whitefield, Bengaluru - 560066'),
        ('CHN', 'Chennai Packaging Facility (Sriperumbudur Plant)', 'Chennai, Tamil Nadu', 'Survey 108/4, SIPCOT Industrial Park Phase II, Sriperumbudur, Chennai - 602105');
      `);

      // 2. Seed Suppliers
      db.run(`
        INSERT OR IGNORE INTO suppliers (supplier_id, name, code, supplier_type, status, default_currency) VALUES
        ('SUP-A', 'Allied PET Containers', 'ALLIED', 'Direct Bottle Manufacturer & Partner Cartons', 'active', 'INR'),
        ('SUP-B', 'PrimePack Containers Limited', 'PRIMEPACK', 'Automated Bottle & Carton Manufacturer', 'active', 'INR'),
        ('SUP-C', 'Chennai Cartons', 'CHENNAI_CTN', 'Specialized Carton Producer & Traded Bottles', 'active', 'INR'),
        ('SUP-D', 'Metro Packaging Traders', 'METRO', 'Emergency Response Packaging Trader', 'active', 'INR'),
        ('SUP-E', 'SouthPack Industries', 'SOUTHPACK', 'Regional Packaging Manufacturer', 'disqualified', 'INR'),
        ('SUP-F', 'Crystal PET India', 'CRYSTAL', 'High-Reliability Direct Manufacturer Network', 'active', 'INR');
      `);

      // 3. Seed Purchase Requests
      db.run(`
        INSERT OR IGNORE INTO purchase_requests (pr_id, pr_number, factory_id, request_date, required_by_date, status, requester, cost_center, estimated_budget) VALUES
        ('pr-blr', 'PR-BLR-1088', 'BLR', '2026-09-12', '2026-10-25', 'approved', 'Ramesh K. (Bengaluru Operations Lead)', 'CC-BLR-PKG-01', 3820000),
        ('pr-chn', 'PR-CHN-1045', 'CHN', '2026-09-15', '2026-10-25', 'approved', 'Srinivasan M. (Chennai Operations Lead)', 'CC-CHN-PKG-02', 3260000);
      `);

      // 4. Seed RFx Master
      db.run(`
        INSERT OR IGNORE INTO rfxs (rfx_id, title, issue_date, due_date, currency, buyer_name, status) VALUES
        ('RFQ-2026-041', 'A2B Foods Annual Packaging Requirements (PR-BLR-1088 & PR-CHN-1045)', '2026-09-18', '2026-09-30', 'INR', 'Strategic Sourcing Team', 'evaluation');
      `);

      // 5. Seed 30 Line Items into RFx Lines and PR Lines
      const items = [
        { sku: 'BTL-001', name: 'PET Bottle 60 ml Round', cat: 'PET Bottles', spec: '60 ml (14g, 28mm PCO 1810)', w: '14g', blr: 35000, chn: 30000, rate: 1.85 },
        { sku: 'BTL-002', name: 'PET Bottle 100 ml Round', cat: 'PET Bottles', spec: '100 ml (16g, 28mm PCO 1810)', w: '16g', blr: 40000, chn: 35000, rate: 2.10 },
        { sku: 'BTL-003', name: 'PET Bottle 150 ml Oval', cat: 'PET Bottles', spec: '150 ml (18g, 28mm Neck)', w: '18g', blr: 25000, chn: 20000, rate: 2.35 },
        { sku: 'BTL-004', name: 'PET Bottle 200 ml Square', cat: 'PET Bottles', spec: '200 ml (21g, 28mm PCO)', w: '21g', blr: 50000, chn: 45000, rate: 2.55 },
        { sku: 'BTL-005', name: 'PET Bottle 250 ml Round', cat: 'PET Bottles', spec: '250 ml (23g, 28mm Neck)', w: '23g', blr: 60000, chn: 50000, rate: 2.75 },
        { sku: 'BTL-006', name: 'PET Bottle 300 ml Cylinder', cat: 'PET Bottles', spec: '300 ml (24g, 28mm Neck)', w: '24g', blr: 30000, chn: 25000, rate: 2.85 },
        { sku: 'BTL-007', name: 'PET Bottle 350 ml Oval', cat: 'PET Bottles', spec: '350 ml (26g, 28mm PCO)', w: '26g', blr: 20000, chn: 20000, rate: 2.95 },
        { sku: 'BTL-008', name: 'PET Bottle 500 ml Standard Mineral', cat: 'PET Bottles', spec: '500 ml (19g Lightweight, 28mm Alaska)', w: '19g', blr: 70000, chn: 60000, rate: 3.10 },
        { sku: 'BTL-009', name: 'PET Bottle 500 ml Heavy Duty Hot-Fill', cat: 'PET Bottles', spec: '500 ml (28g Hot-Fill Grade, 38mm Neck)', w: '28g', blr: 65000, chn: 50000, rate: 3.45 },
        { sku: 'BTL-010', name: 'PET Bottle 600 ml Round', cat: 'PET Bottles', spec: '600 ml (25g, 28mm PCO)', w: '25g', blr: 45000, chn: 40000, rate: 3.25 },
        { sku: 'BTL-011', name: 'PET Bottle 750 ml Square', cat: 'PET Bottles', spec: '750 ml (30g, 28mm PCO)', w: '30g', blr: 35000, chn: 30000, rate: 3.65 },
        { sku: 'BTL-012', name: 'PET Bottle 1000 ml Standard Round', cat: 'PET Bottles', spec: '1000 ml (32g, 28mm PCO 1881)', w: '32g', blr: 80000, chn: 70000, rate: 4.20 },
        { sku: 'BTL-013', name: 'PET Bottle 1000 ml Wide Mouth Jar', cat: 'PET Bottles', spec: '1000 ml (45g, 63mm Lug Finish)', w: '45g', blr: 40000, chn: 35000, rate: 4.85 },
        { sku: 'BTL-014', name: 'PET Bottle 1250 ml Round', cat: 'PET Bottles', spec: '1250 ml (38g, 28mm PCO)', w: '38g', blr: 30000, chn: 25000, rate: 4.60 },
        { sku: 'BTL-015', name: 'PET Bottle 1500 ml Standard', cat: 'PET Bottles', spec: '1500 ml (42g, 28mm Alaska)', w: '42g', blr: 55000, chn: 45000, rate: 5.10 },
        { sku: 'BTL-016', name: 'PET Bottle 2000 ml Handle Container', cat: 'PET Bottles', spec: '2000 ml (58g with Integral Handle)', w: '58g', blr: 35000, chn: 30000, rate: 6.40 },
        { sku: 'BTL-017', name: 'PET Bottle 2500 ml Jar', cat: 'PET Bottles', spec: '2500 ml (72g, 83mm Neck)', w: '72g', blr: 20000, chn: 15000, rate: 7.80 },
        { sku: 'BTL-018', name: 'PET Bottle 3000 ml Industrial', cat: 'PET Bottles', spec: '3000 ml (85g, 38mm Ratchet Cap)', w: '85g', blr: 15000, chn: 12000, rate: 8.90 },
        { sku: 'BTL-019', name: 'PET Bottle 4000 ml Dispenser Jar', cat: 'PET Bottles', spec: '4000 ml (110g, 100mm Neck Finish)', w: '110g', blr: 12000, chn: 10000, rate: 11.20 },
        { sku: 'BTL-020', name: 'PET Bottle 5000 ml Canister Bulk', cat: 'PET Bottles', spec: '5000 ml (135g Heavy-Duty Canister)', w: '135g', blr: 18000, chn: 15000, rate: 13.50 },
        // CARTONS
        { sku: 'CTN-001', name: 'Carton 24 x 60ml Small Shipper', cat: 'Cartons', spec: '24 x 60ml Master Shipper (3-ply B-flute, 140 GSM)', w: '140 GSM', blr: 35000, chn: 30000, rate: 14.50 },
        { sku: 'CTN-002', name: 'Carton 24 x 200ml Shipper (3-ply)', cat: 'Cartons', spec: '24 x 200ml Shipper (3-ply C-flute, 150 GSM)', w: '150 GSM', blr: 45000, chn: 40000, rate: 18.20 },
        { sku: 'CTN-003', name: 'Carton 24 x 500ml Master Shipper (5-ply)', cat: 'Cartons', spec: '24 x 500ml Heavy Master (5-ply BC-flute, 180 GSM Kraft)', w: '180 GSM', blr: 50000, chn: 45000, rate: 22.80 },
        { sku: 'CTN-004', name: 'Carton 12 x 1000ml Master Shipper', cat: 'Cartons', spec: '12 x 1000ml Master Shipper (5-ply 180 GSM, High BF)', w: '180 GSM', blr: 55000, chn: 48000, rate: 25.50 },
        { sku: 'CTN-005', name: 'Carton 6 x 2000ml Heavy Shipper', cat: 'Cartons', spec: '6 x 2000ml Heavy Duty (5-ply Double Wall 200 GSM)', w: '200 GSM', blr: 30000, chn: 25000, rate: 29.00 },
        { sku: 'CTN-006', name: 'Carton 4 x 5000ml Bulk Shipper', cat: 'Cartons', spec: '4 x 5000ml Industrial Shipper (7-ply Heavy Duty, 220 GSM)', w: '220 GSM', blr: 15000, chn: 12000, rate: 38.50 },
        { sku: 'CTN-007', name: 'Duplex Mono Carton 500ml Retail', cat: 'Cartons', spec: 'Single Bottle Retail Box (350 GSM Grey Back Duplex Board)', w: '350 GSM', blr: 70000, chn: 60000, rate: 4.80 },
        { sku: 'CTN-008', name: 'Duplex Mono Carton 1000ml Retail', cat: 'Cartons', spec: 'Single Bottle Retail Box (400 GSM FBB Virgin Board)', w: '400 GSM', blr: 60000, chn: 50000, rate: 6.20 },
        { sku: 'CTN-009', name: 'Carton Premium Display Outer Box', cat: 'Cartons', spec: '4-Color Offset Printed Counter Display Box (450 GSM White Top)', w: '450 GSM', blr: 25000, chn: 20000, rate: 16.50 },
        { sku: 'CTN-010', name: 'Carton Festive Gift Pack 4-Bottle Outer', cat: 'Cartons', spec: 'Gold Foil Stamped Window Gift Outer Box (500 GSM Rigid Board)', w: '500 GSM', blr: 20000, chn: 18000, rate: 28.00 },
      ];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const totalQty = item.blr + item.chn;
        const totalSpend = Math.round(totalQty * item.rate);
        const blrSpend = Math.round(item.blr * item.rate);
        const chnSpend = Math.round(item.chn * item.rate);

        // Insert into rfx_lines
        db.run(
          `INSERT OR IGNORE INTO rfx_lines (rfx_line_id, rfx_id, sku_code, item_name, category, size_specification, weight_or_gsm, quantity_blr, quantity_chn, total_quantity, uom, baseline_rate, estimated_spend)
           VALUES (?, 'RFQ-2026-041', ?, ?, ?, ?, ?, ?, ?, ?, 'EA', ?, ?)`,
          [`RFX-L-${item.sku}`, item.sku, item.name, item.cat, item.spec, item.w, item.blr, item.chn, totalQty, item.rate, totalSpend]
        );

        // Insert into PR-BLR lines
        db.run(
          `INSERT OR IGNORE INTO purchase_request_lines (line_id, pr_id, sku_code, item_name, category, size_specification, weight_or_gsm, quantity, uom, baseline_rate, estimated_spend)
           VALUES (?, 'pr-blr', ?, ?, ?, ?, ?, ?, 'EA', ?, ?)`,
          [`PR-BLR-${item.sku}`, item.sku, item.name, item.cat, item.spec, item.w, item.blr, item.rate, blrSpend]
        );

        // Insert into PR-CHN lines
        db.run(
          `INSERT OR IGNORE INTO purchase_request_lines (line_id, pr_id, sku_code, item_name, category, size_specification, weight_or_gsm, quantity, uom, baseline_rate, estimated_spend)
           VALUES (?, 'pr-chn', ?, ?, ?, ?, ?, ?, 'EA', ?, ?)`,
          [`PR-CHN-${item.sku}`, item.sku, item.name, item.cat, item.spec, item.w, item.chn, item.rate, chnSpend]
        );
      }

      // 6. Seed Supplier Performance
      db.run(`
        INSERT OR IGNORE INTO supplier_performance (performance_id, supplier_id, category, period_start, period_end, received_deliveries, on_time_deliveries, otif_pct, rejection_rate_pct, notes) VALUES
        ('PERF-A', 'SUP-A', 'Bottles and cartons', '2025-10-01', '2026-08-31', 100, 94, 94.0, 4.0, 'Historical dimensional issues; evaluate current evidence separately'),
        ('PERF-B', 'SUP-B', 'Bottles and cartons', '2025-10-01', '2026-08-31', 100, 97, 97.0, 2.0, 'Volume-discount alternative with high throughput'),
        ('PERF-C', 'SUP-C', 'Cartons and traded bottles', '2025-10-01', '2026-08-31', 100, 96, 96.0, 1.0, 'Good carton history; does not qualify PET automatically'),
        ('PERF-D', 'SUP-D', 'Traded packaging', '2025-10-01', '2026-08-31', 50, 49, 98.0, 2.0, 'Emergency response median 24 hours across 8 requests'),
        ('PERF-E', 'SUP-E', 'Bottles and cartons', '2025-10-01', '2026-08-31', 100, 88, 88.0, 3.0, 'Seasonal delivery risk. Food contact report FAIL'),
        ('PERF-F', 'SUP-F', 'Bottles and cartons', '2025-10-01', '2026-08-31', 100, 99, 99.0, 0.0, 'Strong recorded delivery history (99% OTIF)');
      `);

      // 7. Seed Demo Attachments
      db.run(`
        INSERT OR IGNORE INTO attachments (attachment_id, filename, mime_type, document_type, processed_at, file_size_bytes) VALUES
        ('ATT-ALLIED-001', 'allied-clarification-reply.md', 'text/markdown', 'clarification_reply', '2026-09-29T10:30:00Z', 1240),
        ('ATT-PRIMEPACK-001', 'supplier-b-commercial-supplement.md', 'text/markdown', 'commercial_supplement', '2026-09-28T14:15:00Z', 1580),
        ('ATT-CRYSTAL-001', 'supplier-f-submission-supplement.md', 'text/markdown', 'master_quote', '2026-09-28T15:30:00Z', 2150),
        ('ATT-METRO-001', 'metro-packaging-quote.txt', 'text/plain', 'rate_card', '2026-09-28T11:00:00Z', 850),
        ('ATT-SOUTHPACK-001', 'southpack-quote.txt', 'text/plain', 'quote', '2026-09-28T16:00:00Z', 920);
      `);

      // 8. Seed Demo Quotes
      db.run(`
        INSERT OR IGNORE INTO quotes (quote_id, rfx_id, supplier_id, message_id, quote_number, quote_date, currency, stated_total_amount, calculated_total_amount, amount_variance, valid_until, payment_terms_days, freight_treatment, status) VALUES
        ('QTE-SUP-A', 'RFQ-2026-041', 'SUP-A', 'ATT-ALLIED-001', 'ALL-Q-2026-041-REV2', '2026-09-29', 'INR', 1770500, 1818500, 48000, '2026-10-28', 45, 'separate_line', 'extracted'),
        ('QTE-SUP-B', 'RFQ-2026-041', 'SUP-B', 'ATT-PRIMEPACK-001', 'PCL 2026 041', '2026-09-28', 'INR', 1906100, 1906100, 0, '2026-10-19', 30, 'separate_line', 'extracted'),
        ('QTE-SUP-D', 'RFQ-2026-041', 'SUP-D', 'ATT-METRO-001', 'MTR-RFQ-5520', '2026-09-28', 'INR', NULL, NULL, NULL, '2026-10-28', 30, 'not_stated', 'incomplete'),
        ('QTE-SUP-E', 'RFQ-2026-041', 'SUP-E', 'ATT-SOUTHPACK-001', 'SP-2026-009', '2026-09-28', 'INR', NULL, NULL, NULL, NULL, 0, 'extra', 'disqualified'),
        ('QTE-SUP-F', 'RFQ-2026-041', 'SUP-F', 'ATT-CRYSTAL-001', 'CRY-Q-2026-041', '2026-09-28', 'INR', 1842250, 1842250, 0, '2026-10-28', 45, 'included', 'extracted');
      `);

      // 9. Seed Demo Quote Lines
      db.run(`
        INSERT OR IGNORE INTO quote_lines (quote_line_id, quote_id, rfx_line_id, item_name, raw_item_description, quoted_quantity, quoted_uom, unit_price, price_uom, normalized_unit_price, normalized_uom, line_total_amount, moq_quantity, lead_time_days, specification_status) VALUES
        ('QL-A-1', 'QTE-SUP-A', 'RFX-L-BTL-009', 'PET Bottle 500 ml Heavy Duty Hot-Fill', 'PET Bottle 500 ml Heavy Duty Hot-Fill (revised)', 115000, 'EA', 3.30, 'EA', 3.30, 'EA', 379500, 10000, 25, 'confirmed'),
        ('QL-A-2', 'QTE-SUP-A', 'RFX-L-BTL-008', 'PET Bottle 500 ml Standard Mineral', 'PET Bottle 500 ml Standard Mineral', 130000, 'EA', 3.05, 'EA', 3.05, 'EA', 396500, 10000, 25, 'confirmed'),
        ('QL-A-3', 'QTE-SUP-A', 'RFX-L-CTN-003', 'Carton 24 x 500ml Master Shipper (5-ply)', 'Carton 24 x 500ml Master Shipper (5-ply)', 45000, 'EA', 22.10, 'EA', 22.10, 'EA', 994500, 5000, 20, 'confirmed'),
        ('QL-B-1', 'QTE-SUP-B', 'RFX-L-BTL-001', 'PET Bottle 60 ml Round (3% rebate tier)', 'PET Bottle 60 ml Round (3% rebate tier)', 65000, 'EA', 1.78, 'EA', 1.78, 'EA', 115700, 10000, 25, 'confirmed'),
        ('QL-B-2', 'QTE-SUP-B', 'RFX-L-BTL-008', 'PET Bottle 500 ml Standard Mineral', 'PET Bottle 500 ml Standard Mineral', 130000, 'EA', 2.98, 'EA', 2.98, 'EA', 387400, 10000, 25, 'confirmed'),
        ('QL-B-3', 'QTE-SUP-B', 'RFX-L-CTN-004', 'Carton 12 x 1000ml Master Shipper', 'Carton 12 x 1000ml Master Shipper', 55000, 'EA', 24.80, 'EA', 24.80, 'EA', 1364000, 5000, 20, 'confirmed'),
        ('QL-F-1', 'QTE-SUP-F', 'RFX-L-BTL-008', 'PET Bottle 500 ml Standard Mineral (DDP Landed)', 'PET Bottle 500 ml Standard Mineral (DDP Landed)', 130000, 'EA', 3.10, 'EA', 3.10, 'EA', 403000, 10000, 25, 'confirmed'),
        ('QL-F-2', 'QTE-SUP-F', 'RFX-L-BTL-009', 'PET Bottle 500 ml Heavy Duty Hot-Fill (DDP Landed)', 'PET Bottle 500 ml Heavy Duty Hot-Fill (DDP Landed)', 115000, 'EA', 3.75, 'EA', 3.75, 'EA', 431250, 10000, 25, 'confirmed'),
        ('QL-F-3', 'QTE-SUP-F', 'RFX-L-CTN-003', 'Carton 24 x 500ml Master Shipper (5-ply DDP)', 'Carton 24 x 500ml Master Shipper (5-ply DDP)', 45000, 'EA', 22.40, 'EA', 22.40, 'EA', 1008000, 5000, 20, 'confirmed');
      `);

      // 10. Seed Demo Delivery Costs
      db.run(`
        INSERT OR IGNORE INTO quote_delivery_costs (delivery_cost_id, quote_id, factory_id, treatment, amount, currency) VALUES
        ('FRT-A-1', 'QTE-SUP-A', 'BLR', 'separate_line', 26000, 'INR'),
        ('FRT-A-2', 'QTE-SUP-A', 'CHN', 'separate_line', 22000, 'INR'),
        ('FRT-B-1', 'QTE-SUP-B', 'BLR', 'separate_line', 21000, 'INR'),
        ('FRT-B-2', 'QTE-SUP-B', 'CHN', 'separate_line', 18000, 'INR'),
        ('FRT-F-1', 'QTE-SUP-F', 'BLR', 'included', 0, 'INR'),
        ('FRT-F-2', 'QTE-SUP-F', 'CHN', 'included', 0, 'INR');
      `);

      // 11. Seed Demo Field Assessments
      db.run(`
        INSERT OR IGNORE INTO field_assessments (assessment_id, quote_id, field_name, raw_value, normalized_value, status, reason, evidence_snippet, updated_at) VALUES
        ('ASSESS-A-1', 'QTE-SUP-A', 'BTL-009 Unit Price Revision', 'INR 3.30 per EA (revised from 3.40)', '₹3.30 / EA', 'needs_confirmation', 'Unsolicited downward price reduction in vendor reply A-REPLY-002; requires buyer sign-off.', 'We also revise BTL-009 unit price from INR 3.40 per EA to INR 3.30 per EA.', '2026-09-29T10:30:00Z'),
        ('ASSESS-A-2', 'QTE-SUP-A', 'Partial Award Freight Allocation', 'INR 22,000 CHN and INR 26,000 BLR', 'Lump-sum per shipment', 'needs_confirmation', 'Fixed freight applies per shipment; requires buyer confirmation on partial award allocation rule across factory PRs.', 'Freight is INR 22,000 for Chennai and INR 26,000 for Bengaluru each charged once.', '2026-09-29T10:30:00Z'),
        ('ASSESS-B-1', 'QTE-SUP-B', 'Bottle Volume Rebate Condition', '3% discount on bottle goods value', '3.0% Conditional Rebate', 'needs_confirmation', 'Conditional on all 20 bottle lines awarded in full and aggregate goods value > 50 Lakhs.', 'The 3% discount applies to bottle goods value only, when all 20 bottle lines are awarded in full and value > INR 5,000,000.', '2026-09-28T14:15:00Z'),
        ('ASSESS-B-2', 'QTE-SUP-B', 'Quote Validity Window', 'Valid through 2026-10-19 inclusive', 'Expires 2026-10-19', 'needs_confirmation', 'Validity window terminates prior to committed plant arrival date 2026-10-25; buyer must request extension.', 'Valid through 2026-10-19 inclusive.', '2026-09-28T14:15:00Z'),
        ('ASSESS-D-1', 'QTE-SUP-D', 'Food-Contact Migration Certificate', 'Not Found', 'Missing Report DEMO-D-PET-01', 'missing_needs_follow_up', 'Mandatory FSSAI food-contact compliance test missing from submission packet; line disqualification risk.', 'Vendor rate card contained no quality appendix or lab certificate.', '2026-09-28T11:00:00Z'),
        ('ASSESS-E-1', 'QTE-SUP-E', 'Payment Terms Demand', '30% advance cash required with purchase order', '0 Days (Cash Advance)', 'needs_confirmation', 'Supplier demands 30% upfront cash advance, violating company standard 30/45-day credit policy.', 'Terms: 30% advance cash required with purchase order, balance on dispatch.', '2026-09-28T16:00:00Z'),
        ('ASSESS-E-2', 'QTE-SUP-E', 'Food-Contact Test Result', 'DEMO-E-PET-01 result FAIL', 'FAIL (Non-Compliant)', 'needs_confirmation', 'Laboratory test report DEMO-E-PET-01 indicates overall migration limit exceeded (> 10 mg/dm²).', 'Food-contact test report DEMO-E-PET-01 result: FAIL.', '2026-09-28T16:00:00Z');
      `);

      // 12. Seed Demo Conversations
      db.run(`
        INSERT OR IGNORE INTO quote_conversations (conversation_id, quote_id, sender, sender_name, timestamp, subject, message_text, action_type) VALUES
        ('CONV-A-1', 'QTE-SUP-A', 'agent', 'Procure Autonomous Agent', '2026-09-28 15:40:00', 'Clarification Request: Freight Schedule & BTL-009 Unit Price', 'Dear Allied Sales Team, We have received quote ALL-Q-2026-041. Please confirm whether delivery freight is charged separately or included for Bengaluru and Chennai plants, and confirm best rate on line BTL-009 (500ml Heavy Duty).', 'inquiry'),
        ('CONV-A-2', 'QTE-SUP-A', 'supplier', 'Allied Sales (Rajesh Sharma)', '2026-09-29 10:30:00', 'RE: Clarification Request: Quote ALL-Q-2026-041 Revision 2', 'Message-ID: A-REPLY-002. In-Reply-To: A-CLARIFY-001. Freight is INR 22,000 for Chennai and INR 26,000 for Bengaluru, excluding GST, each charged once for a single consolidated shipment whenever any quantity is awarded. We also revise BTL-009 unit price from INR 3.40 per EA to INR 3.30 per EA. Net 45 terms and arrival by 2026-10-25 confirmed.', 'clarification'),
        ('CONV-B-1', 'QTE-SUP-B', 'agent', 'Procure Autonomous Agent', '2026-09-28 11:20:00', 'Inquiry: 3% Rebate Qualification Threshold & Validity', 'Dear PrimePack Commercial Desk, In reviewing quote PCL 2026 041, please clarify the exact conditions required to trigger the 3% volume rebate, and verify the price validity date.', 'inquiry'),
        ('CONV-B-2', 'QTE-SUP-B', 'supplier', 'PrimePack Commercial (Vikram Nair)', '2026-09-28 14:15:00', 'Commercial Response Supplement (PCL 2026 041)', 'The 3% discount applies to bottle goods value only, when all 20 bottle lines are awarded in full and aggregate goods value before discount and freight is strictly greater than INR 5,000,000. Net 30 from receipt. Valid through 2026-10-19.', 'clarification'),
        ('CONV-B-3', 'QTE-SUP-B', 'agent', 'Procure Autonomous Agent', '2026-09-29 09:15:00', 'Urgent: Validity Extension Request', 'Factory schedule requires delivery arrival by 2026-10-25. Your quoted validity of 2026-10-19 leaves a 6-day exposure window. Please confirm validity extension through 2026-10-28.', 'inquiry'),
        ('CONV-F-1', 'QTE-SUP-F', 'supplier', 'Crystal PET India (Ananya Sen)', '2026-09-28 15:30:00', 'Proposal CRY-Q-2026-041 Submission Supplement', 'Workbook prices are INR per EA, excluding GST. Freight is INCLUDED for both destinations (Bengaluru Whitefield & Chennai Sriperumbudur) also for partial awards meeting MOQ. No tooling, packing, or setup charges. Net 45 days. Valid through 2026-10-28. Committed arrival 2026-10-25.', 'clarification'),
        ('CONV-F-2', 'QTE-SUP-F', 'agent', 'Sourcing Team', '2026-09-29 11:00:00', 'Clarification on your Crystal PET quotation', 'Dear Crystal PET Team, Thank you for your quotation CRY-Q-2026-041. We have received prices for three items. Could you please confirm whether you intend to quote for the remaining items in the RFQ, and clarify the carton item in your submission? Kind regards, Sourcing Team', 'clarification');
      `);

      // 13. Seed Sourcing Scenarios
      const scenarios = [
        {
          id: 'dual_70_30',
          name: 'Strategic Dual-Sourcing (70% Crystal PET / 30% PrimePack)',
          tagline: 'Optimal Balance of Cost, High OTIF & Dual-Plant Continuity',
          rec: 1,
          p_id: 'SUP-F',
          p_name: 'Crystal PET India',
          p_pct: 70,
          s_id: 'SUP-B',
          s_name: 'PrimePack Containers Limited',
          s_pct: 30,
          total: 6185000,
          baseline: 7080000,
          sav: 895000,
          sav_pct: 12.6,
          res: 98,
          notes: JSON.stringify([
            'Eliminates single-vendor disruption risk across Bengaluru & Chennai plants.',
            'Crystal PET holds 99% OTIF with zero recorded rejections; freight is fully included.',
            'PrimePack holds 97% OTIF and qualifies for partial bottle volume discounts.',
            'FSSAI food contact test passed by both suppliers.'
          ])
        },
        {
          id: 'lowest_cost',
          name: 'Single Award (100% PrimePack with 3% Rebate)',
          tagline: 'Maximum Immediate Bottle Discount but Zero Supply Backup',
          rec: 0,
          p_id: 'SUP-B',
          p_name: 'PrimePack Containers Limited',
          p_pct: 100,
          s_id: null,
          s_name: null,
          s_pct: 0,
          total: 5980000,
          baseline: 7080000,
          sav: 1100000,
          sav_pct: 15.5,
          res: 65,
          notes: JSON.stringify([
            'Captures the full 3% rebate on all 20 bottle lines exceeding ₹50 Lakhs.',
            'High operational vulnerability if PrimePack suffers machine breakdown before 2026-10-25 delivery deadline.'
          ])
        },
        {
          id: 'single_f',
          name: 'All-Inclusive DDP Award (100% Crystal PET)',
          tagline: 'Zero Logistics Risk & Best Delivery Reliability (99% OTIF)',
          rec: 0,
          p_id: 'SUP-F',
          p_name: 'Crystal PET India',
          p_pct: 100,
          s_id: null,
          s_name: null,
          s_pct: 0,
          total: 6240000,
          baseline: 7080000,
          sav: 840000,
          sav_pct: 11.9,
          res: 82,
          notes: JSON.stringify([
            'DDP pricing eliminates freight volatility for both Chennai and Bengaluru shipments.',
            'Highest quality score and zero historical delivery rejections.'
          ])
        }
      ];

      for (const s of scenarios) {
        db.run(
          `INSERT OR IGNORE INTO sourcing_scenarios (scenario_id, name, tagline, is_recommended, primary_supplier_id, primary_supplier_name, primary_share_percent, secondary_supplier_id, secondary_supplier_name, secondary_share_percent, total_spend, baseline_spend, savings, savings_percent, resilience_score, notes_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [s.id, s.name, s.tagline, s.rec, s.p_id, s.p_name, s.p_pct, s.s_id, s.s_name, s.s_pct, s.total, s.baseline, s.sav, s.sav_pct, s.res, s.notes]
        );
      }
    },
  },
  {
    version: 4,
    name: '004_supplier_product_capabilities_and_matching',
    up: (db: Database) => {
      // 1. Supplier Categories Master Table (Relational product commodity mapping)
      // Stores which product categories each supplier is qualified and certified to manufacture/supply.
      // Supports 1-to-many relationship: One supplier can supply multiple product categories.
      db.run(`
        CREATE TABLE IF NOT EXISTS supplier_categories (
          id TEXT PRIMARY KEY,
          supplier_id TEXT NOT NULL,
          category TEXT NOT NULL,
          is_primary INTEGER DEFAULT 1,
          qualification_status TEXT DEFAULT 'approved',
          monthly_capacity_units INTEGER,
          lead_time_days INTEGER,
          certified_standards TEXT,
          active INTEGER DEFAULT 1,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        );
      `);

      // 2. Supplier Product SKU Line Mapping (Item/Family Level Capability)
      db.run(`
        CREATE TABLE IF NOT EXISTS supplier_products (
          id TEXT PRIMARY KEY,
          supplier_id TEXT NOT NULL,
          category TEXT NOT NULL,
          product_family TEXT NOT NULL,
          sku_pattern TEXT,
          active INTEGER DEFAULT 1,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        );
      `);

      // 3. Register additional approved enterprise suppliers supplying OTHER product categories
      // Demonstrates how 100s of vendors across diverse commodities exist in the DB and get filtered out
      const otherSuppliers = [
        {
          id: 'SUP-G',
          name: 'Avery Flexo Prints India',
          code: 'AVERY',
          type: 'Self-Adhesive Labels & Shrink Sleeve Converter',
          status: 'active',
          curr: 'INR',
          category: 'Labels & Shrink Sleeves',
          deliveries: 120,
          onTime: 118,
          otif: 98.3,
          rejection: 0.4,
          notes: 'High-speed roll-fed wrap-around label printing and tamper-evident shrink sleeves.'
        },
        {
          id: 'SUP-H',
          name: 'Apex Glassware Corp',
          code: 'APEX_GLASS',
          type: 'Flint & Amber Glass Container Manufacturer',
          status: 'active',
          curr: 'INR',
          category: 'Glass Containers',
          deliveries: 80,
          onTime: 79,
          otif: 98.8,
          rejection: 0.6,
          notes: 'Narrow-neck beverage and wide-mouth sauce glass containers with high thermal resistance.'
        },
        {
          id: 'SUP-I',
          name: 'National Tin Can Packaging',
          code: 'NAT_TIN',
          type: 'Metal & Tinplate Packaging Fabricator',
          status: 'active',
          curr: 'INR',
          category: 'Tin Cans',
          deliveries: 65,
          onTime: 63,
          otif: 96.9,
          rejection: 0.8,
          notes: 'Sanitary open-top food-grade tinplate cans and printed aerosol metal packaging.'
        },
        {
          id: 'SUP-J',
          name: 'Safepack Flexible Laminates',
          code: 'SAFEPACK',
          type: 'Multi-Barrier Pouch & Flexible Film Extruder',
          status: 'active',
          curr: 'INR',
          category: 'Flexible Laminates & Pouches',
          deliveries: 95,
          onTime: 93,
          otif: 97.9,
          rejection: 0.5,
          notes: 'Multi-layer barrier laminates, stand-up zipper pouches, and oxygen-scavenging films.'
        },
        {
          id: 'SUP-K',
          name: 'Microflow Pumps & Closures',
          code: 'MICROFLOW',
          type: 'Dispensing Pumps & Precision Dispenser Closures',
          status: 'active',
          curr: 'INR',
          category: 'Caps & Closures',
          deliveries: 110,
          onTime: 105,
          otif: 95.5,
          rejection: 0.9,
          notes: '28mm PCO 1810 flip-top dispensing closures and high-viscosity lotion dispensing pumps.'
        },
        {
          id: 'SUP-L',
          name: 'ResiChem Adhesives & Polymers',
          code: 'RESICHEM',
          type: 'Hot Melt Packaging Adhesives & Polymers',
          status: 'active',
          curr: 'INR',
          category: 'Adhesives & Resins',
          deliveries: 50,
          onTime: 47,
          otif: 94.0,
          rejection: 1.2,
          notes: 'EVA and metallocene hot melt case-sealing adhesives for high-speed carton cartoning lines.'
        }
      ];

      for (const sup of otherSuppliers) {
        db.run(
          `INSERT OR IGNORE INTO suppliers (supplier_id, name, code, supplier_type, status, default_currency)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [sup.id, sup.name, sup.code, sup.type, sup.status, sup.curr]
        );

        db.run(
          `INSERT OR IGNORE INTO supplier_performance (performance_id, supplier_id, category, period_start, period_end, received_deliveries, on_time_deliveries, otif_pct, rejection_rate_pct, notes)
           VALUES (?, ?, ?, '2025-10-01', '2026-09-30', ?, ?, ?, ?, ?)`,
          [`PERF-${sup.id}`, sup.id, sup.category, sup.deliveries, sup.onTime, sup.otif, sup.rejection, sup.notes]
        );

        db.run(
          `INSERT OR IGNORE INTO supplier_categories (id, supplier_id, category, is_primary, qualification_status, monthly_capacity_units, lead_time_days, certified_standards, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`SCAT-${sup.id}-01`, sup.id, sup.category, 1, 'approved', 8000000, 18, 'ISO 9001 / FSSAI Grade A', 1]
        );
      }

      // 4. Seed Supplier Category Mappings for Packaging Suppliers (Demonstrates multi-product mapping)
      const categoryMappings = [
        // SUP-A: Single Product (PET Bottles)
        { id: 'SCAT-SUP-A-PET', supId: 'SUP-A', cat: 'PET Bottles', isPrim: 1, qual: 'approved', cap: 4500000, lead: 25, std: 'ISO 9001, FSSAI Food Grade' },
        
        // SUP-B: MULTI-PRODUCT SUPPLIER (Supplies BOTH PET Bottles AND Cartons)
        { id: 'SCAT-SUP-B-PET', supId: 'SUP-B', cat: 'PET Bottles', isPrim: 1, qual: 'approved', cap: 5000000, lead: 21, std: 'BRCGS Packaging, ISO 22000' },
        { id: 'SCAT-SUP-B-CTN', supId: 'SUP-B', cat: 'Cartons', isPrim: 0, qual: 'approved', cap: 2500000, lead: 21, std: 'FSC Certified Kraft, 5-Ply' },
        
        // SUP-C: Single Product (Cartons)
        { id: 'SCAT-SUP-C-CTN', supId: 'SUP-C', cat: 'Cartons', isPrim: 1, qual: 'approved', cap: 3500000, lead: 15, std: 'ISO 9001, Heavy Duty Kraft' },
        
        // SUP-D: MULTI-PRODUCT TRADER (Supplies BOTH PET Bottles AND Cartons)
        { id: 'SCAT-SUP-D-PET', supId: 'SUP-D', cat: 'PET Bottles', isPrim: 1, qual: 'approved', cap: 1500000, lead: 30, std: 'Trader Distribution Network' },
        { id: 'SCAT-SUP-D-CTN', supId: 'SUP-D', cat: 'Cartons', isPrim: 1, qual: 'approved', cap: 1200000, lead: 30, std: 'Standard Shipper Cartons' },
        
        // SUP-E: PET Bottles (Disqualified quality status)
        { id: 'SCAT-SUP-E-PET', supId: 'SUP-E', cat: 'PET Bottles', isPrim: 1, qual: 'disqualified', cap: 2000000, lead: 35, std: 'Audit Non-Conformance (DEMO-E-PET-01 FAIL)' },
        
        // SUP-F: Single Product (PET Bottles - High Reliability)
        { id: 'SCAT-SUP-F-PET', supId: 'SUP-F', cat: 'PET Bottles', isPrim: 1, qual: 'approved', cap: 6000000, lead: 14, std: 'Cleanroom Class 100k, US FDA / FSSAI Grade A' },
      ];

      for (const m of categoryMappings) {
        db.run(
          `INSERT OR IGNORE INTO supplier_categories (id, supplier_id, category, is_primary, qualification_status, monthly_capacity_units, lead_time_days, certified_standards, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m.id, m.supId, m.cat, m.isPrim, m.qual, m.cap, m.lead, m.std, 1]
        );
      }

      // 5. Seed Specific Product Family SKU Mappings
      const productFamilies = [
        { id: 'SPROD-SUP-A-BTL', supId: 'SUP-A', cat: 'PET Bottles', fam: 'PET Bottles 60ml-1000ml Standard Round & Square', pattern: 'BTL-%' },
        { id: 'SPROD-SUP-B-BTL', supId: 'SUP-B', cat: 'PET Bottles', fam: 'PET Bottles 60ml-1000ml High Speed Blow-Molded', pattern: 'BTL-%' },
        { id: 'SPROD-SUP-B-CTN', supId: 'SUP-B', cat: 'Cartons', fam: '5-Ply Master Corrugated Shipping Cartons', pattern: 'CTN-%' },
        { id: 'SPROD-SUP-C-CTN', supId: 'SUP-C', cat: 'Cartons', fam: 'Custom Printed 5-Ply Heavy Duty Shippers', pattern: 'CTN-%' },
        { id: 'SPROD-SUP-D-BTL', supId: 'SUP-D', cat: 'PET Bottles', fam: 'Standard PET Bottles (Trading & Aggregation)', pattern: 'BTL-%' },
        { id: 'SPROD-SUP-D-CTN', supId: 'SUP-D', cat: 'Cartons', fam: 'Standard Corrugated Boxes (Trading & Aggregation)', pattern: 'CTN-%' },
        { id: 'SPROD-SUP-F-BTL', supId: 'SUP-F', cat: 'PET Bottles', fam: 'High-Precision Hot-Fill & Heavy-Duty PET Bottles', pattern: 'BTL-%' },
      ];

      for (const p of productFamilies) {
        db.run(
          `INSERT OR IGNORE INTO supplier_products (id, supplier_id, category, product_family, sku_pattern, active)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [p.id, p.supId, p.cat, p.fam, p.pattern, 1]
        );
      }
    },
  },
  {
    version: 5,
    name: '005_enterprise_supplier_catalog_mapping',
    up: (db: Database) => {
      // 1. Add extra metadata columns to supplier_products if not already present
      try {
        db.run(`ALTER TABLE supplier_products ADD COLUMN qualification_status TEXT DEFAULT 'approved';`);
      } catch (e) { /* ignore duplicate column */ }
      try {
        db.run(`ALTER TABLE supplier_products ADD COLUMN is_primary INTEGER DEFAULT 1;`);
      } catch (e) { /* ignore duplicate column */ }
      try {
        db.run(`ALTER TABLE supplier_products ADD COLUMN monthly_capacity_units INTEGER DEFAULT 1000000;`);
      } catch (e) { /* ignore duplicate column */ }
      try {
        db.run(`ALTER TABLE supplier_products ADD COLUMN lead_time_days INTEGER DEFAULT 21;`);
      } catch (e) { /* ignore duplicate column */ }
      try {
        db.run(`ALTER TABLE supplier_products ADD COLUMN certified_standards TEXT;`);
      } catch (e) { /* ignore duplicate column */ }

      // 2. Expand Enterprise Supplier Master to 24 vendors representing diverse commodities
      const newEnterpriseSuppliers = [
        // Packaging: Direct PET Bottle Specialist
        {
          id: 'SUP-M',
          name: 'Zenith Rigid Polymers',
          code: 'ZENITH_PET',
          type: 'Direct PET Bottle Manufacturer (High Volume)',
          status: 'active',
          curr: 'INR',
          category: 'PET Bottles',
          deliveries: 90,
          onTime: 87,
          otif: 96.7,
          rejection: 0.5,
          notes: 'Specializes in lightweight beverage containers and hot-fill PET bottles.',
          capacity: 7000000,
          lead: 18,
          standards: 'ISO 9001:2015, FSSAI Certified Cleanroom',
          family: 'Lightweight & Standard PET Bottles 60ml-1000ml',
          pattern: 'BTL-%'
        },
        // Packaging: Direct Heavy-Duty Corrugated Specialist
        {
          id: 'SUP-N',
          name: 'Southern Corrugators & Shippers',
          code: 'SOUTH_CTN',
          type: 'Heavy-Duty Corrugated Carton Fabricator',
          status: 'active',
          curr: 'INR',
          category: 'Cartons',
          deliveries: 105,
          onTime: 101,
          otif: 96.2,
          rejection: 0.7,
          notes: 'Direct converter of 3-ply and 5-ply kraft fluting corrugated cartons.',
          capacity: 4000000,
          lead: 14,
          standards: 'ISO 14001, FSC Certified Fluting Paper',
          family: '5-Ply & 7-Ply Heavy Duty Master Shippers',
          pattern: 'CTN-%'
        },
        // Packaging: Multi-Product Group (Supplies BOTH PET Bottles AND Cartons)
        {
          id: 'SUP-O',
          name: 'Alpha-Pack Integrated Systems',
          code: 'ALPHAPACK',
          type: 'Integrated Multi-Product Packaging Manufacturer',
          status: 'active',
          curr: 'INR',
          category: 'PET Bottles', // Primary
          secCategory: 'Cartons', // Secondary product
          deliveries: 130,
          onTime: 127,
          otif: 97.7,
          rejection: 0.3,
          notes: 'Integrated group manufacturing blow-molded bottles, corrugated cases, and tamper bands.',
          capacity: 8500000,
          lead: 16,
          standards: 'BRCGS Packaging Materials Issue 6 Grade AA',
          family: 'Integrated Bottles and Outer Shipping Cartons',
          pattern: 'BTL-%'
        },
        // Other Commodity: Wooden Pallets & Logistics Skids (Non-packaging commodity)
        {
          id: 'SUP-P',
          name: 'TimberCraft Logistics Pallets',
          code: 'TIMBER_PLT',
          type: 'Heat-Treated Pine & Hardwood Pallet Fabricator',
          status: 'active',
          curr: 'INR',
          category: 'Wooden Pallets & Logistics Skids',
          deliveries: 60,
          onTime: 58,
          otif: 96.7,
          rejection: 1.0,
          notes: 'ISPM-15 certified four-way heat treated wooden pallets for export racking.',
          capacity: 50000,
          lead: 10,
          standards: 'ISPM-15 Heat Treatment Certified',
          family: 'Four-Way Reversible Euro & Standard Industrial Pallets',
          pattern: 'PLT-%'
        },
        // Other Commodity: Food Grade Chemical Sanitizers & CIP (Non-packaging commodity)
        {
          id: 'SUP-Q',
          name: 'CleanChem Industrial Hygiene',
          code: 'CLEANCHEM',
          type: 'CIP Chemicals & Food-Grade Sanitizers',
          status: 'active',
          curr: 'INR',
          category: 'Chemical Sanitizers & CIP',
          deliveries: 45,
          onTime: 44,
          otif: 97.8,
          rejection: 0.2,
          notes: 'Peracetic acid, caustic wash, and sanitizing chemicals for bottle filling lines.',
          capacity: 250000,
          lead: 7,
          standards: 'EPA Registered, NSF International Certified',
          family: 'Automated CIP Acid & Caustic Sanitizing Compounds',
          pattern: 'CHM-%'
        },
        // Other Commodity: Food Ingredients & Seasonings (Raw material commodity)
        {
          id: 'SUP-R',
          name: 'SpiceCraft Aroma & Ingredients',
          code: 'SPICECRAFT',
          type: 'Natural Spices & Food Ingredient Blenders',
          status: 'active',
          curr: 'INR',
          category: 'Food Ingredients & Seasonings',
          deliveries: 85,
          onTime: 84,
          otif: 98.8,
          rejection: 0.4,
          notes: 'Dehydrated spice oleoresins, customized seasoning seasonings, and natural aromas.',
          capacity: 500000,
          lead: 12,
          standards: 'FSSAI License, Spices Board of India Grade A',
          family: 'Standardized Spice Powders & Flavor Concentrates',
          pattern: 'ING-%'
        },
        // Other Commodity: Cold Chain Logistics Fleet (Logistics Services)
        {
          id: 'SUP-S',
          name: 'TransSouth Temperature Logistics',
          code: 'TRANSSOUTH',
          type: 'Refrigerated Fleet & Inter-Plant Transport',
          status: 'active',
          curr: 'INR',
          category: 'Cold-Chain & Freight Logistics',
          deliveries: 140,
          onTime: 131,
          otif: 93.6,
          rejection: 1.5,
          notes: 'Multi-temperature reefer trucks operating between Bengaluru and Chennai plants.',
          capacity: 1000,
          lead: 2,
          standards: 'GDP (Good Distribution Practice) Certified Fleet',
          family: 'Full Truckload (FTL) Dedicated Plant Transfer Services',
          pattern: 'LOG-%'
        },
        // Other Commodity: Paperboard Edge Protectors (Secondary packaging accessory)
        {
          id: 'SUP-T',
          name: 'GuardEdge Cornerboard Systems',
          code: 'GUARDEDGE',
          type: 'Solid Fibre Corner Board & Edge Protectors',
          status: 'active',
          curr: 'INR',
          category: 'Edge Protectors & Strapping',
          deliveries: 70,
          onTime: 68,
          otif: 97.1,
          rejection: 0.6,
          notes: 'Recycled kraft solid fibre edge protectors and polyester strapping bands.',
          capacity: 1200000,
          lead: 8,
          standards: '100% Recyclable Kraft Pulp Standards',
          family: 'V-Shape Laminated Cornerboard 50x50x4mm',
          pattern: 'EDG-%'
        },
        // Other Commodity: Secondary Stretch Film & Shrink Bundling (Plastic film commodity)
        {
          id: 'SUP-U',
          name: 'PolyWrap Industrial Films',
          code: 'POLYWRAP',
          type: 'Cast Stretch Film & Heavy Shrink Film Extruder',
          status: 'active',
          curr: 'INR',
          category: 'Stretch Films & Bundling Wrap',
          deliveries: 95,
          onTime: 93,
          otif: 97.9,
          rejection: 0.4,
          notes: 'High-yield cast machine stretch film and LDPE collation shrink film.',
          capacity: 3000000,
          lead: 10,
          standards: 'ISO 9001:2015, ASTM D4649 High Dart Impact',
          family: '23-Micron High Performance Machine Stretch Rolls',
          pattern: 'FLM-%'
        },
        // Other Commodity: Molded Fiber Bio Trays (Eco commodity)
        {
          id: 'SUP-V',
          name: 'EcoFiber Bio-Packaging',
          code: 'ECOFIBER',
          type: 'Thermoformed Bagasse & Molded Pulp Trays',
          status: 'active',
          curr: 'INR',
          category: 'Molded Pulp & Bio-Packaging',
          deliveries: 55,
          onTime: 52,
          otif: 94.5,
          rejection: 0.9,
          notes: 'Sugarcane bagasse molded pulp takeaway trays and compostable barrier inserts.',
          capacity: 2000000,
          lead: 25,
          standards: 'ASTM D6400 BPI Certified Compostable',
          family: 'Unbleached Bagasse Compartment Food Trays',
          pattern: 'BIO-%'
        },
        // Other Commodity: Metal Aerosol & Tin Containers (Metal packaging commodity)
        {
          id: 'SUP-W',
          name: 'IndoCan Tinplate Fabricators',
          code: 'INDOCAN',
          type: 'Welded Tinplate & Aerosol Can Maker',
          status: 'active',
          curr: 'INR',
          category: 'Tinplate & Aerosols',
          deliveries: 60,
          onTime: 58,
          otif: 96.7,
          rejection: 0.8,
          notes: 'Three-piece welded sanitary food cans and tinplate chemical packaging.',
          capacity: 1500000,
          lead: 22,
          standards: 'BIS Food Grade Tinplate Standards IS:9396',
          family: 'Sanitary Open Top Food Grade Metal Cans',
          pattern: 'CAN-%'
        },
        // Other Commodity: Industrial Inks & Functional Coatings (Chemical consumable)
        {
          id: 'SUP-X',
          name: 'Vibrant Inks & Colorants',
          code: 'VIBRANT',
          type: 'Flexographic Inks & Water-Based Varnishes',
          status: 'active',
          curr: 'INR',
          category: 'Printing Inks & Varnishes',
          deliveries: 75,
          onTime: 74,
          otif: 98.7,
          rejection: 0.3,
          notes: 'Low-migration UV flexo inks and overprint water-based varnishes for food packaging.',
          capacity: 400000,
          lead: 5,
          standards: 'EuPIA Low Migration Exclusion List Compliant',
          family: 'Process Cyan/Magenta/Yellow/Black Food Safe Inks',
          pattern: 'INK-%'
        }
      ];

      for (const s of newEnterpriseSuppliers) {
        db.run(
          `INSERT OR IGNORE INTO suppliers (supplier_id, name, code, supplier_type, status, default_currency)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [s.id, s.name, s.code, s.type, s.status, s.curr]
        );

        db.run(
          `INSERT OR IGNORE INTO supplier_performance (performance_id, supplier_id, category, period_start, period_end, received_deliveries, on_time_deliveries, otif_pct, rejection_rate_pct, notes)
           VALUES (?, ?, ?, '2025-10-01', '2026-09-30', ?, ?, ?, ?, ?)`,
          [`PERF-${s.id}`, s.id, s.category, s.deliveries, s.onTime, s.otif, s.rejection, s.notes]
        );

        // Primary Category Mapping
        db.run(
          `INSERT OR IGNORE INTO supplier_categories (id, supplier_id, category, is_primary, qualification_status, monthly_capacity_units, lead_time_days, certified_standards, active)
           VALUES (?, ?, ?, 1, 'approved', ?, ?, ?, 1)`,
          [`SCAT-${s.id}-01`, s.id, s.category, s.capacity, s.lead, s.standards]
        );

        // Product SKU Line Mapping
        db.run(
          `INSERT OR IGNORE INTO supplier_products (id, supplier_id, category, product_family, sku_pattern, active, qualification_status, is_primary, monthly_capacity_units, lead_time_days, certified_standards)
           VALUES (?, ?, ?, ?, ?, 1, 'approved', 1, ?, ?, ?)`,
          [`SPROD-${s.id}-01`, s.id, s.category, s.family, s.pattern, s.capacity, s.lead, s.standards]
        );

        // If Multi-Product (e.g. SUP-O supplies BOTH PET Bottles AND Cartons)
        if ((s as any).secCategory) {
          const sec = (s as any).secCategory;
          db.run(
            `INSERT OR IGNORE INTO supplier_categories (id, supplier_id, category, is_primary, qualification_status, monthly_capacity_units, lead_time_days, certified_standards, active)
             VALUES (?, ?, ?, 0, 'approved', ?, ?, ?, 1)`,
            [`SCAT-${s.id}-02`, s.id, sec, 4000000, 16, s.standards]
          );

          db.run(
            `INSERT OR IGNORE INTO supplier_products (id, supplier_id, category, product_family, sku_pattern, active, qualification_status, is_primary, monthly_capacity_units, lead_time_days, certified_standards)
             VALUES (?, ?, ?, ?, ?, 1, 'approved', 0, 4000000, 16, ?)`,
            [`SPROD-${s.id}-02`, s.id, sec, 'Custom Fluted 5-Ply Shippers for Automated Lines', 'CTN-%', s.standards]
          );
        }
      }
    },
  },
  {
    version: 6,
    name: '006_items_master_and_line_links',
    up: (db: Database) => {
      // The original catalog was empty and invisible; retain its identity so
      // item_specifications foreign keys follow the rename automatically.
      db.run('ALTER TABLE item_catalog RENAME TO items;');
      db.run('ALTER TABLE items ADD COLUMN sku_code TEXT;');
      db.run('ALTER TABLE items ADD COLUMN item_name TEXT;');
      db.run('ALTER TABLE items ADD COLUMN size_specification TEXT;');
      db.run('ALTER TABLE items ADD COLUMN weight_or_gsm TEXT;');
      db.run("ALTER TABLE items ADD COLUMN uom TEXT NOT NULL DEFAULT 'EA';");

      db.run('UPDATE items SET sku_code = item_id WHERE sku_code IS NULL;');
      db.run(`
        INSERT OR IGNORE INTO items (item_id, sku_code, item_name, category, size_specification, weight_or_gsm, uom, active)
        SELECT sku_code, sku_code, item_name, category, size_specification, weight_or_gsm, uom, 1
        FROM rfx_lines WHERE 1
      `);
      db.run(`
        INSERT OR IGNORE INTO items (item_id, sku_code, item_name, category, size_specification, weight_or_gsm, uom, active)
        SELECT sku_code, sku_code, item_name, category, size_specification, weight_or_gsm, uom, 1
        FROM purchase_request_lines WHERE 1
      `);
      db.run(`
        UPDATE items SET
          item_name = COALESCE(item_name, (SELECT item_name FROM rfx_lines WHERE sku_code = items.sku_code LIMIT 1)),
          size_specification = COALESCE(size_specification, (SELECT size_specification FROM rfx_lines WHERE sku_code = items.sku_code LIMIT 1)),
          weight_or_gsm = COALESCE(weight_or_gsm, (SELECT weight_or_gsm FROM rfx_lines WHERE sku_code = items.sku_code LIMIT 1));
      `);
      db.run('CREATE UNIQUE INDEX idx_items_sku_code ON items(sku_code);');
      db.run('CREATE INDEX idx_items_category_active ON items(category, active);');

      for (const table of ['purchase_request_lines', 'rfx_lines', 'quote_lines']) {
        db.run(`ALTER TABLE ${table} ADD COLUMN item_id TEXT REFERENCES items(item_id);`);
        db.run(`CREATE INDEX idx_${table}_item_id ON ${table}(item_id);`);
      }
      db.run('UPDATE purchase_request_lines SET item_id = (SELECT item_id FROM items WHERE items.sku_code = purchase_request_lines.sku_code);');
      db.run('UPDATE rfx_lines SET item_id = (SELECT item_id FROM items WHERE items.sku_code = rfx_lines.sku_code);');
      db.run('UPDATE quote_lines SET item_id = (SELECT item_id FROM rfx_lines WHERE rfx_lines.rfx_line_id = quote_lines.rfx_line_id);');

      for (const table of ['purchase_request_lines', 'rfx_lines']) {
        db.run(`
          CREATE TRIGGER ${table}_item_insert BEFORE INSERT ON ${table}
          WHEN NEW.item_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM items WHERE item_id = NEW.item_id AND sku_code = NEW.sku_code
          ) BEGIN SELECT RAISE(ABORT, 'Valid item_id matching sku_code is required'); END;
        `);
        db.run(`
          CREATE TRIGGER ${table}_item_update BEFORE UPDATE OF item_id, sku_code ON ${table}
          WHEN NEW.item_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM items WHERE item_id = NEW.item_id AND sku_code = NEW.sku_code
          ) BEGIN SELECT RAISE(ABORT, 'Valid item_id matching sku_code is required'); END;
        `);
      }
      db.run(`
        CREATE TRIGGER quote_lines_item_insert BEFORE INSERT ON quote_lines
        WHEN NEW.item_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM rfx_lines WHERE rfx_line_id = NEW.rfx_line_id AND item_id = NEW.item_id
        ) BEGIN SELECT RAISE(ABORT, 'Quote line must reference an RFx item'); END;
      `);
      db.run(`
        CREATE TRIGGER quote_lines_item_update BEFORE UPDATE OF item_id, rfx_line_id ON quote_lines
        WHEN NEW.item_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM rfx_lines WHERE rfx_line_id = NEW.rfx_line_id AND item_id = NEW.item_id
        ) BEGIN SELECT RAISE(ABORT, 'Quote line must reference an RFx item'); END;
      `);
      db.run(`
        CREATE TRIGGER items_sku_immutable BEFORE UPDATE OF sku_code ON items
        WHEN NEW.sku_code IS NOT OLD.sku_code
        BEGIN SELECT RAISE(ABORT, 'SKU code is immutable; create a new item'); END;
      `);
    },
  },
  {
    version: 7,
    name: '007_supplier_communication_status',
    up: (db: Database) => {
      db.run(`
        CREATE TABLE rfq_messages (
          message_id TEXT PRIMARY KEY,
          rfx_id TEXT NOT NULL REFERENCES rfxs(rfx_id),
          supplier_id TEXT NOT NULL REFERENCES suppliers(supplier_id),
          subject TEXT NOT NULL,
          message_text TEXT NOT NULL,
          delivery_status TEXT NOT NULL CHECK (delivery_status IN ('draft', 'sent', 'cancelled')),
          created_at TEXT NOT NULL,
          sent_at TEXT,
          provider_message_id TEXT,
          UNIQUE (rfx_id, supplier_id)
        );
      `);
      db.run('CREATE INDEX idx_rfq_messages_supplier ON rfq_messages(supplier_id, rfx_id);');
      db.run("ALTER TABLE quote_conversations ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'recorded';");
      db.run("UPDATE quote_conversations SET delivery_status = 'received' WHERE sender = 'supplier';");
    },
  },
  {
    version: 8,
    name: '008_rename_rfq_reference_and_correct_sample_email',
    up: (db: Database) => {
      const oldId = 'RFx-2026-041';
      const newId = 'RFQ-2026-041';
      db.run('BEGIN TRANSACTION;');
      try {
        db.run(`INSERT OR IGNORE INTO rfxs (rfx_id, title, issue_date, due_date, currency, buyer_name, status)
          SELECT ?, title, issue_date, due_date, currency, buyer_name, status FROM rfxs WHERE rfx_id = ?;`, [newId, oldId]);
        for (const table of ['rfx_lines', 'quotes', 'rfq_messages']) {
          db.run(`UPDATE ${table} SET rfx_id = ? WHERE rfx_id = ?;`, [newId, oldId]);
        }
        db.run('UPDATE rfq_messages SET message_id = REPLACE(message_id, ?, ?), subject = REPLACE(subject, ?, ?), message_text = REPLACE(message_text, ?, ?) WHERE message_id LIKE ?;',
          [oldId, newId, oldId, newId, oldId, newId, `%${oldId}%`]);
        db.run('DELETE FROM rfxs WHERE rfx_id = ?;', [oldId]);
        db.run(`UPDATE quote_conversations SET
          subject = 'Clarification on your Crystal PET quotation',
          message_text = 'Dear Crystal PET Team,\n\nThank you for your quotation CRY-Q-2026-041. We have received prices for three items. Could you please confirm whether you intend to quote for the remaining items in the RFQ, and clarify the carton item in your submission?\n\nKind regards,\nSourcing Team'
          WHERE conversation_id = 'CONV-F-2';`);
        db.run('COMMIT;');
      } catch (error) {
        db.run('ROLLBACK;');
        throw error;
      }
    },
  },
  {
    version: 9,
    name: '009_full_scope_sample_supplier_quotes',
    up: (db: Database) => {
      const rfqId = 'RFQ-2026-041';
      const result = db.exec(`SELECT rfx_line_id, item_id, item_name, category, total_quantity, baseline_rate
        FROM rfx_lines WHERE rfx_id = '${rfqId}' ORDER BY rfx_line_id;`);
      const lines = result[0]?.values || [];
      if (lines.length !== 30) throw new Error(`Expected 30 RFQ lines for sample quotes; found ${lines.length}`);

      const samples = [
        { id: 'QTE-SUP-O-FULL', supplierId: 'SUP-O', supplierName: 'Alpha-Pack Integrated Systems', number: 'APIS-Q-2026-041-SAMPLE',
          attachmentId: 'ATT-SUP-O-FULL', factor: 0.95, leadDays: 16, paymentDays: 45, validUntil: '2026-11-15', date: '2026-10-01' },
        { id: 'QTE-SUP-B-REV2-FULL', supplierId: 'SUP-B', supplierName: 'PrimePack Containers Limited', number: 'PCL-Q-2026-041-REV2-SAMPLE',
          attachmentId: 'ATT-SUP-B-FULL', factor: 0.97, leadDays: 21, paymentDays: 30, validUntil: '2026-11-10', date: '2026-10-01' },
      ];

      for (const sample of samples) {
        const pricedLines = lines.map((row) => {
          const [rfxLineId, itemId, itemName, category, quantity, baselineRate] = row;
          const unitPrice = Math.round(Number(baselineRate) * sample.factor * 100) / 100;
          return { rfxLineId: String(rfxLineId), itemId: String(itemId), itemName: String(itemName),
            category: String(category), quantity: Number(quantity), unitPrice,
            total: Math.round(Number(quantity) * unitPrice * 100) / 100 };
        });
        const total = Math.round(pricedLines.reduce((sum, line) => sum + line.total, 0) * 100) / 100;
        const document = [
          `SAMPLE QUOTATION — ${sample.number}`,
          `Supplier: ${sample.supplierName}`,
          `RFQ: ${rfqId}`,
          `Quote date: ${sample.date}; valid until: ${sample.validUntil}`,
          `Currency: INR; payment: net ${sample.paymentDays} days from invoice`,
          'Delivery to Bengaluru Whitefield and Chennai Sriperumbudur by 2026-10-25.',
          'Freight, packing, and handling included for both plants. No additional charges or conditional rebates.',
          sample.id === 'QTE-SUP-B-REV2-FULL'
            ? 'All quoted items meet the RFQ specifications. Prices are per EA; minimum order per item is 55% of that item’s full RFQ quantity.'
            : 'All quoted items meet the RFQ specifications. Prices are per EA; minimum order 1,000 EA per item.',
          '',
          'RFQ line | Item | Category | Quantity EA | Unit price INR | Line amount INR',
          ...pricedLines.map((line) => `${line.rfxLineId} | ${line.itemName} | ${line.category} | ${line.quantity} | ${line.unitPrice.toFixed(2)} | ${line.total.toFixed(2)}`),
          '', `Total including delivery: INR ${total.toFixed(2)}`,
        ].join('\n');
        db.run(`INSERT OR IGNORE INTO attachments
          (attachment_id, filename, mime_type, document_type, processed_at, file_size_bytes, file_content)
          VALUES (?, ?, 'text/plain', 'sample_master_quote', '2026-10-01T12:00:00Z', ?, ?);`,
          [sample.attachmentId, `${sample.number}.txt`, document.length, document]);
        db.run(`INSERT OR IGNORE INTO quotes
          (quote_id, rfx_id, supplier_id, message_id, quote_number, quote_date, currency,
           stated_total_amount, calculated_total_amount, amount_variance, valid_until,
           payment_terms_days, freight_treatment, status)
          VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, 0, ?, ?, 'included', 'sample_ready_for_review');`,
          [sample.id, rfqId, sample.supplierId, sample.attachmentId, sample.number,
            sample.date, total, total, sample.validUntil, sample.paymentDays]);
        for (const [index, line] of pricedLines.entries()) {
          db.run(`INSERT OR IGNORE INTO quote_lines
            (quote_line_id, quote_id, rfx_line_id, item_id, item_name, raw_item_description,
             quoted_quantity, quoted_uom, unit_price, price_uom, normalized_unit_price,
             normalized_uom, line_total_amount, moq_quantity, moq_uom, lead_time_days,
             delivery_date, specification_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'EA', ?, 'EA', ?, 'EA', ?, ?, 'EA', ?, '2026-10-25', 'confirmed');`,
            [`${sample.id}-L-${String(index + 1).padStart(2, '0')}`, sample.id, line.rfxLineId,
              line.itemId, line.itemName, line.itemName, line.quantity, line.unitPrice,
              line.unitPrice, line.total, sample.id === 'QTE-SUP-B-REV2-FULL' ? Math.ceil(Number(line.quantity) * 0.55) : 1000,
              sample.leadDays]);
        }
        for (const factoryId of ['BLR', 'CHN']) {
          db.run(`INSERT OR IGNORE INTO quote_delivery_costs
            (delivery_cost_id, quote_id, factory_id, treatment, amount, currency, basis, allocation_method)
            VALUES (?, ?, ?, 'included', 0, 'INR', 'Included in unit prices', 'No separate charge');`,
            [`${sample.id}-FRT-${factoryId}`, sample.id, factoryId]);
        }
        db.run(`INSERT OR IGNORE INTO quote_conversations
          (conversation_id, quote_id, sender, sender_name, timestamp, subject, message_text, action_type, delivery_status)
          VALUES (?, ?, 'supplier', ?, '2026-10-01 12:00:00', ?, ?, 'submission', 'received');`,
          [`${sample.id}-SUBMISSION`, sample.id, `${sample.supplierName} Sales Team`,
            `Sample quotation ${sample.number} for ${rfqId}`,
            `Dear Sourcing Team,\n\nPlease find our sample quotation ${sample.number} covering all 30 items in ${rfqId}. Our total is INR ${total.toFixed(2)}, including delivery to both plants by 2026-10-25. Prices are valid until ${sample.validUntil}, with net ${sample.paymentDays} day payment terms. The attached item schedule includes quantities, unit prices, minimum orders, lead times, and delivery dates.\n\nKind regards,\n${sample.supplierName} Sales Team`]);
      }
    },
  },
  {
    version: 10,
    name: '010_align_item_names_across_rfq_and_sample_quotes',
    up: (db: Database) => {
      // The demo seed added unrequested shape and marketing terms. Keep SKU IDs,
      // quantities, prices and original supplier descriptions intact.
      const names: Record<string, string> = {
        'BTL-001': 'PET Bottle 60 ml', 'BTL-002': 'PET Bottle 100 ml',
        'BTL-003': 'PET Bottle 150 ml', 'BTL-004': 'PET Bottle 200 ml',
        'BTL-005': 'PET Bottle 250 ml', 'BTL-006': 'PET Bottle 300 ml',
        'BTL-007': 'PET Bottle 350 ml', 'BTL-008': 'PET Bottle 500 ml',
        'BTL-009': 'PET Bottle 500 ml', 'BTL-010': 'PET Bottle 600 ml',
        'BTL-011': 'PET Bottle 750 ml', 'BTL-012': 'PET Bottle 1000 ml',
        'BTL-013': 'PET Bottle 1000 ml', 'BTL-014': 'PET Bottle 1250 ml',
        'BTL-015': 'PET Bottle 1500 ml', 'BTL-016': 'PET Bottle 2000 ml',
        'BTL-017': 'PET Bottle 2500 ml', 'BTL-018': 'PET Bottle 3000 ml',
        'BTL-019': 'PET Bottle 4000 ml', 'BTL-020': 'PET Bottle 5000 ml',
        'CTN-001': 'Carton for 24 × 60 ml bottles',
        'CTN-002': 'Carton for 24 × 200 ml bottles',
        'CTN-003': 'Carton for 24 × 500 ml bottles',
        'CTN-004': 'Carton for 12 × 1000 ml bottles',
        'CTN-005': 'Carton for 6 × 2000 ml bottles',
        'CTN-006': 'Carton for 4 × 5000 ml bottles',
        'CTN-007': 'Carton for 500 ml bottle',
        'CTN-008': 'Carton for 1000 ml bottle',
        'CTN-009': 'Carton CTN-009',
        'CTN-010': 'Carton CTN-010',
      };
      for (const [sku, name] of Object.entries(names)) {
        const old = db.exec('SELECT item_name FROM rfx_lines WHERE sku_code = ?;', [sku])[0]?.values[0]?.[0] as string | undefined;
        if (!old) throw new Error(`Missing RFQ item ${sku}`);
        db.run('UPDATE items SET item_name = ? WHERE sku_code = ?;', [name, sku]);
        db.run('UPDATE rfx_lines SET item_name = ? WHERE sku_code = ?;', [name, sku]);
        db.run('UPDATE purchase_request_lines SET item_name = ? WHERE sku_code = ?;', [name, sku]);
        db.run(`UPDATE quote_lines SET item_name = ? WHERE rfx_line_id IN
          (SELECT rfx_line_id FROM rfx_lines WHERE sku_code = ?);`, [name, sku]);
        db.run(`UPDATE quote_lines SET raw_item_description = ? WHERE quote_id IN
          ('QTE-SUP-O-FULL', 'QTE-SUP-B-REV2-FULL') AND rfx_line_id IN
          (SELECT rfx_line_id FROM rfx_lines WHERE sku_code = ?);`, [name, sku]);
        db.run(`UPDATE attachments SET file_content = REPLACE(file_content, ?, ?)
          WHERE attachment_id IN ('ATT-SUP-O-FULL', 'ATT-SUP-B-FULL');`, [old, name]);
      }
    },
  },
  {
    version: 11,
    name: '011_reconcile_demo_pr_budgets_and_retire_stale_scenarios',
    up: (db: Database) => {
      // Earlier demo headers retained placeholder amounts after the 30 PR lines
      // were seeded. Correct only those untouched seed values; preserve edits.
      for (const [prId, staleAmount] of [['pr-blr', 3820000], ['pr-chn', 3260000]] as const) {
        db.run(`UPDATE purchase_requests SET estimated_budget = (
          SELECT ROUND(SUM(estimated_spend), 2) FROM purchase_request_lines WHERE pr_id = ?
        ) WHERE pr_id = ? AND estimated_budget = ?
          AND EXISTS (SELECT 1 FROM purchase_request_lines WHERE pr_id = ?);`,
        [prId, prId, staleAmount, prId]);
      }
      // These seeded scenarios used the placeholder 7,080,000 baseline and
      // fabricated award totals. Award analysis now calculates from live bids.
      db.run(`DELETE FROM sourcing_scenarios
        WHERE scenario_id IN ('dual_70_30', 'lowest_cost', 'single_f')
          AND baseline_spend = 7080000;`);
    },
  },
  {
    version: 12,
    name: '012_primepack_sample_line_moq_for_split_demo',
    up: (db: Database) => {
      // This is an explicit sample-quote term, not a policy imposed on other bids.
      db.run(`UPDATE quote_lines SET moq_quantity = (
        SELECT CAST((r.total_quantity * 55 + 99) / 100 AS INTEGER)
        FROM rfx_lines r WHERE r.rfx_line_id = quote_lines.rfx_line_id
      ) WHERE quote_id = 'QTE-SUP-B-REV2-FULL';`);
      db.run(`UPDATE attachments SET file_content = REPLACE(file_content,
        'minimum order 1,000 EA per item.',
        'minimum order per item is 55% of that item’s full RFQ quantity.')
        WHERE attachment_id = 'ATT-SUP-B-FULL';`);
    },
  },
];

export function runMigrations(db: Database): number {
  // Ensure schema_migrations table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  // Find currently applied versions
  const res = db.exec('SELECT version FROM schema_migrations ORDER BY version ASC;');
  const appliedVersions = new Set<number>();
  if (res.length > 0 && res[0].values) {
    for (const row of res[0].values) {
      appliedVersions.add(row[0] as number);
    }
  }

  let newlyApplied = 0;
  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`[Database Migration] Applying migration ${migration.version}: ${migration.name}...`);
      migration.up(db);
      db.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
        [migration.version, migration.name, new Date().toISOString()]
      );
      newlyApplied++;
      console.log(`[Database Migration] Migration ${migration.version} applied successfully.`);
    }
  }

  return newlyApplied;
}
