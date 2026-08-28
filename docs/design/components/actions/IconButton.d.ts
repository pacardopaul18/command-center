/** Square icon-only button for row actions and toolbars. Always labeled. */
export interface IconButtonProps {
  /** Accessible label; becomes aria-label and title. */
  label: string;
  /** Square size in px. Default 32. */
  size?: number;
  onClick?: () => void;
  /** The icon (16 to 18px Lucide SVG). */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
