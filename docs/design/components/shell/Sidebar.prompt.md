The app shell's navy left rail. Flat nav, Today first; quick add pinned above the nav; Settings goes in the footer slot.

```jsx
<Sidebar items={[{id:'today',label:'Today'},{id:'projects',label:'Projects'}]}
  activeId="today" onNavigate={go} onQuickAdd={openQuickAdd}
  footer={<NavLike>Settings</NavLike>} />
```
