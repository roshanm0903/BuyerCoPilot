export type MentionType = 'pr' | 'rfq' | 'vendor' | 'item';

export interface ActiveMention {
  type: MentionType;
  term: string;
  start: number;
  end: number;
}

export function findActiveMention(value: string, caret: number): ActiveMention | null {
  const before = value.slice(0, caret);
  const match = /(^|[\s(])@(PR|RFQ|Vendor|Supplier|Item)(?:[ \t]+([^@\n,;!?]*))?$/i.exec(before);
  if (!match) return null;
  const type = match[2].toLowerCase() === 'supplier' ? 'vendor' : match[2].toLowerCase() as MentionType;
  return {
    type,
    term: (match[3] || '').trimStart(),
    start: match.index + match[1].length,
    end: caret,
  };
}

export function insertMention(value: string, mention: ActiveMention, replacement: string): { value: string; caret: number } {
  const next = value.slice(0, mention.start) + replacement + value.slice(mention.end);
  return { value: next, caret: mention.start + replacement.length };
}
