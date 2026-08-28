/** Related-record panel: sectioned cross-links so any record shows what it is connected to, one click away. */
export interface RelatedRow {
  title: string;
  /** Mono second line: date, code, amount. */
  meta?: string;
  /** Right-aligned node, usually a StatusChip. */
  trailing?: React.ReactNode;
  onOpen?: () => void;
}
export interface RelatedSection {
  /** Section label, e.g. "Action items", "Meetings", "Invoices". */
  label: string;
  count?: number;
  rows: RelatedRow[];
  /** Shown when rows is empty. */
  empty?: string;
}
export interface RelatedPanelProps {
  sections: RelatedSection[];
  style?: React.CSSProperties;
}
export declare function RelatedPanel(props: RelatedPanelProps): JSX.Element;
