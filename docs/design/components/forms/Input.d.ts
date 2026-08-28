/** Single-line text input, 8px radius, soft navy focus ring. */
export interface InputProps {
  /** DM Mono for codes, amounts, PINs. */
  mono?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (e: any) => void;
  type?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;
