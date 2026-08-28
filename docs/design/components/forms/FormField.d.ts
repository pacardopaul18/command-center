/** Label wrapper for form controls: mono uppercase label above, optional hint below. */
export interface FormFieldProps {
  label: string;
  /** One plain sentence under the control. */
  hint?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function FormField(props: FormFieldProps): JSX.Element;
