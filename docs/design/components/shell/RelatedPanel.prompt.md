The relationships panel. Every detail screen (project, meeting, invoice, action item) shows one so connections are always visible and navigable.

```jsx
<RelatedPanel sections={[
  {label:'Action items',count:3,rows:[{title:'Send revised SOW',meta:'Due Sep 2',trailing:<StatusChip status="atrisk"/>,onOpen:go}]},
  {label:'Invoices',rows:[],empty:'No invoices for this project yet.'},
]}/>
```
