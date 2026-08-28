The table for every list view (action items, invoices, meetings). Horizontal dividers only, mono right-aligned numerics.

```jsx
<DataTable columns={[
  {header:'Title',key:'title',grow:true},
  {header:'Deadline',key:'due',mono:true},
  {header:'Status',render:r=><StatusChip status={r.status}/>},
]} rows={items} onRowClick={open}/>
```
