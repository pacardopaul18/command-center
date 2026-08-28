/** Primary action button. Sentence-case labels, no icons required.
 * @startingPoint section="Actions" subtitle="Primary, secondary and ghost buttons" viewport="700x180"
 */
export interface ButtonProps {
  /** Visual style. Primary is navy; one primary per view. */
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): JSX.Element;
