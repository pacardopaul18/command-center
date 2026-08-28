/** Content card: white, 1px border, 12px radius, soft shadow. Callout variant is flat cream. */
export interface CardProps {
  /** Sentence-case heading. */
  title?: React.ReactNode;
  /** Small line icon (16 to 18px) rendered before the title. */
  icon?: React.ReactNode;
  /** Optional right-aligned header action (usually a ghost Button). */
  action?: React.ReactNode;
  /** Cream flat variant for callouts and empty states. */
  callout?: boolean;
  /** Inner padding in px. Default 20. */
  padding?: number | string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Card(props: CardProps): JSX.Element;
