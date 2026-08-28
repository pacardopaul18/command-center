/** Persistent navy left sidebar: app name, quick add with shortcut hint, flat nav list, footer slot for Settings.
 * @startingPoint section="Shell" subtitle="Navy sidebar with quick add" viewport="700x400"
 */
export interface SidebarNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}
export interface SidebarProps {
  appName?: string;
  /** Flat list, Today first. No nesting. */
  items: SidebarNavItem[];
  activeId?: string;
  onNavigate?: (id: string) => void;
  /** Shows the quick add button with the N shortcut hint. */
  onQuickAdd?: () => void;
  /** Bottom slot, used for the Settings entry. */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Sidebar(props: SidebarProps): JSX.Element;
