'use client';
import {useId} from 'react';
import {FACIAL_EXPRESSION_MODES,FACIAL_EXPRESSION_LABELS,FACIAL_EXPRESSION_HELP,effectiveFacialExpression,type FacialExpressionMode} from '@/lib/facial-expression';

export function FacialExpressionControl({value,inherited,shot=false,disabled=false,onChange}:{
  value?:FacialExpressionMode;inherited?:FacialExpressionMode;shot?:boolean;disabled?:boolean;
  onChange:(value:FacialExpressionMode|undefined)=>void;
}){
  const id=useId(),mode=effectiveFacialExpression(inherited,value);
  return <div className="rounded border p-4 space-y-2">
    <label htmlFor={id} className="block font-medium">{shot?'Мимика этого плана':'Мимика героев · для фильма'}</label>
    <select id={id} aria-describedby={id+'-help'} className="w-full rounded border p-2 bg-background" disabled={disabled} value={value??(shot?'':'auto')} onChange={e=>onChange((e.target.value||undefined) as FacialExpressionMode|undefined)}>
      {shot&&<option value="">{`Как в фильме · ${FACIAL_EXPRESSION_LABELS[inherited??'auto']}`}</option>}
      {FACIAL_EXPRESSION_MODES.map(option=><option key={option} value={option}>{FACIAL_EXPRESSION_LABELS[option]}</option>)}
    </select>
    <p id={id+'-help'} className="text-sm text-muted-foreground">{FACIAL_EXPRESSION_HELP[mode]}</p>
    <p className="text-sm text-muted-foreground">Меняется выразительность реакции, а не черты лица. У неговорящих героев рот остаётся закрытым; улыбка с сомкнутыми губами разрешена.</p>
  </div>;
}
