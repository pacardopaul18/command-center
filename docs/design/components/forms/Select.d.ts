/** Native select styled to match Input. */
export interface SelectProps {
  options: Array<string | { value: string; label: string }>;
  value?: string;
  onChange?: (e: any) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Select(props: SelectProps): JSX.Element;
