import { ArrowDownRight, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { brl } from "@/domain/finance";
export const Badge=({children,tone="neutral"}:{children:React.ReactNode;tone?:string})=><span className={`badge ${tone}`}>{children}</span>;
export function MetricCard({label,value,change,icon:Icon,tone="blue"}:{label:string;value:number;change?:number;icon:React.ElementType;tone?:string}){return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19}/></div><div className="metric-copy"><span>{label}</span><strong>{brl(value)}</strong>{change!==undefined&&<small className={change>=0?"positive":"negative"}>{change>=0?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>} {Math.abs(change).toLocaleString("pt-BR")}% <i>vs. mês anterior</i></small>}</div></article>}
export const Empty=({title,text}:{title:string;text:string})=><div className="empty"><div className="empty-icon"><MoreHorizontal/></div><strong>{title}</strong><p>{text}</p></div>;
export const Field=({label,children,hint}:{label:string;children:React.ReactNode;hint?:string})=><label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
