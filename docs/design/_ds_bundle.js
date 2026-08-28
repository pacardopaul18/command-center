/* @ds-bundle: {"format":4,"namespace":"CommandCenterDesignSystem_a34f56","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"IconButton","sourcePath":"components/actions/IconButton.jsx"},{"name":"Card","sourcePath":"components/data/Card.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"StatusChip","sourcePath":"components/data/StatusChip.jsx"},{"name":"FormField","sourcePath":"components/forms/FormField.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"RelatedPanel","sourcePath":"components/shell/RelatedPanel.jsx"},{"name":"Sidebar","sourcePath":"components/shell/Sidebar.jsx"},{"name":"ActionItemsScreen","sourcePath":"ui_kits/command-center/ActionItemsScreen.jsx"},{"name":"ClientsScreen","sourcePath":"ui_kits/command-center/ClientsScreen.jsx"},{"name":"InvoicingScreen","sourcePath":"ui_kits/command-center/InvoicingScreen.jsx"},{"name":"LoginScreen","sourcePath":"ui_kits/command-center/LoginScreen.jsx"},{"name":"MeetingsScreen","sourcePath":"ui_kits/command-center/MeetingsScreen.jsx"},{"name":"ProjectDetailScreen","sourcePath":"ui_kits/command-center/ProjectDetailScreen.jsx"},{"name":"ProjectsScreen","sourcePath":"ui_kits/command-center/ProjectsScreen.jsx"},{"name":"ReportsScreen","sourcePath":"ui_kits/command-center/ReportsScreen.jsx"},{"name":"SopsScreen","sourcePath":"ui_kits/command-center/SopsScreen.jsx"},{"name":"TemplatesScreen","sourcePath":"ui_kits/command-center/TemplatesScreen.jsx"},{"name":"TodayScreen","sourcePath":"ui_kits/command-center/TodayScreen.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"d886d4db85dd","components/actions/IconButton.jsx":"2a9e13916836","components/data/Card.jsx":"cabd051dd253","components/data/DataTable.jsx":"77554d27e01d","components/data/StatusChip.jsx":"06cdbb48cd57","components/forms/FormField.jsx":"9290c6d96486","components/forms/Input.jsx":"e2e7c88a9163","components/forms/Select.jsx":"9f51315f6fd1","components/shell/RelatedPanel.jsx":"d57527f1b688","components/shell/Sidebar.jsx":"484dfa2bc109","ui_kits/command-center/ActionItemsScreen.jsx":"37f4d8d881b7","ui_kits/command-center/ClientsScreen.jsx":"8f08972631f6","ui_kits/command-center/InvoicingScreen.jsx":"14ebaec6208c","ui_kits/command-center/LoginScreen.jsx":"3ef4b91b9f4f","ui_kits/command-center/MeetingsScreen.jsx":"799de54f6418","ui_kits/command-center/ProjectDetailScreen.jsx":"fe0578ce19d9","ui_kits/command-center/ProjectsScreen.jsx":"df6c19802772","ui_kits/command-center/ReportsScreen.jsx":"a7b9cf91f653","ui_kits/command-center/SopsScreen.jsx":"156b2cf140b4","ui_kits/command-center/TemplatesScreen.jsx":"81ce36c97e14","ui_kits/command-center/TodayScreen.jsx":"b72977b5994c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CommandCenterDesignSystem_a34f56 = window.CommandCenterDesignSystem_a34f56 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const base = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-base)',
  fontWeight: 500,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  lineHeight: 1,
  transition: 'background-color var(--transition-fast),border-color var(--transition-fast)'
};
const variants = {
  primary: {
    background: 'var(--navy)',
    color: 'var(--text-inverse)'
  },
  secondary: {
    background: 'var(--surface-card)',
    color: 'var(--ink)',
    borderColor: 'var(--border-strong)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--navy-700)'
  }
};
const hoverBg = {
  primary: 'var(--navy-700)',
  secondary: 'var(--surface-hover)',
  ghost: 'var(--navy-50)'
};
const sizes = {
  sm: {
    padding: '6px 12px',
    fontSize: 'var(--text-sm)'
  },
  md: {
    padding: '9px 16px'
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  style,
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const v = variants[variant] || variants.primary;
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...v,
      ...sizes[size],
      ...(hover && !disabled ? {
        background: hoverBg[variant]
      } : {}),
      ...(disabled ? {
        opacity: .45,
        cursor: 'default'
      } : {}),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  label,
  size = 32,
  style,
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": label,
    title: label,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: hover ? 'var(--surface-hover)' : 'transparent',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--muted)',
      cursor: 'pointer',
      transition: 'background-color var(--transition-fast)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/data/Card.jsx
try { (() => {
function Card({
  title,
  icon,
  action,
  callout = false,
  padding = 20,
  style,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: callout ? 'var(--surface-callout)' : 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: callout ? 'none' : 'var(--shadow-card)',
      padding,
      ...style
    }
  }, (title || action) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 'var(--text-md)',
      fontWeight: 700,
      color: 'var(--ink)',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: 'var(--navy-500)'
    }
  }, icon), title), action), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Card.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function Row({
  row,
  columns,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("tr", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: onClick,
    style: {
      background: hover ? 'var(--surface-hover)' : 'transparent',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'background-color var(--transition-fast)'
    }
  }, columns.map((c, i) => /*#__PURE__*/React.createElement("td", {
    key: i,
    style: {
      padding: '10px 12px',
      borderTop: '1px solid var(--border-thin)',
      fontSize: 'var(--text-base)',
      textAlign: c.align || 'left',
      fontFamily: c.mono ? 'var(--font-mono)' : 'inherit',
      color: c.muted ? 'var(--text-secondary)' : 'inherit',
      whiteSpace: 'nowrap',
      ...(c.grow ? {
        whiteSpace: 'normal',
        width: '100%'
      } : {})
    }
  }, c.render ? c.render(row) : row[c.key])));
}
function DataTable({
  columns = [],
  rows = [],
  onRowClick,
  style
}) {
  return /*#__PURE__*/React.createElement("table", {
    style: {
      borderCollapse: 'collapse',
      width: '100%',
      ...style
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map((c, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    style: {
      padding: '6px 12px',
      textAlign: c.align || 'left',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      fontWeight: 500,
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)'
    }
  }, c.header)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement(Row, {
    key: i,
    row: r,
    columns: columns,
    onClick: onRowClick ? () => onRowClick(r) : undefined
  }))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/StatusChip.jsx
try { (() => {
const STYLES = {
  ontrack: ['var(--chip-ontrack-bg)', 'var(--chip-ontrack-fg)', 'on track'],
  atrisk: ['var(--chip-atrisk-bg)', 'var(--chip-atrisk-fg)', 'at risk'],
  blocked: ['var(--chip-blocked-bg)', 'var(--chip-blocked-fg)', 'blocked'],
  done: ['var(--chip-done-bg)', 'var(--chip-done-fg)', 'done'],
  overdue: ['var(--chip-overdue-bg)', 'var(--chip-overdue-fg)', 'overdue'],
  waiting: ['var(--chip-waiting-bg)', 'var(--chip-waiting-fg)', 'waiting'],
  open: ['var(--chip-open-bg)', 'var(--chip-open-fg)', 'open']
};
function StatusChip({
  status = 'open',
  label,
  style
}) {
  const [bg, fg, text] = STYLES[status] || STYLES.open;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      background: bg,
      color: fg,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, label || text);
}
Object.assign(__ds_scope, { StatusChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatusChip.jsx", error: String((e && e.message) || e) }); }

// components/forms/FormField.jsx
try { (() => {
function FormField({
  label,
  hint,
  style,
  children
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      marginBottom: 6
    }
  }, label), children, hint && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      marginTop: 6
    }
  }, hint));
}
Object.assign(__ds_scope, { FormField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FormField.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const ctl = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-base)',
  color: 'var(--ink)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 12px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'box-shadow var(--transition-fast),border-color var(--transition-fast)'
};
function Input({
  mono = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("input", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      ...ctl,
      ...(mono ? {
        fontFamily: 'var(--font-mono)'
      } : {}),
      ...(focus ? {
        boxShadow: 'var(--focus-ring)',
        borderColor: 'var(--navy-500)'
      } : {}),
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  options = [],
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("select", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      color: 'var(--ink)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      outline: 'none',
      width: '100%',
      boxSizing: 'border-box',
      appearance: 'auto',
      transition: 'box-shadow var(--transition-fast)',
      ...(focus ? {
        boxShadow: 'var(--focus-ring)',
        borderColor: 'var(--navy-500)'
      } : {}),
      ...style
    }
  }, rest), options.map(o => typeof o === 'string' ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/shell/RelatedPanel.jsx
try { (() => {
function LinkRow({
  row,
  onOpen
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onOpen,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      width: '100%',
      textAlign: 'left',
      padding: '8px 10px',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      background: hover ? 'var(--surface-hover)' : 'transparent',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      transition: 'background-color var(--transition-fast)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 'var(--text-base)',
      color: 'var(--text-link)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, row.title), row.meta && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)',
      marginTop: 2
    }
  }, row.meta)), row.trailing);
}
function RelatedPanel({
  sections = [],
  style
}) {
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: 16,
      boxSizing: 'border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 4px',
      fontSize: 'var(--text-md)',
      fontWeight: 700
    }
  }, "Related"), sections.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      padding: '0 10px',
      marginBottom: 4
    }
  }, s.label, typeof s.count === 'number' && /*#__PURE__*/React.createElement("span", null, " (", s.count, ")")), s.rows && s.rows.length ? s.rows.map((r, j) => /*#__PURE__*/React.createElement(LinkRow, {
    key: j,
    row: r,
    onOpen: r.onOpen
  })) : /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      padding: '2px 10px'
    }
  }, s.empty || 'Nothing linked yet.'))));
}
Object.assign(__ds_scope, { RelatedPanel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/RelatedPanel.jsx", error: String((e && e.message) || e) }); }

// components/shell/Sidebar.jsx
try { (() => {
function NavItem({
  item,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      textAlign: 'left',
      padding: '8px 12px',
      borderRadius: 'var(--radius-sm)',
      border: 'none',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      fontWeight: active ? 500 : 400,
      color: active ? '#FFFFFF' : 'var(--text-inverse-muted)',
      background: active ? 'rgba(255,255,255,.16)' : hover ? 'rgba(255,255,255,.06)' : 'transparent',
      transition: 'background-color var(--transition-fast),color var(--transition-fast)'
    }
  }, item.icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      width: 16,
      height: 16,
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, item.icon), item.label);
}
function Sidebar({
  appName = 'Command Center',
  items = [],
  activeId,
  onNavigate,
  onQuickAdd,
  footer,
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: 'var(--sidebar-width)',
      minWidth: 'var(--sidebar-width)',
      background: 'var(--surface-sidebar)',
      color: 'var(--text-inverse)',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 12px',
      boxSizing: 'border-box',
      minHeight: '100%',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 'var(--text-md)',
      color: '#FFFFFF',
      padding: '0 12px',
      marginBottom: 20
    }
  }, appName), onQuickAdd && /*#__PURE__*/React.createElement("button", {
    onClick: onQuickAdd,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      margin: '0 0 16px',
      padding: '10px 12px',
      borderRadius: 'var(--radius-sm)',
      border: 'none',
      background: '#FFFFFF',
      color: 'var(--navy)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      fontWeight: 500,
      cursor: 'pointer',
      boxShadow: '0 1px 3px rgba(0,0,0,.18)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  })), "Quick add"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--muted)'
    }
  }, "N")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, items.map(it => /*#__PURE__*/React.createElement(NavItem, {
    key: it.id,
    item: it,
    active: it.id === activeId,
    onClick: () => onNavigate && onNavigate(it.id)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto'
    }
  }, footer));
}
Object.assign(__ds_scope, { Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/ActionItemsScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const ITEMS = [{
  title: 'Confirm kickoff agenda with Meridian',
  owner: 'Me',
  context: 'Meridian Health · Onboarding',
  due: 'Aug 28',
  status: 'overdue',
  source: 'Meeting'
}, {
  title: 'Send weekly status to Halcyon',
  owner: 'Me',
  context: 'Halcyon Labs · Retainer',
  due: 'Aug 29',
  status: 'open',
  source: 'Manual'
}, {
  title: 'Approve subcontractor hours',
  owner: 'Me',
  context: 'Internal',
  due: 'Aug 29',
  status: 'open',
  source: 'Email'
}, {
  title: 'Send revised SOW to Meridian',
  owner: 'Me',
  context: 'Meridian Health · Onboarding',
  due: 'Sep 2',
  status: 'atrisk',
  source: 'Meeting'
}, {
  title: 'Northgate discovery report draft',
  owner: 'Me',
  context: 'Northgate Partners · Discovery',
  due: 'Sep 4',
  status: 'atrisk',
  source: 'Meeting'
}, {
  title: 'Waiting on Beacon data export',
  owner: 'Beacon',
  context: 'Beacon and Cole · Audit',
  due: 'Sep 5',
  status: 'waiting',
  source: 'Email'
}, {
  title: 'Reconcile August hours',
  owner: 'Me',
  context: 'Internal · Billing',
  due: 'Sep 5',
  status: 'open',
  source: 'Manual'
}, {
  title: 'File onboarding SOP update',
  owner: 'Me',
  context: 'Internal · SOPs',
  due: 'Aug 26',
  status: 'done',
  source: 'Meeting'
}];
const VIEWS = ['All', 'Overdue', 'Due today', 'Waiting on', 'By project'];
function ActionItemsScreen() {
  const {
    DataTable,
    StatusChip,
    Button,
    IconButton
  } = DS();
  const [view, setView] = React.useState('All');
  const rows = ITEMS.filter(r => view === 'Overdue' ? r.status === 'overdue' : view === 'Due today' ? r.due === 'Aug 29' : view === 'Waiting on' ? r.status === 'waiting' : true);
  const link = /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
  }));
  const plus = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Action items"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Every commitment from your meetings, tracked to done.")), /*#__PURE__*/React.createElement(Button, null, plus, "New action item")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4,
      marginBottom: 16,
      borderBottom: '1px solid var(--border-thin)'
    }
  }, VIEWS.map(v => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setView(v),
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      padding: '8px 12px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: v === view ? 'var(--navy)' : 'var(--text-secondary)',
      fontWeight: v === view ? 500 : 400,
      borderBottom: v === view ? '2px solid var(--navy)' : '2px solid transparent',
      marginBottom: -1
    }
  }, v))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: '4px 8px 8px'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      header: 'Title',
      key: 'title',
      grow: true
    }, {
      header: 'Owner',
      key: 'owner',
      muted: true
    }, {
      header: 'Context',
      key: 'context',
      muted: true
    }, {
      header: 'Deadline',
      key: 'due',
      mono: true
    }, {
      header: 'Status',
      render: r => /*#__PURE__*/React.createElement(StatusChip, {
        status: r.status
      })
    }, {
      header: 'Source',
      key: 'source',
      muted: true
    }, {
      header: '',
      render: () => /*#__PURE__*/React.createElement(IconButton, {
        label: "Open in Asana",
        size: 26
      }, link),
      align: 'right'
    }],
    rows: rows,
    onRowClick: () => {}
  }), !rows.length && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '28px 12px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "No action items in this view yet. Add your first one to get started."), /*#__PURE__*/React.createElement(Button, null, plus, "New action item"))));
}
Object.assign(__ds_scope, { ActionItemsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/ActionItemsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/ClientsScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const CLIENTS = [{
  id: 0,
  name: 'Meridian Health',
  contacts: [['Dana Okafor', 'Sponsor, VP Operations'], ['Sam Reyes', 'Finance']],
  terms: 'Net 30 · monthly billing',
  notes: 'Prefers written summaries before calls. Legal review adds about a week to any contract step.',
  projects: [{
    t: 'Onboarding program design',
    m: 'Planning',
    s: 'atrisk'
  }],
  invoices: [{
    t: 'INV-2041',
    m: '$12,400 · outstanding 18 days',
    s: 'open'
  }],
  meetings: [{
    t: 'Meridian phase review',
    m: 'Aug 29, 14:00'
  }, {
    t: 'Kickoff planning',
    m: 'Aug 26'
  }]
}, {
  id: 1,
  name: 'Halcyon Labs',
  contacts: [['Priya Nair', 'COO']],
  terms: 'Net 15 · retainer',
  notes: 'Fast payer. Weekly sync every Friday 09:30.',
  projects: [{
    t: 'Ops retainer',
    m: 'Executing',
    s: 'ontrack'
  }, {
    t: 'Q2 process review',
    m: 'Closing',
    s: 'done'
  }],
  invoices: [{
    t: 'INV-2043',
    m: '$6,250 · outstanding 9 days',
    s: 'open'
  }, {
    t: 'INV-2032',
    m: '$8,400 · paid',
    s: 'done'
  }],
  meetings: [{
    t: 'Halcyon weekly sync',
    m: 'Aug 29, 09:30'
  }]
}, {
  id: 2,
  name: 'Northgate Partners',
  contacts: [['Tom Ellison', 'Managing Partner']],
  terms: 'Net 30 · milestone billing',
  notes: 'Slow AP process; invoice reminders go to Tom directly.',
  projects: [{
    t: 'Discovery engagement',
    m: 'Executing',
    s: 'atrisk'
  }],
  invoices: [{
    t: 'INV-2036',
    m: '$8,200 · outstanding 64 days',
    s: 'overdue'
  }],
  meetings: [{
    t: 'Discovery readout prep',
    m: 'Aug 25'
  }]
}, {
  id: 3,
  name: 'Beacon and Cole',
  contacts: [['Ana Ruiz', 'Compliance Lead']],
  terms: 'Net 45 · monthly billing',
  notes: 'Waiting on their data export since Aug 21.',
  projects: [{
    t: 'Compliance audit',
    m: 'Monitoring',
    s: 'waiting'
  }],
  invoices: [{
    t: 'INV-2038',
    m: '$4,100 · outstanding 34 days',
    s: 'open'
  }],
  meetings: []
}];
function ClientsScreen({
  onNavigate
}) {
  const {
    Card,
    StatusChip,
    Button,
    RelatedPanel
  } = DS();
  const plus = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  const person = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"
  }));
  const [sel, setSel] = React.useState(0);
  const c = CLIENTS[sel];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Clients"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Who you work with, and everything connected to them.")), /*#__PURE__*/React.createElement(Button, null, plus, "New client")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '300px 1fr 320px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: 8
    }
  }, CLIENTS.map((cl, i) => /*#__PURE__*/React.createElement(ClientRow, {
    key: cl.id,
    c: cl,
    active: i === sel,
    onClick: () => setSel(i)
  }))), /*#__PURE__*/React.createElement(Card, {
    icon: person,
    title: c.name
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      marginBottom: 6
    }
  }, "Key contacts"), c.contacts.map(([n, r]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '10px 0',
      borderBottom: '1px solid var(--border-thin)',
      fontSize: 'var(--text-base)'
    }
  }, /*#__PURE__*/React.createElement("span", null, n), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)'
    }
  }, r))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      margin: '18px 0 6px'
    }
  }, "Billing terms"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)'
    }
  }, c.terms), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      margin: '18px 0 6px'
    }
  }, "Notes"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-base)',
      lineHeight: 1.6
    }
  }, c.notes)), /*#__PURE__*/React.createElement(RelatedPanel, {
    sections: [{
      label: 'Projects',
      count: c.projects.length,
      rows: c.projects.map(p => ({
        title: p.t,
        meta: p.m + ' phase',
        trailing: /*#__PURE__*/React.createElement(StatusChip, {
          status: p.s
        }),
        onOpen: () => onNavigate && onNavigate('projects')
      }))
    }, {
      label: 'Invoices',
      count: c.invoices.length,
      rows: c.invoices.map(iv => ({
        title: iv.t,
        meta: iv.m,
        trailing: /*#__PURE__*/React.createElement(StatusChip, {
          status: iv.s,
          label: iv.s === 'done' ? 'paid' : undefined
        }),
        onOpen: () => onNavigate && onNavigate('invoicing')
      }))
    }, {
      label: 'Meetings',
      count: c.meetings.length,
      rows: c.meetings.map(mt => ({
        title: mt.t,
        meta: mt.m,
        onOpen: () => onNavigate && onNavigate('meetings')
      })),
      empty: 'No meetings logged yet.'
    }]
  })));
}
function ClientRow({
  c,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      padding: '11px 12px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: active ? 'var(--navy-50)' : hover ? 'var(--surface-hover)' : 'transparent',
      transition: 'background-color var(--transition-fast)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-base)',
      fontWeight: active ? 500 : 400
    }
  }, c.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)',
      marginTop: 3
    }
  }, c.projects.length, " project", c.projects.length > 1 ? 's' : '', " \xB7 ", c.terms.split(' · ')[0]));
}
Object.assign(__ds_scope, { ClientsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/ClientsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/InvoicingScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const BUCKETS = [["0 to 30", "$18,650"], ["31 to 60", "$4,100"], ["61 to 90", "$8,200"], ["90 plus", "$0"]];
const ROWS = [{
  client: 'Meridian Health',
  period: 'Aug 2026',
  hours: '22.5 / 22.5',
  invoiced: '$12,400',
  paid: '$0',
  out: '$12,400',
  bucket: '0 to 30',
  hot: false
}, {
  client: 'Halcyon Labs',
  period: 'Aug 2026',
  hours: '31.0 / 31.0',
  invoiced: '$9,300',
  paid: '$3,050',
  out: '$6,250',
  bucket: '0 to 30',
  hot: false
}, {
  client: 'Northgate Partners',
  period: 'Jun 2026',
  hours: '18.0 / 18.0',
  invoiced: '$8,200',
  paid: '$0',
  out: '$8,200',
  bucket: '61 to 90',
  hot: true
}, {
  client: 'Beacon and Cole',
  period: 'Jul 2026',
  hours: '12.5 / 14.0',
  invoiced: '$4,100',
  paid: '$0',
  out: '$4,100',
  bucket: '31 to 60',
  hot: false
}, {
  client: 'Halcyon Labs',
  period: 'Jul 2026',
  hours: '28.0 / 28.0',
  invoiced: '$8,400',
  paid: '$8,400',
  out: '$0',
  bucket: 'paid',
  hot: false
}];
function InvoicingScreen() {
  const {
    DataTable,
    StatusChip,
    Button
  } = DS();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Invoicing"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Hours to invoiced to paid, with aging you can see.")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Export PDF")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginBottom: 20
    }
  }, BUCKETS.map(([label, amt], i) => {
    const hot = i >= 2 && amt !== '$0';
    return /*#__PURE__*/React.createElement("div", {
      key: label,
      style: {
        background: hot ? 'var(--gold-50)' : 'var(--surface-card)',
        border: hot ? '1px solid var(--gold)' : '1px solid var(--border-thin)',
        borderRadius: 'var(--radius-md)',
        boxShadow: hot ? 'none' : 'var(--shadow-card)',
        padding: '14px 16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        letterSpacing: 'var(--tracking-label)',
        textTransform: 'uppercase',
        color: hot ? 'var(--gold-600)' : 'var(--text-secondary)'
      }
    }, label, " days"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xl)',
        fontWeight: 500,
        marginTop: 6,
        color: hot ? 'var(--gold-600)' : 'var(--ink)'
      }
    }, amt));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: '4px 8px 8px'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      header: 'Client',
      key: 'client',
      grow: true
    }, {
      header: 'Period',
      key: 'period',
      mono: true
    }, {
      header: 'Hours reconciled',
      key: 'hours',
      mono: true,
      align: 'right'
    }, {
      header: 'Invoiced',
      key: 'invoiced',
      mono: true,
      align: 'right'
    }, {
      header: 'Paid',
      key: 'paid',
      mono: true,
      align: 'right'
    }, {
      header: 'Outstanding',
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: 'var(--font-mono)',
          color: r.hot ? 'var(--gold-600)' : 'inherit',
          fontWeight: r.hot ? 500 : 400
        }
      }, r.out),
      align: 'right'
    }, {
      header: 'Aging',
      render: r => r.bucket === 'paid' ? /*#__PURE__*/React.createElement(StatusChip, {
        status: "done",
        label: "paid"
      }) : /*#__PURE__*/React.createElement(StatusChip, {
        status: r.hot ? 'overdue' : 'open',
        label: r.bucket
      })
    }],
    rows: ROWS,
    onRowClick: () => {}
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 4px 0',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, "Each invoice traces back to its billing period and time entries. Open a row to see them."));
}
Object.assign(__ds_scope, { InvoicingScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/InvoicingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/LoginScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
function LoginScreen({
  onSignIn
}) {
  const {
    Card,
    Button,
    Input,
    FormField
  } = DS();
  const [pin, setPin] = React.useState('');
  const set = v => {
    const p = v.replace(/\D/g, '');
    setPin(p);
    if (p.length === 6) setTimeout(() => onSignIn && onSignIn(), 250);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 360
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-lg)',
      fontWeight: 700,
      color: 'var(--navy)'
    }
  }, "Command Center"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)',
      marginTop: 6
    }
  }, "Enter the PIN from your email to sign in.")), /*#__PURE__*/React.createElement(Card, {
    padding: 24,
    style: {
      borderRadius: 'var(--radius-lg)'
    }
  }, /*#__PURE__*/React.createElement(FormField, {
    label: "Email PIN"
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    placeholder: "000000",
    value: pin,
    maxLength: 6,
    onChange: e => set(e.target.value),
    style: {
      textAlign: 'center',
      letterSpacing: '.4em',
      fontSize: 'var(--text-lg)'
    },
    onKeyDown: e => {
      if (e.key === 'Enter' && pin.length === 6) onSignIn && onSignIn();
    }
  })), /*#__PURE__*/React.createElement(Button, {
    style: {
      width: '100%',
      justifyContent: 'center',
      marginTop: 16
    },
    disabled: pin.length !== 6,
    onClick: onSignIn
  }, "Sign in")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginTop: 16,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)'
    }
  }, "The PIN expires after 10 minutes. Demo: any 6 digits.")));
}
Object.assign(__ds_scope, { LoginScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/MeetingsScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const MEETINGS = [{
  id: 0,
  title: 'Halcyon weekly sync',
  client: 'Halcyon Labs',
  date: 'Aug 29, 09:30',
  recorded: true,
  summary: 'Reviewed sprint progress and the September review agenda. Halcyon confirmed budget for the ops retainer through Q4. Two follow-ups extracted.',
  items: [{
    t: 'Send weekly status to Halcyon',
    due: 'Aug 29',
    status: 'open'
  }, {
    t: 'Draft Q4 retainer renewal note',
    due: 'Sep 3',
    status: 'open'
  }],
  project: 'Ops retainer'
}, {
  id: 1,
  title: 'Meridian phase review',
  client: 'Meridian Health',
  date: 'Aug 29, 14:00',
  recorded: false,
  summary: 'Agenda drafted. SOW signature is the open blocker; legal review has not moved in five days.',
  items: [{
    t: 'Send revised SOW to Meridian',
    due: 'Sep 2',
    status: 'atrisk'
  }],
  project: 'Onboarding program design'
}, {
  id: 2,
  title: 'Kickoff planning with Meridian',
  client: 'Meridian Health',
  date: 'Aug 26, 10:00',
  recorded: true,
  summary: 'Confirmed stakeholder map and success criteria. Kickoff pending signed SOW. Two action items extracted.',
  items: [{
    t: 'Confirm kickoff agenda with Meridian',
    due: 'Aug 28',
    status: 'overdue'
  }, {
    t: 'Draft stakeholder brief',
    due: 'Aug 22',
    status: 'done'
  }],
  project: 'Onboarding program design'
}, {
  id: 3,
  title: 'Northgate discovery readout prep',
  client: 'Northgate Partners',
  date: 'Aug 25, 15:00',
  recorded: true,
  summary: 'Walked the draft findings. Report is 40 percent done against a Sep 4 milestone.',
  items: [{
    t: 'Northgate discovery report draft',
    due: 'Sep 4',
    status: 'atrisk'
  }],
  project: 'Discovery engagement'
}];
function MeetingsScreen({
  onNavigate
}) {
  const {
    Card,
    StatusChip,
    Button,
    IconButton,
    RelatedPanel
  } = DS();
  const [sel, setSel] = React.useState(0);
  const m = MEETINGS[sel];
  const play = /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m10 8 6 4-6 4V8z"
  }));
  const plus = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  const smallPlus = /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  const video = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M16 10l6-4v12l-6-4M2 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z"
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Meetings"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Every conversation, captured with its follow-ups.")), /*#__PURE__*/React.createElement(Button, null, plus, "Log meeting")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '380px 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: 8
    }
  }, MEETINGS.map((mt, i) => /*#__PURE__*/React.createElement(MeetingRow, {
    key: mt.id,
    m: mt,
    active: i === sel,
    onClick: () => setSel(i)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    icon: video,
    title: m.title,
    action: m.recorded ? /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm"
    }, play, "Recording") : /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "not recorded")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)',
      marginBottom: 12
    }
  }, m.date, " \xB7 ", m.client), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      marginBottom: 6
    }
  }, "AI summary"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 20px',
      fontSize: 'var(--text-base)',
      lineHeight: 1.6
    }
  }, m.summary), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      marginBottom: 4
    }
  }, "Extracted action items"), m.items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.t,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid var(--border-thin)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 'var(--text-base)'
    }
  }, it.t), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)'
    }
  }, "Due ", it.due), /*#__PURE__*/React.createElement(StatusChip, {
    status: it.status
  }), /*#__PURE__*/React.createElement(IconButton, {
    label: "Create action item",
    size: 28
  }, smallPlus)))), /*#__PURE__*/React.createElement(RelatedPanel, {
    sections: [{
      label: 'Project',
      count: 1,
      rows: [{
        title: m.project,
        meta: m.client,
        onOpen: () => onNavigate && onNavigate('projects')
      }]
    }, {
      label: 'Action items',
      count: m.items.length,
      rows: m.items.map(it => ({
        title: it.t,
        meta: 'Due ' + it.due,
        trailing: /*#__PURE__*/React.createElement(StatusChip, {
          status: it.status
        }),
        onOpen: () => onNavigate && onNavigate('actions')
      }))
    }, {
      label: 'Client',
      count: 1,
      rows: [{
        title: m.client,
        meta: 'Client record',
        onOpen: () => onNavigate && onNavigate('clients')
      }]
    }]
  }))));
}
function MeetingRow({
  m,
  active,
  onClick
}) {
  const {
    StatusChip
  } = DS();
  const [hover, setHover] = React.useState(false);
  const risky = m.items.some(i => i.status === 'atrisk' || i.status === 'overdue');
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      padding: '12px 12px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: active ? 'var(--navy-50)' : hover ? 'var(--surface-hover)' : 'transparent',
      transition: 'background-color var(--transition-fast)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-base)',
      fontWeight: active ? 500 : 400
    }
  }, m.title), risky && /*#__PURE__*/React.createElement(StatusChip, {
    status: "atrisk"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)',
      marginTop: 3
    }
  }, m.date, " \xB7 ", m.client, " \xB7 ", m.items.length, " action item", m.items.length > 1 ? 's' : ''));
}
Object.assign(__ds_scope, { MeetingsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/MeetingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/ProjectDetailScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const CHECKLIST = [{
  label: 'Stakeholder map confirmed',
  done: true
}, {
  label: 'Scope and success criteria drafted',
  done: true
}, {
  label: 'SOW signed',
  done: false,
  atrisk: true
}, {
  label: 'Kickoff scheduled',
  done: false
}, {
  label: 'Delivery plan baselined',
  done: false
}];
function ProjectDetailScreen({
  onBack,
  onNavigate
}) {
  const {
    StatusChip,
    Card,
    Button,
    RelatedPanel
  } = DS();
  const check = /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onBack,
    style: {
      cursor: 'pointer'
    }
  }, "Projects"), " / Onboarding program design"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Onboarding program design"), /*#__PURE__*/React.createElement(StatusChip, {
    status: "atrisk"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 20px',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Meridian Health \xB7 Planning phase \xB7 next milestone Signed SOW, Sep 2"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 340px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    icon: /*#__PURE__*/React.createElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
    })),
    title: "Planning checklist",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--green)'
      }
    }, "2 of 5 done")
  }, CHECKLIST.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.label,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 0',
      borderBottom: '1px solid var(--border-thin)',
      fontSize: 'var(--text-base)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 6,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: c.done ? 'none' : '1px solid var(--border-strong)',
      background: c.done ? 'var(--green)' : 'transparent',
      color: '#fff'
    }
  }, c.done ? check : null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: c.done ? 'var(--text-secondary)' : 'var(--ink)',
      textDecoration: c.done ? 'line-through' : 'none',
      flex: 1
    }
  }, c.label), c.atrisk && /*#__PURE__*/React.createElement(StatusChip, {
    status: "atrisk"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Advance to Executing"))), /*#__PURE__*/React.createElement(RelatedPanel, {
    sections: [{
      label: 'Action items',
      count: 3,
      rows: [{
        title: 'Send revised SOW to Meridian',
        meta: 'Due Sep 2',
        trailing: /*#__PURE__*/React.createElement(StatusChip, {
          status: "atrisk"
        }),
        onOpen: () => onNavigate && onNavigate('actions')
      }, {
        title: 'Confirm kickoff agenda',
        meta: 'Due Aug 28',
        trailing: /*#__PURE__*/React.createElement(StatusChip, {
          status: "overdue"
        }),
        onOpen: () => onNavigate && onNavigate('actions')
      }, {
        title: 'Draft stakeholder brief',
        meta: 'Done Aug 22',
        trailing: /*#__PURE__*/React.createElement(StatusChip, {
          status: "done"
        }),
        onOpen: () => onNavigate && onNavigate('actions')
      }]
    }, {
      label: 'Meetings',
      count: 2,
      rows: [{
        title: 'Kickoff planning with Meridian',
        meta: 'Aug 26 · recorded · 2 action items'
      }, {
        title: 'Scope working session',
        meta: 'Aug 19 · recorded'
      }]
    }, {
      label: 'Time',
      rows: [{
        title: 'August hours',
        meta: '22.5 h logged · unreconciled'
      }]
    }, {
      label: 'Invoices',
      count: 1,
      rows: [{
        title: 'INV-2041',
        meta: '$12,400 · outstanding 18 days',
        onOpen: () => onNavigate && onNavigate('invoicing')
      }]
    }]
  })));
}
Object.assign(__ds_scope, { ProjectDetailScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/ProjectDetailScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/ProjectsScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const PHASES = ['Initiating', 'Planning', 'Executing', 'Monitoring', 'Closing'];
const PROJECTS = [{
  name: 'Onboarding program design',
  client: 'Meridian Health',
  phase: 'Planning',
  status: 'atrisk',
  milestone: 'Signed SOW · Sep 2'
}, {
  name: 'Ops retainer',
  client: 'Halcyon Labs',
  phase: 'Executing',
  status: 'ontrack',
  milestone: 'Monthly review · Sep 12'
}, {
  name: 'Discovery engagement',
  client: 'Northgate Partners',
  phase: 'Executing',
  status: 'atrisk',
  milestone: 'Discovery report · Sep 4'
}, {
  name: 'Compliance audit',
  client: 'Beacon and Cole',
  phase: 'Monitoring',
  status: 'waiting',
  milestone: 'Data export received'
}, {
  name: 'Q2 process review',
  client: 'Halcyon Labs',
  phase: 'Closing',
  status: 'done',
  milestone: 'Final readout · done'
}];
function ProjectsScreen({
  onOpenProject
}) {
  const {
    StatusChip,
    Button
  } = DS();
  const plus = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Projects"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Your engagements from initiation to closing.")), /*#__PURE__*/React.createElement(Button, null, plus, "New project")), PHASES.map(ph => {
    const rows = PROJECTS.filter(p => p.phase === ph);
    return /*#__PURE__*/React.createElement("div", {
      key: ph,
      style: {
        marginBottom: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        letterSpacing: 'var(--tracking-label)',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        marginBottom: 8
      }
    }, ph, " (", rows.length, ")"), rows.length ? rows.map(p => /*#__PURE__*/React.createElement(ProjectRow, {
      key: p.name,
      p: p,
      onOpen: () => onOpenProject && onOpenProject(p)
    })) : /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '2px 0 2px 12px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)'
      }
    }, "Nothing here yet. Start your next engagement."), /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, plus, "New project")));
  }));
}
function ProjectRow({
  p,
  onOpen
}) {
  const {
    StatusChip
  } = DS();
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onOpen,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'grid',
      gridTemplateColumns: '2fr 1.2fr 1.4fr auto',
      gap: 16,
      alignItems: 'center',
      background: hover ? 'var(--surface-hover)' : 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: '12px 16px',
      marginBottom: 8,
      cursor: 'pointer',
      transition: 'background-color var(--transition-fast)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-base)',
      fontWeight: 500
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, p.client), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)'
    }
  }, p.milestone), /*#__PURE__*/React.createElement(StatusChip, {
    status: p.status
  }));
}
Object.assign(__ds_scope, { ProjectsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/ProjectsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/ReportsScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const REPORTS = [{
  id: 'billing',
  title: 'Billing and aging',
  desc: 'Outstanding by client and aging bucket.'
}, {
  id: 'projects',
  title: 'Project status',
  desc: 'Phase and status across all projects.'
}, {
  id: 'followup',
  title: 'Follow-up completion',
  desc: 'Action items closed on time, by week.'
}, {
  id: 'hours',
  title: 'Partner hours saved',
  desc: 'Hours captured by automation each month.'
}];
function Bar({
  label,
  value,
  max,
  gold
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '150px 1fr 70px',
      gap: 12,
      alignItems: 'center',
      padding: '7px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 8,
      background: 'var(--surface-hover)',
      borderRadius: 999
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: value / max * 100 + '%',
      height: 8,
      borderRadius: 999,
      background: gold ? 'var(--gold)' : 'var(--navy)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      textAlign: 'right'
    }
  }, '$' + value.toLocaleString()));
}
function ReportsScreen() {
  const {
    Card,
    Button,
    StatusChip
  } = DS();
  const [sel, setSel] = React.useState('billing');
  const chart = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 3v18h18M18 17V9M13 17V5M8 17v-3"
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Reports"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "The short list of numbers that matter.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Export PDF"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost"
  }, "Share read-only link"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '300px 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-thin)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card)',
      padding: 8
    }
  }, REPORTS.map(r => /*#__PURE__*/React.createElement(ReportRow, {
    key: r.id,
    r: r,
    active: r.id === sel,
    onClick: () => setSel(r.id)
  }))), sel === 'billing' && /*#__PURE__*/React.createElement(Card, {
    icon: chart,
    title: "Billing and aging",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "as of Aug 29, 2026")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)'
    }
  }, "Total outstanding"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xl)',
      fontWeight: 500,
      marginTop: 4
    }
  }, "$30,950")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--gold-600)'
    }
  }, "Past 60 days"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xl)',
      fontWeight: 500,
      marginTop: 4,
      color: 'var(--gold-600)'
    }
  }, "$8,200"))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      marginBottom: 4
    }
  }, "Outstanding by client"), /*#__PURE__*/React.createElement(Bar, {
    label: "Meridian Health",
    value: 12400,
    max: 12400
  }), /*#__PURE__*/React.createElement(Bar, {
    label: "Northgate Partners",
    value: 8200,
    max: 12400,
    gold: true
  }), /*#__PURE__*/React.createElement(Bar, {
    label: "Halcyon Labs",
    value: 6250,
    max: 12400
  }), /*#__PURE__*/React.createElement(Bar, {
    label: "Beacon and Cole",
    value: 4100,
    max: 12400
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '14px 0 0',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, "Gold marks balances past 60 days. Rows trace to invoices and their billing periods.")), sel === 'projects' && /*#__PURE__*/React.createElement(Card, {
    icon: chart,
    title: "Project status",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "as of Aug 29, 2026")
  }, [['Onboarding program design', 'Planning', 'atrisk'], ['Ops retainer', 'Executing', 'ontrack'], ['Discovery engagement', 'Executing', 'atrisk'], ['Compliance audit', 'Monitoring', 'waiting'], ['Q2 process review', 'Closing', 'done']].map(([n, ph, s]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 120px auto',
      gap: 12,
      alignItems: 'center',
      padding: '11px 0',
      borderBottom: '1px solid var(--border-thin)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-base)'
    }
  }, n), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)'
    }
  }, ph), /*#__PURE__*/React.createElement(StatusChip, {
    status: s
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '14px 0 0',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, "2 of 5 projects are at risk. Both trace to open action items on Today.")), sel === 'followup' && /*#__PURE__*/React.createElement(Card, {
    icon: chart,
    title: "Follow-up completion",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "last 4 weeks")
  }, [['Week of Aug 25', '8 of 10', '80%'], ['Week of Aug 18', '11 of 12', '92%'], ['Week of Aug 11', '9 of 9', '100%'], ['Week of Aug 4', '7 of 9', '78%']].map(([w, f, p]) => /*#__PURE__*/React.createElement("div", {
    key: w,
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 100px 60px',
      gap: 12,
      alignItems: 'center',
      padding: '11px 0',
      borderBottom: '1px solid var(--border-thin)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, w), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)'
    }
  }, f), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      textAlign: 'right',
      color: p === '100%' ? 'var(--green)' : 'var(--ink)'
    }
  }, p))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '14px 0 0',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, "Completed on or before the deadline, out of all items due that week.")), sel === 'hours' && /*#__PURE__*/React.createElement(Card, {
    icon: chart,
    title: "Partner hours saved",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "last 3 months")
  }, [['August', '14.5 h'], ['July', '12.0 h'], ['June', '9.5 h']].map(([m, h]) => /*#__PURE__*/React.createElement("div", {
    key: m,
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 80px',
      gap: 12,
      alignItems: 'center',
      padding: '11px 0',
      borderBottom: '1px solid var(--border-thin)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, m), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      textAlign: 'right'
    }
  }, h))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '14px 0 0',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, "Estimated from meeting capture, extraction, and invoicing automation."))));
}
function ReportRow({
  r,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      padding: '11px 12px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: active ? 'var(--navy-50)' : hover ? 'var(--surface-hover)' : 'transparent',
      transition: 'background-color var(--transition-fast)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-base)',
      fontWeight: active ? 500 : 400
    }
  }, r.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      marginTop: 2
    }
  }, r.desc));
}
Object.assign(__ds_scope, { ReportsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/ReportsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/SopsScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const SOPS = [{
  cat: 'Client delivery',
  items: [{
    title: 'Project kickoff checklist',
    v: 'v4',
    updated: 'Aug 12, 2026',
    sel: true
  }, {
    title: 'Weekly status report format',
    v: 'v2',
    updated: 'Jul 30, 2026'
  }, {
    title: 'Phase gate review',
    v: 'v3',
    updated: 'Jun 18, 2026'
  }]
}, {
  cat: 'Billing',
  items: [{
    title: 'Monthly invoicing run',
    v: 'v5',
    updated: 'Aug 2, 2026'
  }, {
    title: 'Aging follow-up cadence',
    v: 'v1',
    updated: 'May 9, 2026'
  }]
}, {
  cat: 'Internal',
  items: [{
    title: 'Meeting capture and follow-up',
    v: 'v2',
    updated: 'Aug 20, 2026'
  }, {
    title: 'New client onboarding',
    v: 'v3',
    updated: 'Jul 11, 2026'
  }]
}];
const HISTORY = [{
  v: 'v4',
  date: 'Aug 12, 2026',
  note: 'Added SOW signature gate before kickoff.',
  current: true
}, {
  v: 'v3',
  date: 'May 28, 2026',
  note: 'Merged stakeholder map into step 2.'
}, {
  v: 'v2',
  date: 'Feb 14, 2026',
  note: 'Added recording setup step.'
}, {
  v: 'v1',
  date: 'Nov 3, 2025',
  note: 'First written version.'
}];
function SopsScreen() {
  const {
    Card,
    Input,
    Button
  } = DS();
  const plus = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  const book = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"
  }));
  const history = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3"
  }));
  const [sel, setSel] = React.useState('Project kickoff checklist');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "SOPs"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "How the work gets done, written down and current.")), /*#__PURE__*/React.createElement(Button, null, plus, "New SOP")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '320px 1fr 280px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search SOPs",
    style: {
      marginBottom: 12
    }
  }), SOPS.map(g => /*#__PURE__*/React.createElement("div", {
    key: g.cat,
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      margin: '0 0 4px 10px'
    }
  }, g.cat), g.items.map(s => /*#__PURE__*/React.createElement(SopRow, {
    key: s.title,
    s: s,
    active: s.title === sel,
    onClick: () => setSel(s.title)
  }))))), /*#__PURE__*/React.createElement(Card, {
    icon: book,
    title: "Project kickoff checklist",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "v4 \xB7 Aug 12, 2026")
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 'var(--text-base)',
      lineHeight: 1.6
    }
  }, "Run this before every engagement moves from Planning to Executing. The SOW must be signed before any kickoff is scheduled."), /*#__PURE__*/React.createElement("ol", {
    style: {
      margin: 0,
      paddingLeft: 20,
      fontSize: 'var(--text-base)',
      lineHeight: 1.6,
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("li", null, "Confirm the stakeholder map with the client sponsor."), /*#__PURE__*/React.createElement("li", null, "Verify the SOW is signed and filed in the client record."), /*#__PURE__*/React.createElement("li", null, "Schedule the kickoff and send the agenda two days ahead."), /*#__PURE__*/React.createElement("li", null, "Set up the recording and note capture for the kickoff."), /*#__PURE__*/React.createElement("li", null, "Create the project in Asana from the engagement template."), /*#__PURE__*/React.createElement("li", null, "Log the first billing period against the project."))), /*#__PURE__*/React.createElement(Card, {
    icon: history,
    title: "Version history",
    padding: 14
  }, HISTORY.map(h => /*#__PURE__*/React.createElement("div", {
    key: h.v,
    style: {
      padding: '10px 0',
      borderBottom: '1px solid var(--border-thin)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: h.current ? 'var(--green)' : 'var(--ink)'
    }
  }, h.v, h.current ? ' · current' : ''), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)'
    }
  }, h.date)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      marginTop: 3
    }
  }, h.note))))));
}
function SopRow({
  s,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '9px 10px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: active ? 'var(--navy-50)' : hover ? 'var(--surface-hover)' : 'transparent',
      transition: 'background-color var(--transition-fast)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-base)',
      fontWeight: active ? 500 : 400
    }
  }, s.title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)'
    }
  }, s.v));
}
Object.assign(__ds_scope, { SopsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/SopsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/TemplatesScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
const TEMPLATES = [{
  cat: 'Replies',
  items: [{
    title: 'Invoice reminder, first touch',
    tags: ['billing', 'email'],
    body: 'A calm first reminder sent when an invoice passes its terms by a few days.'
  }, {
    title: 'Invoice reminder, 60 plus days',
    tags: ['billing', 'aging', 'email'],
    body: 'Firm follow-up for invoices past 60 days, copied to the finance contact.'
  }, {
    title: 'Meeting follow-up with action items',
    tags: ['meetings', 'email'],
    body: 'Post-meeting summary that lists extracted action items with owners and dates.'
  }, {
    title: 'Scope change acknowledgment',
    tags: ['delivery', 'email'],
    body: 'Confirms a requested change and points to the SOW amendment step.'
  }]
}, {
  cat: 'Documents',
  items: [{
    title: 'Weekly status report',
    tags: ['delivery', 'doc'],
    body: 'One-page status: progress, risks, next milestones, hours used.'
  }, {
    title: 'SOW amendment',
    tags: ['contracts', 'doc'],
    body: 'Standard amendment shell with scope, fee, and timeline fields.'
  }, {
    title: 'Project closeout summary',
    tags: ['delivery', 'doc'],
    body: 'Final readout: outcomes, open items handed off, archive links.'
  }]
}];
function TemplatesScreen() {
  const {
    Card,
    Button,
    Input
  } = DS();
  const plus = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }));
  const doc = /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Templates"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Ready-made replies and documents, one click to use.")), /*#__PURE__*/React.createElement(Button, null, plus, "New template")), /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search templates or tags",
    style: {
      maxWidth: 420,
      marginBottom: 20
    }
  }), TEMPLATES.map(g => /*#__PURE__*/React.createElement("div", {
    key: g.cat,
    style: {
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      marginBottom: 10
    }
  }, g.cat), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2,1fr)',
      gap: 12
    }
  }, g.items.map(t => /*#__PURE__*/React.createElement(Card, {
    key: t.title,
    padding: 16,
    icon: doc,
    title: t.title,
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm"
    }, "Use")
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)',
      lineHeight: 1.55
    }
  }, t.body), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, t.tags.map(tag => /*#__PURE__*/React.createElement("span", {
    key: tag,
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--muted)',
      background: 'var(--surface-hover)',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)'
    }
  }, tag)))))))));
}
Object.assign(__ds_scope, { TemplatesScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/TemplatesScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/command-center/TodayScreen.jsx
try { (() => {
const DS = () => window.CommandCenterDesignSystem_a34f56;
function Label({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
      ...style
    }
  }, children);
}
function Row({
  title,
  meta,
  chip,
  gold
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '9px 10px',
      borderRadius: 'var(--radius-sm)',
      background: hover ? 'var(--surface-hover)' : 'transparent',
      cursor: 'pointer',
      borderLeft: gold ? '2px solid var(--gold)' : '2px solid transparent'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-base)',
      color: 'var(--ink)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)',
      marginTop: 2
    }
  }, meta)), chip);
}
function TodayScreen({
  onNavigate
}) {
  const {
    Card,
    StatusChip,
    Button,
    Input
  } = DS();
  const ic = d => /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: d
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 2
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 700
    }
  }, "Good morning, Paul"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, "Fri, Aug 29")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 20px',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)'
    }
  }, "Three items need your attention and one invoice is past 60 days. Halcyon is ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--green)'
    }
  }, "on track"), "."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginBottom: 24,
      maxWidth: 640
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Add an action item, meeting note, or reminder"
  }), /*#__PURE__*/React.createElement(Button, {
    style: {
      whiteSpace: 'nowrap'
    }
  }, "Quick add")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    icon: ic('M12 6v6l4 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'),
    title: "Overdue and due today",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      onClick: () => onNavigate && onNavigate('actions')
    }, "Open tracker"),
    padding: 14
  }, /*#__PURE__*/React.createElement(Row, {
    gold: true,
    title: "Confirm kickoff agenda with Meridian",
    meta: "Due Aug 28 \xB7 Meridian Health",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "overdue"
    })
  }), /*#__PURE__*/React.createElement(Row, {
    title: "Send weekly status to Halcyon",
    meta: "Due today \xB7 Halcyon Labs",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "open"
    })
  }), /*#__PURE__*/React.createElement(Row, {
    title: "Approve subcontractor hours",
    meta: "Due today \xB7 Internal",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "open"
    })
  })), /*#__PURE__*/React.createElement(Card, {
    icon: ic('M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01'),
    title: "What will slip",
    padding: 14
  }, /*#__PURE__*/React.createElement(Row, {
    gold: true,
    title: "Revised SOW waiting on legal review",
    meta: "No movement for 5 days \xB7 Meridian Health",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "atrisk"
    })
  }), /*#__PURE__*/React.createElement(Row, {
    gold: true,
    title: "Northgate discovery report draft",
    meta: "Milestone Sep 4, 40% done",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "atrisk"
    })
  }), /*#__PURE__*/React.createElement(Row, {
    title: "Waiting on Beacon data export",
    meta: "Requested Aug 21",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "waiting"
    })
  })), /*#__PURE__*/React.createElement(Card, {
    icon: ic('M16 10l6-4v12l-6-4M2 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z'),
    title: "Today's meetings",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      onClick: () => onNavigate && onNavigate('meetings')
    }, "Meetings log"),
    padding: 14
  }, /*#__PURE__*/React.createElement(Row, {
    title: "Halcyon weekly sync",
    meta: "09:30 \xB7 recurring \xB7 4 open follow-ups",
    chip: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "09:30")
  }), /*#__PURE__*/React.createElement(Row, {
    title: "Meridian phase review",
    meta: "14:00 \xB7 agenda drafted",
    chip: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)'
      }
    }, "14:00")
  })), /*#__PURE__*/React.createElement(Card, {
    icon: ic('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'),
    title: "Invoice alerts",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      onClick: () => onNavigate && onNavigate('invoicing')
    }, "Invoicing"),
    padding: 14
  }, /*#__PURE__*/React.createElement(Row, {
    gold: true,
    title: "Northgate Partners INV-2036",
    meta: "$8,200 outstanding \xB7 64 days",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "overdue",
      label: "61 to 90"
    })
  }), /*#__PURE__*/React.createElement(Row, {
    title: "Meridian Health INV-2041",
    meta: "$12,400 outstanding \xB7 18 days",
    chip: /*#__PURE__*/React.createElement(StatusChip, {
      status: "open",
      label: "0 to 30"
    })
  }))));
}
Object.assign(__ds_scope, { TodayScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/command-center/TodayScreen.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.StatusChip = __ds_scope.StatusChip;

__ds_ns.FormField = __ds_scope.FormField;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.RelatedPanel = __ds_scope.RelatedPanel;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.ActionItemsScreen = __ds_scope.ActionItemsScreen;

__ds_ns.ClientsScreen = __ds_scope.ClientsScreen;

__ds_ns.InvoicingScreen = __ds_scope.InvoicingScreen;

__ds_ns.LoginScreen = __ds_scope.LoginScreen;

__ds_ns.MeetingsScreen = __ds_scope.MeetingsScreen;

__ds_ns.ProjectDetailScreen = __ds_scope.ProjectDetailScreen;

__ds_ns.ProjectsScreen = __ds_scope.ProjectsScreen;

__ds_ns.ReportsScreen = __ds_scope.ReportsScreen;

__ds_ns.SopsScreen = __ds_scope.SopsScreen;

__ds_ns.TemplatesScreen = __ds_scope.TemplatesScreen;

__ds_ns.TodayScreen = __ds_scope.TodayScreen;

})();
