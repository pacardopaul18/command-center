/** Clean table: mono uppercase headers, thin horizontal dividers only, hover tint rows. */
export interface DataTableColumn {
  header: string;
  /** Property to read from the row when no render fn is given. */
  key?: string;
  /** Custom cell renderer. */
  render?: (row: any) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Set on numeric/date/code columns. */
  mono?: boolean;
  /** Render in secondary text color. */
  muted?: boolean;
  /** This column absorbs remaining width and wraps. */
  grow?: boolean;
}
export interface DataTableProps {
  columns: DataTableColumn[];
  rows: any[];
  onRowClick?: (row: any) => void;
  style?: React.CSSProperties;
}
export declare function DataTable(props: DataTableProps): JSX.Element;
