/** Small status pill. Gold means at risk or overdue, green means on track or done; nothing else carries status color.
 * @startingPoint section="Data" subtitle="The seven status states" viewport="700x120"
 */
export interface StatusChipProps {
  status?: 'ontrack' | 'atrisk' | 'blocked' | 'done' | 'overdue' | 'waiting' | 'open';
  /** Override the default label text. */
  label?: string;
  style?: React.CSSProperties;
}
export declare function StatusChip(props: StatusChipProps): JSX.Element;
